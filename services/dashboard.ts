import { prisma } from '@/lib/prisma';
import { unstable_cache } from 'next/cache';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

/**
 * Service Layer for Dashboard
 * Handles business logic and data aggregation
 */
export class DashboardService {
  private static readonly VALID_STATUSES = ['COMPLETED', 'PENDING_SHIPMENT', 'RENTING', 'RETURNING', 'PENDING_RECEIPT', 'BOUGHT_OUT'];
  private static readonly CONTROLLABLE_PLATFORMS = ['闲鱼', '支付宝小程序', '赞晨'];
  private static readonly ZULIN_TREND_POINTS = 7;

  /**
   * Get summary metrics for the dashboard
   * Caches the result for 1 hour to improve performance
   */
  static getSummary = unstable_cache(
    async () => {
      // Parallel execution for performance
      const [totalGMV, totalOrders, activePromoters, prevTotalGMV, prevTotalOrders, zulinSummary] = await Promise.all([
        // 1. Calculate Total GMV (sum of Order.totalAmount)
        prisma.order.aggregate({
          _sum: {
            totalAmount: true,
          },
          where: {
            status: { in: DashboardService.VALID_STATUSES },
          },
        }),

        // 2. Count Total Orders
        prisma.order.count({
          where: {
            status: { in: DashboardService.VALID_STATUSES },
          },
        }),

        // 3. Count Active Promoters (who have at least one order)
        prisma.promoter.count({
          where: {
            orders: {
              some: {
                status: { in: DashboardService.VALID_STATUSES },
              },
            },
          },
        }),

        // 4. Calculate Previous Month Total GMV (for MoM)
        // Note: For simplicity, we compare with data from 30 days ago for the same duration.
        // But "Total GMV" is usually "All Time". MoM for "All Time" doesn't make sense.
        // It's better to show "Today's" or "This Month's" metrics for comparison.
        // However, the current dashboard shows "Total All Time".
        // Let's assume the user wants to see "Growth since last month".
        // Comparison: (Total Now - Total 30 Days Ago) / Total 30 Days Ago
        // We need snapshot of 30 days ago.
        
        // Actually, for "Total All Time" metrics, showing "New in last 30 days" is more common.
        // Let's fetch data created in last 30 days to show "+X in last 30 days".
        prisma.order.aggregate({
          _sum: {
            totalAmount: true,
          },
          where: {
            status: { in: DashboardService.VALID_STATUSES },
            createdAt: {
                gte: new Date(new Date().setDate(new Date().getDate() - 30))
            }
          },
        }),

        // 5. Count Orders in last 30 days
        prisma.order.count({
          where: {
            status: { in: DashboardService.VALID_STATUSES },
            createdAt: {
                gte: new Date(new Date().setDate(new Date().getDate() - 30))
            }
          },
        }),
        DashboardService.getLatestZulinSummary(),
      ]);

      return {
        totalGMV: totalGMV._sum.totalAmount || 0,
        totalOrders,
        activePromoters,
        recentGMV: prevTotalGMV._sum.totalAmount || 0,
        recentOrders: prevTotalOrders,
        zulinSummary,
      };
    },
    ['dashboard-summary'], // Cache key
    { revalidate: 3600 }   // Revalidate every 1 hour (3600 seconds)
  );

  private static async getLatestZulinFile() {
    const outputDir = process.env.ZULIN_ANALYSIS_OUTPUT_FOLDER || path.resolve(process.cwd(), '../zulin-data/analysis/output');
    const files = await fs.readdir(outputDir);
    const candidates = files.filter((name) => /^analysis_result_.*\.xlsx$/i.test(name));
    if (!candidates.length) {
      return null;
    }
    const fileWithStats = await Promise.all(
      candidates.map(async (name) => {
        const filePath = path.join(outputDir, name);
        const stat = await fs.stat(filePath);
        return { name, filePath, mtime: stat.mtimeMs };
      })
    );
    fileWithStats.sort((a, b) => b.mtime - a.mtime);
    return fileWithStats[0];
  }

  private static parseZulinNumber(value: string) {
    const normalized = value.replace(/[,%\s]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private static reduceZulinTrendPoints<T>(rows: T[], maxPoints: number) {
    if (maxPoints <= 0) {
      return [];
    }
    if (maxPoints === 1) {
      return rows.length ? [rows[rows.length - 1]] : [];
    }
    if (rows.length <= maxPoints) {
      return rows;
    }
    const selected = new Set<number>();
    const step = (rows.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i += 1) {
      selected.add(Math.round(i * step));
    }
    if (selected.size < maxPoints) {
      for (let i = 0; i < rows.length && selected.size < maxPoints; i += 1) {
        selected.add(i);
      }
    }
    return Array.from(selected)
      .sort((a, b) => a - b)
      .map((index) => rows[index]);
  }

  private static formatZulinDate(dateText: string) {
    const trimmed = String(dateText || '').trim();
    const matched = trimmed.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!matched) return trimmed.replace('(累计)', '');
    return `${matched[2]}月${matched[3]}日`;
  }

  private static async getZulinPanelDataFromDatabase() {
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
      const rows = await prisma.$queryRaw<{
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
        GROUP BY data_date
        ORDER BY data_date ASC
      `;

      if (!rows.length) {
        return null;
      }

      const trendRows = rows.map((row) => {
        const visits = Number(row.visits || 0);
        const exposure = Number(row.exposure || 0);
        const revenue = Number(row.amount || 0);
        const conversionRate = exposure > 0 ? (visits / exposure) * 100 : 0;
        return {
          date: DashboardService.formatZulinDate(row.data_date),
          exposure,
          visits,
          revenue,
          conversionRate,
          conversionRateText: `${conversionRate.toFixed(2)}%`,
        };
      });

      const latest = trendRows[trendRows.length - 1];
      const trend = DashboardService.reduceZulinTrendPoints(trendRows, DashboardService.ZULIN_TREND_POINTS);

      return {
        summary: {
          date: latest.date,
          exposure: latest.exposure,
          visits: latest.visits,
          revenue: latest.revenue,
          conversionRate: latest.conversionRateText,
        },
        trend,
        sourceFile: 'database',
      };
    } catch (error) {
      console.error('Load zulin panel data from database failed:', error);
      return null;
    }
  }

  static getZulinPanelData = unstable_cache(
    async () => {
      try {
        const databasePanel = await DashboardService.getZulinPanelDataFromDatabase();
        if (databasePanel) {
          return databasePanel;
        }

        const latestFile = await DashboardService.getLatestZulinFile();
        if (!latestFile) {
          return {
            summary: null,
            trend: [],
            sourceFile: null,
          };
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(latestFile.filePath);
        const worksheet = workbook.getWorksheet('每日汇总');
        if (!worksheet) {
          return {
            summary: null,
            trend: [],
            sourceFile: latestFile.name,
          };
        }

        const parsedRows: Array<{
          date: string;
          exposure: number;
          visits: number;
          revenue: number;
          conversionRate: number;
          conversionRateText: string;
        }> = [];
        for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
          const row = worksheet.getRow(rowIndex);
          const date = DashboardService.formatZulinDate(String(row.getCell(1).text || '').trim());
          if (!date) {
            continue;
          }
          const exposure = DashboardService.parseZulinNumber(String(row.getCell(2).text || '').trim());
          const visits = DashboardService.parseZulinNumber(String(row.getCell(3).text || '').trim());
          const revenue = DashboardService.parseZulinNumber(String(row.getCell(4).text || '').trim());
          const conversionRateText = String(row.getCell(5).text || '').trim() || '0.00%';
          const conversionRate = DashboardService.parseZulinNumber(conversionRateText);
          parsedRows.push({ date, exposure, visits, revenue, conversionRate, conversionRateText });
        }

        if (!parsedRows.length) {
          return {
            summary: null,
            trend: [],
            sourceFile: latestFile.name,
          };
        }

        const latest = parsedRows[0];
        const ascendingRows = [...parsedRows].reverse();
        const trend = DashboardService.reduceZulinTrendPoints(ascendingRows, DashboardService.ZULIN_TREND_POINTS);

        return {
          summary: {
            date: latest.date,
            exposure: latest.exposure,
            visits: latest.visits,
            revenue: latest.revenue,
            conversionRate: latest.conversionRateText,
          },
          trend,
          sourceFile: latestFile.name,
        };
      } catch (error) {
        console.error('Load zulin panel data failed:', error);
        return {
          summary: null,
          trend: [],
          sourceFile: null,
        };
      }
    },
    ['dashboard-zulin-panel'],
    { revalidate: 600 }
  );

  private static async getLatestZulinSummary() {
    try {
      const panelData = await DashboardService.getZulinPanelData();
      if (!panelData.summary) {
        return null;
      }
      const { summary, sourceFile } = panelData;
      return {
        date: summary.date,
        exposure: summary.exposure,
        visits: summary.visits,
        revenue: summary.revenue,
        conversionRate: summary.conversionRate,
        sourceFile: sourceFile || '',
      };
    } catch (error) {
      console.error('Load zulin summary failed:', error);
      return null;
    }
  }
  
  /**
   * Get trend data for charts
   */
  static async getTrend(dimension: 'day' | 'week' | 'month' = 'day') {
    const endDate = new Date();
    const startDate = new Date();
    
    // Determine start date based on dimension
    if (dimension === 'week') {
        // Last 12 weeks
        startDate.setDate(endDate.getDate() - (12 * 7));
    } else if (dimension === 'month') {
        // Last 12 months
        startDate.setMonth(endDate.getMonth() - 11); // Current month + previous 11 months
        startDate.setDate(1); // Start from the 1st of that month
    } else {
        // 'day' - Last 15 days
        startDate.setDate(endDate.getDate() - 14);
    }
    startDate.setHours(0, 0, 0, 0);

    // 1. Fetch raw data from database
    const rawData = await prisma.order.groupBy({
      by: ['createdAt'],
      _sum: {
        totalAmount: true,
      },
      _count: {
        id: true,
      },
      where: {
        createdAt: {
          gte: startDate,
        },
        status: { in: DashboardService.VALID_STATUSES },
      },
    });

    // 2. Process and aggregate data
    const result: { date: string; gmv: number; orderCount: number }[] = [];
    
    if (dimension === 'week') {
        // Aggregate by Week
        const weeklyData: Record<string, { gmv: number, orderCount: number }> = {};
        const weeks: string[] = [];
        
        // Generate weeks list
        for (let i = 0; i < 12; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + (i * 7));
            // Get Monday of that week
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
            const monday = new Date(d.setDate(diff));
            const key = monday.toISOString().split('T')[0];
            weeks.push(key);
            weeklyData[key] = { gmv: 0, orderCount: 0 };
        }

        rawData.forEach(item => {
            const date = new Date(item.createdAt);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(date.setDate(diff));
            const key = monday.toISOString().split('T')[0];
            
            // Only aggregate if within our target weeks
            if (weeklyData[key]) {
                weeklyData[key].gmv += (item._sum.totalAmount || 0);
                weeklyData[key].orderCount += item._count.id;
            }
        });

        weeks.forEach(week => {
            result.push({
                date: week, // Label as Monday of the week
                gmv: weeklyData[week].gmv,
                orderCount: weeklyData[week].orderCount
            });
        });

    } else if (dimension === 'month') {
        // Aggregate by Month
        const monthlyData: Record<string, { gmv: number, orderCount: number }> = {};
        const months: string[] = [];
        
        // Generate months list
        for (let i = 0; i < 12; i++) {
            const d = new Date(startDate);
            d.setMonth(startDate.getMonth() + i);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
            months.push(key);
            monthlyData[key] = { gmv: 0, orderCount: 0 };
        }

        rawData.forEach(item => {
            const date = new Date(item.createdAt);
            const key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
            
            if (monthlyData[key]) {
                monthlyData[key].gmv += (item._sum.totalAmount || 0);
                monthlyData[key].orderCount += item._count.id;
            }
        });

        months.forEach(month => {
            result.push({
                date: month,
                gmv: monthlyData[month].gmv,
                orderCount: monthlyData[month].orderCount
            });
        });

    } else {
        // Aggregate by Day (Default)
        // Last 15 days
        for (let i = 0; i < 15; i++) {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + i);
            const dateString = date.toISOString().split('T')[0];
            
            const dayData = rawData.filter(item => {
                const itemDate = new Date(item.createdAt).toISOString().split('T')[0];
                return itemDate === dateString;
            });

            const dailyGMV = dayData.reduce((sum, item) => sum + (item._sum.totalAmount || 0), 0);
            const dailyOrders = dayData.reduce((sum, item) => sum + item._count.id, 0);

            result.push({
                date: dateString,
                gmv: dailyGMV,
                orderCount: dailyOrders,
            });
        }
    }

    return result;
  }

  static async getPlatformTrend(dimension: 'day' | 'week' | 'month' = 'day') {
    const endDate = new Date();
    const startDate = new Date();
    
    // Determine start date based on dimension
    if (dimension === 'week') {
        startDate.setDate(endDate.getDate() - (12 * 7));
    } else if (dimension === 'month') {
        startDate.setMonth(endDate.getMonth() - 11);
        startDate.setDate(1);
    } else {
        startDate.setDate(endDate.getDate() - 14);
    }
    startDate.setHours(0, 0, 0, 0);

    // Fetch offline orders
    const offlineOrders = await prisma.order.findMany({
      where: { 
        createdAt: { gte: startDate },
        status: { in: DashboardService.VALID_STATUSES },
      },
      select: { createdAt: true, platform: true, totalAmount: true }
    });

    // Fetch online orders
    const onlineOrders = await prisma.onlineOrder.findMany({
      where: { 
        createdAt: { gte: startDate },
        status: { in: DashboardService.VALID_STATUSES },
      },
      select: { createdAt: true, platform: true, promotionChannel: true, totalAmount: true }
    });

    // Fetch previous period data for comparison
    // Calculate previous period start/end dates
    const prevStartDate = new Date(startDate);
    
    if (dimension === 'week') {
        prevStartDate.setDate(prevStartDate.getDate() - (12 * 7));
    } else if (dimension === 'month') {
        prevStartDate.setMonth(prevStartDate.getMonth() - 12);
    } else {
        prevStartDate.setDate(prevStartDate.getDate() - 15);
    }
    
    // Fetch previous offline orders
    const prevOfflineOrders = await prisma.order.findMany({
      where: { 
        createdAt: { gte: prevStartDate, lt: startDate },
        status: { in: DashboardService.VALID_STATUSES },
      },
      select: { createdAt: true, platform: true, totalAmount: true }
    });

    // Fetch previous online orders
    const prevOnlineOrders = await prisma.onlineOrder.findMany({
      where: { 
        createdAt: { gte: prevStartDate, lt: startDate },
        status: { in: DashboardService.VALID_STATUSES },
      },
      select: { createdAt: true, platform: true, promotionChannel: true, totalAmount: true }
    });

    // Aggregate data
    const aggregatedData: Record<string, Record<string, { count: number, gmv: number }>> = {};
    const platformTotals: Record<string, { count: number, gmv: number, prevCount: number, prevGmv: number }> = {};
    const allPlatforms = new Set<string>();

    const processOrder = (date: Date, platform: string, amount: number, isPrevious: boolean = false) => {
      allPlatforms.add(platform);
      
      if (isPrevious) {
          if (!platformTotals[platform]) platformTotals[platform] = { count: 0, gmv: 0, prevCount: 0, prevGmv: 0 };
          platformTotals[platform].prevCount += 1;
          platformTotals[platform].prevGmv += amount;
          return;
      }

      let key = '';
      if (dimension === 'week') {
          const day = date.getDay();
          const diff = date.getDate() - day + (day === 0 ? -6 : 1);
          const monday = new Date(date);
          monday.setDate(diff);
          key = monday.toISOString().split('T')[0];
      } else if (dimension === 'month') {
          key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      } else {
          key = date.toISOString().split('T')[0];
      }
      
      if (!aggregatedData[key]) aggregatedData[key] = {};
      if (!aggregatedData[key][platform]) aggregatedData[key][platform] = { count: 0, gmv: 0 };
      
      aggregatedData[key][platform].count += 1;
      aggregatedData[key][platform].gmv += amount;
      
      // Update totals
      if (!platformTotals[platform]) platformTotals[platform] = { count: 0, gmv: 0, prevCount: 0, prevGmv: 0 };
      platformTotals[platform].count += 1;
      platformTotals[platform].gmv += amount;
    };

    offlineOrders.forEach(o => processOrder(o.createdAt, DashboardService.normalizePlatform(o.platform), o.totalAmount || 0));
    onlineOrders.forEach(o => processOrder(o.createdAt, DashboardService.normalizePlatform(o.platform, o.promotionChannel), o.totalAmount || 0));
    
    // Process previous period data
    prevOfflineOrders.forEach(o => processOrder(o.createdAt, DashboardService.normalizePlatform(o.platform), o.totalAmount || 0, true));
    prevOnlineOrders.forEach(o => processOrder(o.createdAt, DashboardService.normalizePlatform(o.platform, o.promotionChannel), o.totalAmount || 0, true));

    // Format for ECharts
    const result: Array<Record<string, number | string>> = [];
    const keys: string[] = [];

    // Generate keys based on dimension to ensure continuous axis
    if (dimension === 'week') {
        for (let i = 0; i < 12; i++) {
            const d = new Date(startDate);
            d.setDate(d.getDate() + (i * 7));
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(d.setDate(diff));
            keys.push(monday.toISOString().split('T')[0]);
        }
    } else if (dimension === 'month') {
        for (let i = 0; i < 12; i++) {
            const d = new Date(startDate);
            d.setMonth(startDate.getMonth() + i);
            keys.push(`${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`);
        }
    } else {
        for (let i = 0; i < 15; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            keys.push(d.toISOString().split('T')[0]);
        }
    }

    keys.forEach(key => {
        const stats: Record<string, number | string> = { date: key };
        allPlatforms.forEach(p => {
            // If it's a "2-day" point (daily dimension), we might want to sum up current + next day data if we grouped them in keys
            // But here our keys are discrete days.
            // If we reduced keys above, we need to match aggregation logic.
            // The current aggregation logic in `processOrder` uses exact date as key.
            // So if we only output every 2nd day in `keys`, we will miss data for the skipped days.
            
            // Fix: We need to aggregate data into buckets if we reduce output points.
            // Let's adjust aggregation logic first.
            
            // ACTUALLY, for Platform Trend, let's keep it simple: just show every 2nd day but aggregate 2 days of data?
            // OR just show every 2nd day point?
            
            // Better approach: Let's adjust `keys` generation to be buckets, and update `processOrder` to map to buckets.
            
            // Wait, let's revert to simple approach for PlatformTrend first to avoid complexity explosion in one step.
            // If user said "reduce points", they usually mean x-axis density.
            // Let's aggregation logic match `getTrend`.
            
            // RE-IMPLEMENTING AGGREGATION LOGIC FOR PLATFORM TREND
            // We need to group data into the buckets defined by `keys`.
            
            let count = 0;
            let gmv = 0;
            
            if (dimension === 'day') {
                // Sum current day (key) and next day
                const currentKey = key;
                const nextDate = new Date(key);
                nextDate.setDate(nextDate.getDate() + 1);
                const nextKey = nextDate.toISOString().split('T')[0];
                
                const currentData = aggregatedData[currentKey]?.[p];
                const nextData = aggregatedData[nextKey]?.[p];
                
                count = (currentData?.count || 0) + (nextData?.count || 0);
                gmv = (currentData?.gmv || 0) + (nextData?.gmv || 0);
            } else {
                const data = aggregatedData[key]?.[p];
                count = data?.count || 0;
                gmv = data?.gmv || 0;
            }

            stats[`${p}_count`] = count;
            stats[`${p}_gmv`] = gmv;
        });
        result.push(stats);
    });

    return {
      data: result,
      platforms: Array.from(allPlatforms),
      totals: platformTotals
    };
  }

  private static async getZulinOpsSnapshot(currentStart: Date, previousStart: Date, now: Date) {
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

      const currentStartKey = currentStart.toISOString().split('T')[0];
      const previousStartKey = previousStart.toISOString().split('T')[0];
      const nowKey = now.toISOString().split('T')[0];

      const [summaryRow] = await prisma.$queryRaw<{
        current_exposure: number;
        current_visits: number;
        current_amount: number;
        previous_exposure: number;
        previous_visits: number;
        previous_amount: number;
      }[]>`
        SELECT
          COALESCE(SUM(CASE WHEN data_date >= ${currentStartKey} AND data_date < ${nowKey} THEN exposure ELSE 0 END), 0) AS current_exposure,
          COALESCE(SUM(CASE WHEN data_date >= ${currentStartKey} AND data_date < ${nowKey} THEN visits ELSE 0 END), 0) AS current_visits,
          COALESCE(SUM(CASE WHEN data_date >= ${currentStartKey} AND data_date < ${nowKey} THEN amount ELSE 0 END), 0) AS current_amount,
          COALESCE(SUM(CASE WHEN data_date >= ${previousStartKey} AND data_date < ${currentStartKey} THEN exposure ELSE 0 END), 0) AS previous_exposure,
          COALESCE(SUM(CASE WHEN data_date >= ${previousStartKey} AND data_date < ${currentStartKey} THEN visits ELSE 0 END), 0) AS previous_visits,
          COALESCE(SUM(CASE WHEN data_date >= ${previousStartKey} AND data_date < ${currentStartKey} THEN amount ELSE 0 END), 0) AS previous_amount
        FROM zulin_daily_metrics
      `;

      const currentExposure = Number(summaryRow?.current_exposure || 0);
      const currentVisits = Number(summaryRow?.current_visits || 0);
      const currentAmount = Number(summaryRow?.current_amount || 0);
      const previousExposure = Number(summaryRow?.previous_exposure || 0);
      const previousVisits = Number(summaryRow?.previous_visits || 0);
      const previousAmount = Number(summaryRow?.previous_amount || 0);

      const currentConversion = currentExposure > 0 ? (currentVisits / currentExposure) * 100 : 0;
      const previousConversion = previousExposure > 0 ? (previousVisits / previousExposure) * 100 : 0;
      const conversionDiff = currentConversion - previousConversion;
      const amountGrowth = previousAmount > 0 ? ((currentAmount - previousAmount) / previousAmount) * 100 : (currentAmount > 0 ? 100 : 0);

      const productRows = await prisma.$queryRaw<{
        product_id: string;
        title: string;
        current_amount: number;
        previous_amount: number;
      }[]>`
        SELECT
          product_id,
          title,
          COALESCE(SUM(CASE WHEN data_date >= ${currentStartKey} AND data_date < ${nowKey} THEN amount ELSE 0 END), 0) AS current_amount,
          COALESCE(SUM(CASE WHEN data_date >= ${previousStartKey} AND data_date < ${currentStartKey} THEN amount ELSE 0 END), 0) AS previous_amount
        FROM zulin_daily_metrics
        GROUP BY product_id, title
      `;

      const topProducts = productRows
        .map((item) => {
          const current = Number(item.current_amount || 0);
          const previous = Number(item.previous_amount || 0);
          const growth = previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);
          return {
            productId: item.product_id,
            title: item.title,
            currentAmount: current,
            previousAmount: previous,
            growth,
          };
        })
        .filter((item) => item.currentAmount > 0 || item.previousAmount > 0)
        .sort((a, b) => b.currentAmount - a.currentAmount)
        .slice(0, 5);

      return {
        currentExposure,
        currentVisits,
        currentAmount,
        previousExposure,
        previousVisits,
        previousAmount,
        currentConversion,
        previousConversion,
        conversionDiff,
        amountGrowth,
        topProducts,
      };
    } catch {
      return null;
    }
  }

  private static simplifyZulinLinkName(title: string) {
    const normalized = String(title || '').replace(/\s+/g, ' ').trim();
    if (normalized.length <= 14) {
      return normalized;
    }
    return `${normalized.slice(0, 14)}...`;
  }

  static getDailyOpsCards = unstable_cache(
    async () => {
      const now = new Date();
      const currentStart = new Date(now);
      currentStart.setDate(now.getDate() - 7);
      currentStart.setHours(0, 0, 0, 0);
      const previousStart = new Date(currentStart);
      previousStart.setDate(currentStart.getDate() - 7);

      const [offlineOrders, onlineOrders] = await Promise.all([
        prisma.order.findMany({
          where: {
            createdAt: { gte: previousStart, lt: now },
            status: { in: DashboardService.VALID_STATUSES },
          },
          select: { createdAt: true, platform: true, totalAmount: true },
        }),
        prisma.onlineOrder.findMany({
          where: {
            createdAt: { gte: previousStart, lt: now },
            status: { in: DashboardService.VALID_STATUSES },
          },
          select: { createdAt: true, platform: true, promotionChannel: true, totalAmount: true },
        }),
      ]);

      const currentByPlatform = new Map<string, { gmv: number; orders: number }>();
      const previousByPlatform = new Map<string, { gmv: number; orders: number }>();

      const appendMetric = (target: Map<string, { gmv: number; orders: number }>, platform: string, amount: number) => {
        const existing = target.get(platform) || { gmv: 0, orders: 0 };
        existing.gmv += amount;
        existing.orders += 1;
        target.set(platform, existing);
      };

      const collect = (createdAt: Date, platform: string, amount: number) => {
        const normalizedPlatform = DashboardService.normalizePlatform(platform);
        const target = createdAt >= currentStart ? currentByPlatform : previousByPlatform;
        appendMetric(target, normalizedPlatform, amount);
      };

      offlineOrders.forEach((item) => collect(item.createdAt, item.platform || '', item.totalAmount || 0));
      onlineOrders.forEach((item) => {
        const platform = DashboardService.normalizePlatform(item.platform, item.promotionChannel);
        const target = item.createdAt >= currentStart ? currentByPlatform : previousByPlatform;
        appendMetric(target, platform, item.totalAmount || 0);
      });

      const sumMetrics = (target: Map<string, { gmv: number; orders: number }>, filter?: (platform: string) => boolean) => {
        let gmv = 0;
        let orders = 0;
        target.forEach((value, key) => {
          if (filter && !filter(key)) return;
          gmv += value.gmv;
          orders += value.orders;
        });
        return { gmv, orders, aov: orders > 0 ? gmv / orders : 0 };
      };

      const isControllable = (platform: string) => DashboardService.CONTROLLABLE_PLATFORMS.includes(platform);
      const currentAll = sumMetrics(currentByPlatform);
      const previousAll = sumMetrics(previousByPlatform);
      const currentControllable = sumMetrics(currentByPlatform, isControllable);
      const previousControllable = sumMetrics(previousByPlatform, isControllable);

      const growth = (current: number, previous: number) => {
        if (!previous) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
      };

      const currentShare = currentAll.gmv > 0 ? (currentControllable.gmv / currentAll.gmv) * 100 : 0;
      const previousShare = previousAll.gmv > 0 ? (previousControllable.gmv / previousAll.gmv) * 100 : 0;
      const shareChange = currentShare - previousShare;
      const zulinSnapshot = await DashboardService.getZulinOpsSnapshot(currentStart, previousStart, now);

      const cards: Array<{
        id: string;
        title: string;
        level: 'high' | 'medium' | 'low';
        tag: '可执行' | '观察项';
        scope: 'controllable' | 'all';
        insight: string;
        action: string;
        linkName?: string;
        linkFullName?: string;
        linkId?: string;
        metric: {
          unit: '¥' | '单' | '%';
          current: number;
          previous: number;
          changeRate: number;
        };
      }> = [];

      const controllableGmvGrowth = growth(currentControllable.gmv, previousControllable.gmv);
      const controllableOrderGrowth = growth(currentControllable.orders, previousControllable.orders);
      const allGmvGrowth = growth(currentAll.gmv, previousAll.gmv);

      if (controllableGmvGrowth <= -10) {
        cards.push({
          id: 'controllable-gmv-down',
          title: '可控渠道 GMV 下滑',
          level: 'high',
          tag: '可执行',
          scope: 'controllable',
          insight: `近7天可控渠道 GMV 环比 ${Math.abs(controllableGmvGrowth).toFixed(1)}%`,
          action: '优先检查闲鱼、小程序、赞晨的主推 SKU 价格与投放词，先拉回高销量款曝光',
          metric: { unit: '¥', current: currentControllable.gmv, previous: previousControllable.gmv, changeRate: controllableGmvGrowth },
        });
      }

      if (controllableOrderGrowth <= -10) {
        cards.push({
          id: 'controllable-order-down',
          title: '可控渠道订单量走弱',
          level: 'medium',
          tag: '可执行',
          scope: 'controllable',
          insight: `近7天可控渠道订单量环比 ${Math.abs(controllableOrderGrowth).toFixed(1)}%`,
          action: '核查主力机型标题、首图和成交话术，优先提升点击到咨询转化',
          metric: { unit: '单', current: currentControllable.orders, previous: previousControllable.orders, changeRate: controllableOrderGrowth },
        });
      }

      let bestPlatform = '';
      let bestPlatformGrowth = -Infinity;
      let worstPlatform = '';
      let worstPlatformGrowth = Infinity;
      DashboardService.CONTROLLABLE_PLATFORMS.forEach((platform) => {
        const current = currentByPlatform.get(platform)?.gmv || 0;
        const previous = previousByPlatform.get(platform)?.gmv || 0;
        const g = growth(current, previous);
        if (g > bestPlatformGrowth) {
          bestPlatformGrowth = g;
          bestPlatform = platform;
        }
        if (g < worstPlatformGrowth) {
          worstPlatformGrowth = g;
          worstPlatform = platform;
        }
      });

      if (bestPlatform && bestPlatformGrowth >= 15) {
        cards.push({
          id: 'best-platform-opportunity',
          title: `${bestPlatform} 增长机会`,
          level: 'medium',
          tag: '可执行',
          scope: 'controllable',
          insight: `${bestPlatform} 近7天 GMV 环比增长 ${bestPlatformGrowth.toFixed(1)}%`,
          action: `增加 ${bestPlatform} 的高转化 SKU 供给与预算倾斜，扩大优势`,
          metric: {
            unit: '¥',
            current: currentByPlatform.get(bestPlatform)?.gmv || 0,
            previous: previousByPlatform.get(bestPlatform)?.gmv || 0,
            changeRate: bestPlatformGrowth,
          },
        });
      }

      if (worstPlatform && worstPlatformGrowth <= -15) {
        cards.push({
          id: 'worst-platform-risk',
          title: `${worstPlatform} 需重点修复`,
          level: 'high',
          tag: '可执行',
          scope: 'controllable',
          insight: `${worstPlatform} 近7天 GMV 环比下滑 ${Math.abs(worstPlatformGrowth).toFixed(1)}%`,
          action: `优先排查 ${worstPlatform} 的价格竞争力、活动节奏与客服响应时效`,
          metric: {
            unit: '¥',
            current: currentByPlatform.get(worstPlatform)?.gmv || 0,
            previous: previousByPlatform.get(worstPlatform)?.gmv || 0,
            changeRate: worstPlatformGrowth,
          },
        });
      }

      if (allGmvGrowth > 0 && controllableGmvGrowth < 0) {
        cards.push({
          id: 'structure-divergence',
          title: '结构性背离预警',
          level: 'high',
          tag: '观察项',
          scope: 'all',
          insight: `全渠道 GMV 环比 +${allGmvGrowth.toFixed(1)}%，但可控渠道为 ${controllableGmvGrowth.toFixed(1)}%`,
          action: '避免被全盘增长掩盖可控盘下滑，单独复盘可控渠道商品策略',
          metric: { unit: '%', current: currentShare, previous: previousShare, changeRate: shareChange },
        });
      }

      if (zulinSnapshot && zulinSnapshot.currentExposure > 0) {
        if (zulinSnapshot.conversionDiff <= -1.5) {
          cards.push({
            id: 'zulin-conversion-down',
            title: '芝麻租赁转化率下滑',
            level: 'high',
            tag: '可执行',
            scope: 'controllable',
            insight: `近7天芝麻租赁访问转化率较上期下降 ${Math.abs(zulinSnapshot.conversionDiff).toFixed(2)}pct`,
            action: '优先优化小程序主推商品首图与卖点文案，提升曝光到访问效率',
            metric: {
              unit: '%',
              current: zulinSnapshot.currentConversion,
              previous: zulinSnapshot.previousConversion,
              changeRate: zulinSnapshot.conversionDiff,
            },
          });
        }

        if (zulinSnapshot.amountGrowth <= -12) {
          cards.push({
            id: 'zulin-revenue-down',
            title: '芝麻租赁GMV走弱',
            level: 'high',
            tag: '可执行',
            scope: 'controllable',
            insight: `近7天芝麻租赁交易金额环比 ${Math.abs(zulinSnapshot.amountGrowth).toFixed(1)}%`,
            action: '提高高成交机型的推荐优先级，并同步优化价格梯度与活动节奏',
            metric: {
              unit: '¥',
              current: zulinSnapshot.currentAmount,
              previous: zulinSnapshot.previousAmount,
              changeRate: zulinSnapshot.amountGrowth,
            },
          });
        }

        const bestZulinProduct = zulinSnapshot.topProducts
          .filter((item) => item.currentAmount > 0)
          .sort((a, b) => b.growth - a.growth)[0];

        if (bestZulinProduct && bestZulinProduct.growth >= 20 && bestZulinProduct.currentAmount >= 1000) {
          const linkName = DashboardService.simplifyZulinLinkName(bestZulinProduct.title);
          cards.push({
            id: 'zulin-product-opportunity',
            title: '芝麻租赁爆款机会',
            level: 'medium',
            tag: '可执行',
            scope: 'controllable',
            insight: `${linkName} 近7天交易金额环比增长 ${bestZulinProduct.growth.toFixed(1)}%`,
            action: '复制该款选品与素材策略到同价位机型，扩大可控渠道增量',
            linkName,
            linkFullName: bestZulinProduct.title,
            linkId: bestZulinProduct.productId,
            metric: {
              unit: '¥',
              current: bestZulinProduct.currentAmount,
              previous: bestZulinProduct.previousAmount,
              changeRate: bestZulinProduct.growth,
            },
          });
        }
      }

      cards.push({
        id: 'controllable-share',
        title: '可控渠道贡献占比',
        level: Math.abs(shareChange) >= 5 ? 'medium' : 'low',
        tag: '观察项',
        scope: 'all',
        insight: `当前可控渠道 GMV 占比 ${currentShare.toFixed(1)}%，较上期 ${shareChange >= 0 ? '+' : ''}${shareChange.toFixed(1)}pct`,
        action: '将可控渠道占比作为周目标，稳定提升可控盘在全盘中的权重',
        metric: { unit: '%', current: currentShare, previous: previousShare, changeRate: shareChange },
      });

      return {
        summary: {
          controllable: {
            gmv: currentControllable.gmv,
            orders: currentControllable.orders,
            aov: currentControllable.aov,
            prevGmv: previousControllable.gmv,
            prevOrders: previousControllable.orders,
            prevAov: previousControllable.aov,
          },
          all: {
            gmv: currentAll.gmv,
            orders: currentAll.orders,
            aov: currentAll.aov,
            prevGmv: previousAll.gmv,
            prevOrders: previousAll.orders,
            prevAov: previousAll.aov,
          },
          controllableShare: currentShare,
          prevControllableShare: previousShare,
        },
        cards: cards.slice(0, 8),
        controllablePlatforms: DashboardService.CONTROLLABLE_PLATFORMS,
        generatedAt: now.toISOString(),
      };
    },
    ['dashboard-daily-ops-cards'],
    { revalidate: 300 }
  );

  private static normalizePlatform(platform: string | null | undefined, promotionChannel?: string | null) {
    if (promotionChannel && promotionChannel.includes('支付宝小程序')) return '支付宝小程序';
    if (!platform) return '其他';
    const upper = platform.toUpperCase().trim();
    if (upper === 'UNKNOWN') return '其他';
    if (upper === 'OFFLINE') return '线下';
    if (upper === 'XIANYU' || platform === '闲鱼') return '闲鱼';
    if (/^\d+$/.test(upper) || /^SF\d+$/.test(upper)) return '其他';
    if (upper === 'ZANCHEN') return '赞晨';
    if (upper === 'AOLZU' || platform === '奥租') return '奥租';
    if (upper === 'LLXZU' || platform === '零零享' || platform === '乐乐享租') return '零零享';
    if (upper === 'YOUPIN' || platform === '优品租' || platform === '有品') return '优品租';
    if (upper === 'CHENGLIN' || platform === '诚赁' || platform === '诚林') return '诚赁';
    if (upper === 'RRZ' || platform === '人人租') return '人人租';
    if (platform === '支付宝小程序') return '支付宝小程序';
    return platform;
  }
}
