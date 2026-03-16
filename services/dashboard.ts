import { prisma } from '@/lib/prisma';
import { unstable_cache } from 'next/cache';

/**
 * Service Layer for Dashboard
 * Handles business logic and data aggregation
 */
export class DashboardService {
  private static readonly VALID_STATUSES = ['COMPLETED', 'PENDING', 'PENDING_SHIPMENT'];

  /**
   * Get summary metrics for the dashboard
   * Caches the result for 1 hour to improve performance
   */
  static getSummary = unstable_cache(
    async () => {
      // Parallel execution for performance
      const [totalGMV, totalOrders, activePromoters, prevTotalGMV, prevTotalOrders] = await Promise.all([
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
      ]);

      return {
        totalGMV: totalGMV._sum.totalAmount || 0,
        totalOrders,
        activePromoters,
        recentGMV: prevTotalGMV._sum.totalAmount || 0,
        recentOrders: prevTotalOrders,
      };
    },
    ['dashboard-summary'], // Cache key
    { revalidate: 3600 }   // Revalidate every 1 hour (3600 seconds)
  );
  
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
    const prevEndDate = new Date(startDate);
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

    // Map platform names
    const mapPlatform = (p: string | null, channel?: string | null) => {
      if (channel && channel.includes('支付宝小程序')) return '支付宝小程序';
      
      if (!p) return '其他';
      const upper = p.toUpperCase().trim();
      
      // Handle dirty data and specific mappings
      if (upper === 'UNKNOWN') return '其他';
      if (upper === 'OFFLINE') return '线下';
      if (upper === 'XIANYU' || p === '闲鱼') return '闲鱼';
      
      // Filter out numeric IDs or tracking numbers (e.g. "54", "SF3266888233345")
      if (/^\d+$/.test(upper) || /^SF\d+$/.test(upper)) return '其他';

      if (upper === 'ZANCHEN') return '赞晨';
      if (upper === 'AOLZU' || p === '奥租') return '奥租';
      if (upper === 'LLXZU' || p === '零零享' || p === '乐乐享租') return '零零享';
      if (upper === 'YOUPIN' || p === '优品租' || p === '有品') return '优品租';
      if (upper === 'CHENGLIN' || p === '诚赁' || p === '诚林') return '诚赁';
      if (upper === 'RRZ' || p === '人人租') return '人人租';
      if (p === '支付宝小程序') return '支付宝小程序';
      return p;
    };

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

    offlineOrders.forEach(o => processOrder(o.createdAt, mapPlatform(o.platform), o.totalAmount || 0));
    onlineOrders.forEach(o => processOrder(o.createdAt, mapPlatform(o.platform, o.promotionChannel), o.totalAmount || 0));
    
    // Process previous period data
    prevOfflineOrders.forEach(o => processOrder(o.createdAt, mapPlatform(o.platform), o.totalAmount || 0, true));
    prevOnlineOrders.forEach(o => processOrder(o.createdAt, mapPlatform(o.platform, o.promotionChannel), o.totalAmount || 0, true));

    // Format for ECharts
    const result: Record<string, any>[] = [];
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
        const stats: Record<string, any> = { date: key };
        allPlatforms.forEach(p => {
            const platformData = aggregatedData[key]?.[p];
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
}
