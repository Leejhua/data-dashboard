import { prisma } from '@/lib/prisma';

type AllOrderLite = {
  createdAt: Date;
  status: string;
  totalAmount: number | null;
  platform: string | null;
  promotionChannel: string | null;
};

type ValidOrderLite = {
  createdAt: Date;
  status: string;
  totalAmount: number | null;
  platform: string;
  promotionChannel: string | null;
  productId: string | null;
  productName: string | null;
  itemSku: string | null;
  variantName: string | null;
  itemTitle: string | null;
  specId: string | null;
};

type ReportScope = 'all' | 'self';

export class ReportService {
  private static readonly VALID_STATUSES = ['COMPLETED', 'PENDING_SHIPMENT', 'RENTING', 'RETURNING', 'PENDING_RECEIPT', 'BOUGHT_OUT'];
  private static readonly REFUND_STATUSES = ['CLOSED', 'REFUNDED', 'CANCELED'];
  private static readonly SELF_PLATFORMS = ['赞晨', '支付宝小程序'];
  private static readonly ZULIN_TREND_POINTS = 10;

  static async getReportData(
    period: 'week' | 'biweek' | 'month' | 'current_week' | 'current_month' = 'week',
    scope: ReportScope = 'all'
  ) {
    const endDate = new Date();
    const startDate = new Date();

    if (period === 'week') {
      startDate.setDate(endDate.getDate() - 7);
    } else if (period === 'biweek') {
      startDate.setDate(endDate.getDate() - 14);
    } else if (period === 'month') {
      startDate.setDate(endDate.getDate() - 30);
    } else if (period === 'current_week') {
      // Start from this Monday
      const day = startDate.getDay();
      const diff = startDate.getDate() - day + (day === 0 ? -6 : 1);
      startDate.setDate(diff);
    } else if (period === 'current_month') {
      // Start from 1st of this month
      startDate.setDate(1);
    }

    startDate.setHours(0, 0, 0, 0);
    const duration = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate);
    const prevStartDate = new Date(prevEndDate.getTime() - duration);

    const [allOrders, validOrders] = await Promise.all([
      prisma.onlineOrder.findMany({
        select: {
          createdAt: true,
          status: true,
          totalAmount: true,
          platform: true,
          promotionChannel: true,
        },
      }),
      prisma.onlineOrder.findMany({
        where: { status: { in: ReportService.VALID_STATUSES } },
        select: {
          createdAt: true,
          status: true,
          totalAmount: true,
          platform: true,
          promotionChannel: true,
          productId: true,
          productName: true,
          itemSku: true,
          variantName: true,
          itemTitle: true,
          specId: true,
        },
      }),
    ]);

    const currentData = ReportService.fetchPeriodData(allOrders, validOrders, startDate, endDate, scope);
    const prevData = ReportService.fetchPeriodData(allOrders, validOrders, prevStartDate, prevEndDate, scope);
    const platformData = ReportService.fetchPlatformData(validOrders, startDate, endDate, scope);
    const productData = await ReportService.fetchDeviceData(validOrders, startDate, endDate, scope);
    const channelAnalysis = scope === 'all' ? ReportService.fetchChannelAnalysis(validOrders, startDate, endDate) : null;
    const trendData = ReportService.fetchTrendData(validOrders, startDate, endDate, prevStartDate, prevEndDate, scope);
    const zulinData = await ReportService.fetchZulinReportData(startDate, endDate, prevStartDate, prevEndDate);

    return {
      summary: {
        gmv: currentData.gmv,
        orderCount: currentData.orderCount,
        aov: currentData.orderCount > 0 ? currentData.gmv / currentData.orderCount : 0,
        refundRate: currentData.refundRate,
        
        prevGmv: prevData.gmv,
        prevOrderCount: prevData.orderCount,
        prevAov: prevData.orderCount > 0 ? prevData.gmv / prevData.orderCount : 0,
        prevRefundRate: prevData.refundRate,

        gmvGrowth: ReportService.calculateGrowth(currentData.gmv, prevData.gmv),
        orderGrowth: ReportService.calculateGrowth(currentData.orderCount, prevData.orderCount),
        aovGrowth: ReportService.calculateGrowth(
          currentData.orderCount > 0 ? currentData.gmv / currentData.orderCount : 0, 
          prevData.orderCount > 0 ? prevData.gmv / prevData.orderCount : 0
        ),
      },
      platforms: platformData,
      devices: productData,
      products: productData,
      trend: trendData,
      channelAnalysis,
      zulin: zulinData,
    };
  }

  private static async fetchZulinReportData(start: Date, end: Date, prevStart: Date, prevEnd: Date) {
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS zulin_daily_metrics (
          id TEXT PRIMARY KEY,
          data_date TEXT NOT NULL,
          product_id TEXT NOT NULL,
          title TEXT NOT NULL,
          exposure INTEGER NOT NULL DEFAULT 0,
          visits INTEGER NOT NULL DEFAULT 0,
          amount REAL NOT NULL DEFAULT 0,
          price TEXT,
          managed_days INTEGER NOT NULL DEFAULT 0,
          scope TEXT,
          start_date TEXT,
          end_date TEXT,
          optimization TEXT,
          source TEXT,
          batch_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(data_date, product_id)
        )
      `);

      const startKey = ReportService.dateKey(start);
      const endKey = ReportService.dateKey(end);
      const prevStartKey = ReportService.dateKey(prevStart);
      const prevEndKey = ReportService.dateKey(prevEnd);

      const currentRows = await prisma.$queryRaw<{
        data_date: string;
        exposure: number;
        visits: number;
        amount: number;
      }[]>`
        SELECT
          data_date,
          COALESCE(SUM(exposure), 0) AS exposure,
          COALESCE(SUM(visits), 0) AS visits,
          COALESCE(SUM(amount), 0) AS amount
        FROM zulin_daily_metrics
        WHERE data_date >= ${startKey} AND data_date < ${endKey}
        GROUP BY data_date
        ORDER BY data_date ASC
      `;

      const prevRows = await prisma.$queryRaw<{
        data_date: string;
        exposure: number;
        visits: number;
        amount: number;
      }[]>`
        SELECT
          data_date,
          COALESCE(SUM(exposure), 0) AS exposure,
          COALESCE(SUM(visits), 0) AS visits,
          COALESCE(SUM(amount), 0) AS amount
        FROM zulin_daily_metrics
        WHERE data_date >= ${prevStartKey} AND data_date < ${prevEndKey}
        GROUP BY data_date
        ORDER BY data_date ASC
      `;

      const sumRows = (rows: Array<{ exposure: number; visits: number; amount: number }>) => {
        return rows.reduce(
          (acc, row) => {
            acc.exposure += Number(row.exposure || 0);
            acc.visits += Number(row.visits || 0);
            acc.revenue += Number(row.amount || 0);
            return acc;
          },
          { exposure: 0, visits: 0, revenue: 0 }
        );
      };

      const currentSummary = sumRows(currentRows);
      const previousSummary = sumRows(prevRows);
      const currentConversionRate = currentSummary.exposure > 0 ? (currentSummary.visits / currentSummary.exposure) * 100 : 0;
      const previousConversionRate = previousSummary.exposure > 0 ? (previousSummary.visits / previousSummary.exposure) * 100 : 0;

      const dailyMap = new Map(
        currentRows.map((row) => [
          row.data_date,
          {
            exposure: Number(row.exposure || 0),
            visits: Number(row.visits || 0),
            revenue: Number(row.amount || 0),
          },
        ])
      );

      const allDates: string[] = [];
      const iterDate = new Date(start);
      iterDate.setHours(0, 0, 0, 0);
      while (iterDate < end) {
        allDates.push(ReportService.dateKey(iterDate));
        iterDate.setDate(iterDate.getDate() + 1);
      }

      const reducedDates = ReportService.reduceTrendPoints(allDates, ReportService.ZULIN_TREND_POINTS);
      const trend = reducedDates.map((date) => {
        const row = dailyMap.get(date);
        return {
          date,
          exposure: Number(row?.exposure || 0),
          visits: Number(row?.visits || 0),
          revenue: Number(row?.revenue || 0),
        };
      });

      const productRows = await prisma.$queryRaw<{
        product_id: string;
        title: string;
        current_exposure: number;
        current_visits: number;
        current_amount: number;
        previous_amount: number;
      }[]>`
        SELECT
          product_id,
          title,
          COALESCE(SUM(CASE WHEN data_date >= ${startKey} AND data_date < ${endKey} THEN exposure ELSE 0 END), 0) AS current_exposure,
          COALESCE(SUM(CASE WHEN data_date >= ${startKey} AND data_date < ${endKey} THEN visits ELSE 0 END), 0) AS current_visits,
          COALESCE(SUM(CASE WHEN data_date >= ${startKey} AND data_date < ${endKey} THEN amount ELSE 0 END), 0) AS current_amount,
          COALESCE(SUM(CASE WHEN data_date >= ${prevStartKey} AND data_date < ${prevEndKey} THEN amount ELSE 0 END), 0) AS previous_amount
        FROM zulin_daily_metrics
        GROUP BY product_id, title
      `;

      const products = productRows
        .map((item) => {
          const revenue = Number(item.current_amount || 0);
          const prevRevenue = Number(item.previous_amount || 0);
          const exposure = Number(item.current_exposure || 0);
          const visits = Number(item.current_visits || 0);
          const conversionRate = exposure > 0 ? (visits / exposure) * 100 : 0;
          const revenueGrowth = prevRevenue > 0 ? ((revenue - prevRevenue) / prevRevenue) * 100 : (revenue > 0 ? 100 : 0);
          return {
            productId: item.product_id,
            title: item.title,
            exposure,
            visits,
            revenue,
            conversionRate,
            revenueGrowth,
          };
        })
        .filter((item) => item.revenue > 0 || item.exposure > 0 || item.visits > 0)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      return {
        summary: {
          exposure: currentSummary.exposure,
          visits: currentSummary.visits,
          revenue: currentSummary.revenue,
          conversionRate: currentConversionRate,
          prevExposure: previousSummary.exposure,
          prevVisits: previousSummary.visits,
          prevRevenue: previousSummary.revenue,
          prevConversionRate: previousConversionRate,
          exposureGrowth: ReportService.calculateGrowth(currentSummary.exposure, previousSummary.exposure),
          visitsGrowth: ReportService.calculateGrowth(currentSummary.visits, previousSummary.visits),
          revenueGrowth: ReportService.calculateGrowth(currentSummary.revenue, previousSummary.revenue),
          conversionDiff: currentConversionRate - previousConversionRate,
        },
        trend,
        products,
      };
    } catch {
      return {
        summary: {
          exposure: 0,
          visits: 0,
          revenue: 0,
          conversionRate: 0,
          prevExposure: 0,
          prevVisits: 0,
          prevRevenue: 0,
          prevConversionRate: 0,
          exposureGrowth: 0,
          visitsGrowth: 0,
          revenueGrowth: 0,
          conversionDiff: 0,
        },
        trend: [],
        products: [],
      };
    }
  }

  private static reduceTrendPoints<T>(rows: T[], maxPoints: number) {
    if (maxPoints <= 0) {
      return [];
    }
    if (rows.length <= maxPoints) {
      return rows;
    }
    const selected = new Set<number>();
    const step = (rows.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i += 1) {
      selected.add(Math.round(i * step));
    }
    return Array.from(selected)
      .sort((a, b) => a - b)
      .map((index) => rows[index]);
  }

  private static fetchChannelAnalysis(validOrders: ValidOrderLite[], start: Date, end: Date) {
    const summary = {
      self: { gmv: 0, count: 0 },
      third: { gmv: 0, count: 0 }
    };

    const dailyData: Record<string, { self: number, third: number }> = {};
    const iterDate = new Date(start);
    iterDate.setHours(0, 0, 0, 0);

    while (iterDate < end) {
      const dateStr = ReportService.dateKey(iterDate);
      dailyData[dateStr] = { self: 0, third: 0 };
      iterDate.setDate(iterDate.getDate() + 1);
    }

    for (const item of validOrders) {
      if (!ReportService.inRange(item.createdAt, start, end)) continue;
      const name = ReportService.normalizePlatform(item.platform, item.promotionChannel);
      const isSelf = ReportService.SELF_PLATFORMS.includes(name);
      const gmv = item.totalAmount || 0;
      const dateStr = ReportService.dateKey(item.createdAt);

      if (isSelf) {
        summary.self.gmv += gmv;
        summary.self.count += 1;
        if (dailyData[dateStr]) dailyData[dateStr].self += gmv;
      } else {
        summary.third.gmv += gmv;
        summary.third.count += 1;
        if (dailyData[dateStr]) dailyData[dateStr].third += gmv;
      }
    }

    const totalGmv = summary.self.gmv + summary.third.gmv;
    const orderedDates = Object.keys(dailyData).sort();
    
    return {
      summary: {
        ...summary,
        selfPercentage: totalGmv > 0 ? (summary.self.gmv / totalGmv) * 100 : 0,
        thirdPercentage: totalGmv > 0 ? (summary.third.gmv / totalGmv) * 100 : 0,
      },
      trend: {
        dates: orderedDates,
        self: orderedDates.map(d => Number((dailyData[d].self || 0).toFixed(2))),
        third: orderedDates.map(d => Number((dailyData[d].third || 0).toFixed(2)))
      }
    };
  }

  private static calculateGrowth(current: number, previous: number) {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  }

  private static fetchPeriodData(
    allOrders: AllOrderLite[],
    validOrders: ValidOrderLite[],
    start: Date,
    end: Date,
    scope: ReportScope
  ) {
    let gmv = 0;
    let orderCount = 0;
    let totalOrdersCount = 0;
    let refundCount = 0;

    for (const order of validOrders) {
      if (!ReportService.inRange(order.createdAt, start, end)) continue;
      if (!ReportService.inScope(order.platform, order.promotionChannel, scope)) continue;
      gmv += order.totalAmount || 0;
      orderCount += 1;
    }

    for (const order of allOrders) {
      if (!ReportService.inRange(order.createdAt, start, end)) continue;
      if (!ReportService.inScope(order.platform, order.promotionChannel, scope)) continue;
      totalOrdersCount += 1;
      if (ReportService.REFUND_STATUSES.includes(order.status)) {
        refundCount += 1;
      }
    }

    return {
      gmv,
      orderCount,
      totalOrders: totalOrdersCount,
      refundCount,
      refundRate: totalOrdersCount > 0 ? (refundCount / totalOrdersCount) * 100 : 0
    };
  }

  private static fetchPlatformData(validOrders: ValidOrderLite[], start: Date, end: Date, scope: ReportScope) {
    const map: Record<string, { gmv: number, count: number }> = {};
    let totalGmv = 0;

    for (const item of validOrders) {
      if (!ReportService.inRange(item.createdAt, start, end)) continue;
      if (!ReportService.inScope(item.platform, item.promotionChannel, scope)) continue;
      const name = ReportService.normalizePlatform(item.platform, item.promotionChannel);
      const gmv = item.totalAmount || 0;

      if (!map[name]) map[name] = { gmv: 0, count: 0 };
      map[name].gmv += gmv;
      map[name].count += 1;
      totalGmv += gmv;
    }

    return Object.entries(map).map(([platform, data]) => ({
      platform,
      gmv: data.gmv,
      orderCount: data.count,
      percentage: totalGmv > 0 ? (data.gmv / totalGmv) * 100 : 0
    })).sort((a, b) => b.gmv - a.gmv);
  }

  private static async fetchDeviceData(validOrders: ValidOrderLite[], start: Date, end: Date, scope: ReportScope) {
    const scopedOrders = validOrders.filter((item) =>
      ReportService.inScope(item.platform, item.promotionChannel, scope)
    );
    const specIds = Array.from(
      new Set(scopedOrders.map((item) => item.specId).filter((value): value is string => Boolean(value)))
    );
    const orderProductIds = Array.from(
      new Set(scopedOrders.map((item) => item.productId).filter((value): value is string => Boolean(value)))
    );
    const specs = specIds.length > 0
      ? await prisma.productSpec.findMany({
        where: { id: { in: specIds } },
        select: {
          id: true,
          productId: true,
          product: {
            select: {
              name: true,
            }
          }
        }
      })
      : [];
    const allProductIds = Array.from(
      new Set([...orderProductIds, ...specs.map((item) => item.productId).filter(Boolean)])
    );
    const products = allProductIds.length > 0
      ? await prisma.product.findMany({
        where: { id: { in: allProductIds } },
        select: {
          id: true,
          name: true,
        }
      })
      : [];
    const productNameById = new Map(products.map((item) => [item.id, item.name]));
    const specDeviceNameBySpecId = new Map(
      specs.map((item) => [item.id, item.product.name || productNameById.get(item.productId) || ''])
    );

    const deviceMap: Record<string, { gmv: number; count: number }> = {};
    for (const item of scopedOrders) {
      if (!ReportService.inRange(item.createdAt, start, end)) continue;
      const deviceName = ReportService.resolveDeviceName(item, specDeviceNameBySpecId, productNameById);
      if (!deviceMap[deviceName]) deviceMap[deviceName] = { gmv: 0, count: 0 };
      deviceMap[deviceName].gmv += item.totalAmount || 0;
      deviceMap[deviceName].count += 1;
    }

    return Object.entries(deviceMap)
      .map(([name, data]) => ({
        deviceName: name,
        productName: name,
        gmv: data.gmv,
        count: data.count,
      }))
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 10);
  }

  private static resolveDeviceName(
    item: ValidOrderLite,
    specDeviceNameBySpecId: Map<string, string>,
    productNameById: Map<string, string>
  ) {
    const normalizedSpecName = String(item.specId ? specDeviceNameBySpecId.get(item.specId) : '').trim();
    if (normalizedSpecName) {
      return normalizedSpecName;
    }

    const normalizedProductName = String(item.productId ? productNameById.get(item.productId) : '').trim();
    if (normalizedProductName) {
      return normalizedProductName;
    }

    const fallback = String(item.productName || item.itemTitle || item.variantName || item.itemSku || '未知设备').trim();
    return fallback || '未知设备';
  }

  private static fetchTrendData(
    validOrders: ValidOrderLite[],
    start: Date,
    end: Date,
    prevStart: Date,
    prevEnd: Date,
    scope: ReportScope
  ) {
    const currentMap: Record<string, number> = {};
    const prevMap: Record<string, number> = {};

    for (const item of validOrders) {
      const dateStr = ReportService.dateKey(item.createdAt);
      const gmv = item.totalAmount || 0;
      if (!ReportService.inScope(item.platform, item.promotionChannel, scope)) continue;
      if (ReportService.inRange(item.createdAt, start, end)) {
        currentMap[dateStr] = (currentMap[dateStr] || 0) + gmv;
      }
      if (ReportService.inRange(item.createdAt, prevStart, prevEnd)) {
        prevMap[dateStr] = (prevMap[dateStr] || 0) + gmv;
      }
    }

    const dates: string[] = [];
    const currentSeries: number[] = [];
    const prevSeries: number[] = [];
    const currentDates: string[] = [];
    const prevDates: string[] = [];
    
    const iterDate = new Date(start);
    iterDate.setHours(0, 0, 0, 0);
    
    const iterPrevDate = new Date(prevStart);
    iterPrevDate.setHours(0, 0, 0, 0);

    while (iterDate < end) {
      const dateStr = ReportService.dateKey(iterDate);
      const prevDateStr = ReportService.dateKey(iterPrevDate);
      
      dates.push(dateStr);
      currentDates.push(dateStr);
      prevDates.push(prevDateStr);
      
      currentSeries.push(Number((currentMap[dateStr] || 0).toFixed(2)));
      prevSeries.push(Number((prevMap[prevDateStr] || 0).toFixed(2)));
      
      iterDate.setDate(iterDate.getDate() + 1);
      iterPrevDate.setDate(iterPrevDate.getDate() + 1);
    }

    return {
      dates,
      currentDates,
      prevDates,
      current: currentSeries,
      previous: prevSeries
    };
  }

  private static inRange(date: Date, start: Date, end: Date) {
    const value = date.getTime();
    return Number.isFinite(value) && value >= start.getTime() && value < end.getTime();
  }

  private static dateKey(date: Date) {
    return date.toLocaleDateString('en-CA');
  }

  private static inScope(platform: string | null | undefined, promotionChannel: string | null | undefined, scope: ReportScope) {
    if (scope === 'all') {
      return true;
    }
    const normalized = ReportService.normalizePlatform(platform, promotionChannel);
    return ReportService.SELF_PLATFORMS.includes(normalized);
  }

  private static normalizePlatform(platform: string | null | undefined, promotionChannel: string | null | undefined) {
    const name = platform || '其他';
    if (promotionChannel && promotionChannel.includes('支付宝小程序')) return '支付宝小程序';

    const upper = name.toUpperCase().trim();
    if (upper === 'ZANCHEN') return '赞晨';
    if (upper === 'AOLZU' || name === '奥租') return '奥租';
    if (upper === 'LLXZU' || name === '零零享' || name === '乐乐享租') return '零零享';
    if (upper === 'YOUPIN' || name === '优品租' || name === '有品') return '优品租';
    if (upper === 'CHENGLIN' || name === '诚赁' || name === '诚林') return '诚赁';
    if (upper === 'RRZ' || name === '人人租') return '人人租';
    if (name === '支付宝小程序') return '支付宝小程序';
    if (upper === 'XIANYU' || name === '闲鱼') return '闲鱼';
    if (/^\d+$/.test(upper) || /^SF\d+$/.test(upper) || upper === 'UNKNOWN') return '其他';
    return name;
  }
}
