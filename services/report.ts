
import { prisma } from '@/lib/prisma';
import { unstable_cache } from 'next/cache';

export class ReportService {
  private static readonly VALID_STATUSES = ['COMPLETED', 'PENDING', 'PENDING_SHIPMENT', 'PENDING_RECEIPT', 'RENTING', 'BOUGHT_OUT', 'WAIT_PAY'];
  // Exclude CLOSED, CANCELED, REFUNDED, RETURNING from "Valid Sales" but use them for "Total Orders" in Refund Rate calc.
  
  // For GMV, we only count valid sales.
  // For Refund Rate, we count (Refunded + Closed + Returning) / Total.

  static getReportData = unstable_cache(
    async (period: 'week' | 'biweek' | 'month' = 'week') => {
    const endDate = new Date();
    const startDate = new Date();
    
    // Set time range
    if (period === 'week') {
      startDate.setDate(endDate.getDate() - 7);
    } else if (period === 'biweek') {
      startDate.setDate(endDate.getDate() - 14);
    } else {
      startDate.setDate(endDate.getDate() - 30);
    }
    startDate.setHours(0, 0, 0, 0);

    // Previous period
    const duration = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate);
    const prevStartDate = new Date(prevEndDate.getTime() - duration);

    // Fetch Current Period Data
    const currentData = await ReportService.fetchPeriodData(startDate, endDate);
    const prevData = await ReportService.fetchPeriodData(prevStartDate, prevEndDate);

    // Platform Breakdown (Current Period)
    const platformData = await ReportService.fetchPlatformData(startDate, endDate);
    
    // Product Ranking (Current Period)
    const productData = await ReportService.fetchProductData(startDate, endDate);

    // Trend Data
    const trendData = await ReportService.fetchTrendData(startDate, endDate, prevStartDate, prevEndDate, period);

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
      products: productData,
      trend: trendData
    };
  },
  ['report-data'], // Cache key prefix
  { revalidate: 3600 } // Revalidate every 1 hour
  );

  private static calculateGrowth(current: number, previous: number) {
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  }

  private static async fetchPeriodData(start: Date, end: Date) {
    // 1. GMV and Valid Orders
    const validStats = await prisma.onlineOrder.aggregate({
      _sum: { totalAmount: true },
      _count: { id: true },
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ReportService.VALID_STATUSES }
      }
    });

    // 2. Total Orders (including cancelled/refunded)
    const totalOrdersCount = await prisma.onlineOrder.count({
      where: {
        createdAt: { gte: start, lt: end },
      }
    });

    // 3. Refund/Cancel Count
    const refundCount = await prisma.onlineOrder.count({
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ['CLOSED', 'REFUNDED', 'RETURNING', 'CANCELED'] }
      }
    });

    return {
      gmv: validStats._sum.totalAmount || 0,
      orderCount: validStats._count.id || 0, // Valid orders count
      totalOrders: totalOrdersCount,
      refundCount,
      refundRate: totalOrdersCount > 0 ? (refundCount / totalOrdersCount) * 100 : 0
    };
  }

  private static async fetchPlatformData(start: Date, end: Date) {
    // Group by Platform
    const raw = await prisma.onlineOrder.groupBy({
      by: ['platform', 'promotionChannel'],
      _sum: { totalAmount: true },
      _count: { id: true },
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ReportService.VALID_STATUSES }
      }
    });

    // Process and Map Names
    const map: Record<string, { gmv: number, count: number }> = {};
    let totalGmv = 0;

    raw.forEach(item => {
      let name = item.platform || '其他';
      const channel = item.promotionChannel;
      
      // Map Logic (Same as DashboardService)
      if (channel && channel.includes('支付宝小程序')) name = '支付宝小程序';
      else {
        const upper = name.toUpperCase().trim();
        if (upper === 'ZANCHEN') name = '赞晨';
        else if (upper === 'AOLZU' || name === '奥租') name = '奥租';
        else if (upper === 'LLXZU' || name === '零零享' || name === '乐乐享租') name = '零零享';
        else if (upper === 'YOUPIN' || name === '优品租' || name === '有品') name = '优品租';
        else if (upper === 'CHENGLIN' || name === '诚赁' || name === '诚林') name = '诚赁';
        else if (upper === 'RRZ' || name === '人人租') name = '人人租';
        else if (name === '支付宝小程序') name = '支付宝小程序';
        else if (upper === 'XIANYU' || name === '闲鱼') name = '闲鱼';
        else if (/^\d+$/.test(upper) || /^SF\d+$/.test(upper) || upper === 'UNKNOWN') name = '其他';
      }

      if (!map[name]) map[name] = { gmv: 0, count: 0 };
      map[name].gmv += (item._sum.totalAmount || 0);
      map[name].count += item._count.id;
      totalGmv += (item._sum.totalAmount || 0);
    });

    return Object.entries(map).map(([platform, data]) => ({
      platform,
      gmv: data.gmv,
      orderCount: data.count,
      percentage: totalGmv > 0 ? (data.gmv / totalGmv) * 100 : 0
    })).sort((a, b) => b.gmv - a.gmv);
  }

  private static async fetchProductData(start: Date, end: Date) {
    const raw = await prisma.onlineOrder.groupBy({
      by: ['productName'],
      _sum: { totalAmount: true },
      _count: { id: true },
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ReportService.VALID_STATUSES },
        productName: { not: null }
      },
      orderBy: {
        _sum: {
          totalAmount: 'desc'
        }
      },
      take: 10
    });

    return raw.map(item => ({
      productName: item.productName,
      gmv: item._sum.totalAmount || 0,
      count: item._count.id
    }));
  }

  private static async fetchTrendData(start: Date, end: Date, prevStart: Date, prevEnd: Date, period: string) {
    // Group by Day
    const currentRaw = await prisma.onlineOrder.groupBy({
      by: ['createdAt'],
      _sum: { totalAmount: true },
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ReportService.VALID_STATUSES }
      }
    });

    const prevRaw = await prisma.onlineOrder.groupBy({
      by: ['createdAt'],
      _sum: { totalAmount: true },
      where: {
        createdAt: { gte: prevStart, lt: prevEnd },
        status: { in: ReportService.VALID_STATUSES }
      }
    });

    // Helper to aggregate by day relative to start
    const aggregate = (raw: any[], startDate: Date) => {
      const map: Record<number, number> = {}; // dayIndex -> gmv
      raw.forEach(item => {
        const date = new Date(item.createdAt);
        const diffTime = Math.abs(date.getTime() - startDate.getTime());
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (!map[diffDays]) map[diffDays] = 0;
        map[diffDays] += (item._sum.totalAmount || 0);
      });
      return map;
    };

    const currentMap = aggregate(currentRaw, start);
    const prevMap = aggregate(prevRaw, prevStart);

    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    const dates: string[] = [];
    const currentSeries: number[] = [];
    const prevSeries: number[] = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split('T')[0]);
      
      currentSeries.push(currentMap[i] || 0);
      prevSeries.push(prevMap[i] || 0);
    }

    return {
      dates,
      current: currentSeries,
      previous: prevSeries
    };
  }
}
