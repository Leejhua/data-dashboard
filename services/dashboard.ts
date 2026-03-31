import { prisma } from '@/lib/prisma';
import { unstable_cache } from 'next/cache';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

type ZulinAlertConfig = {
  minManagedDays: number;
  maxExposure: number;
  maxVisitRate: number;
  weightExposure: number;
  weightVisitRate: number;
  weightManagedDays: number;
  minWarningScore: number;
  maxWarningItems: number;
  updatedAt: string;
};

type DailyOpsCard = {
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
};

type DailyOpsLlmStatus = {
  enabled: boolean;
  attempted: boolean;
  used: boolean;
  reason: 'disabled' | 'missing_config' | 'request_failed' | 'empty_content' | 'invalid_json' | 'invalid_cards' | 'success';
  model: string;
  triggeredAt: string;
};

/**
 * Service Layer for Dashboard
 * Handles business logic and data aggregation
 */
export class DashboardService {
  private static readonly VALID_STATUSES = ['COMPLETED', 'PENDING_SHIPMENT', 'RENTING', 'RETURNING', 'PENDING_RECEIPT', 'BOUGHT_OUT', 'SHIPPED_PENDING_CONFIRMATION', 'WAIT_PAY', 'PENDING_REVIEW'];
  private static readonly CONTROLLABLE_PLATFORMS = ['闲鱼', '支付宝小程序', '赞晨'];
  private static readonly ZULIN_TREND_POINTS = 7;
  private static readonly DAILY_OPS_MAX_CARDS = 8;
  static readonly CACHE_TAG_SUMMARY = 'dashboard-summary';
  static readonly CACHE_TAG_ZULIN_PANEL = 'dashboard-zulin-panel';
  static readonly CACHE_TAG_DAILY_OPS = 'dashboard-daily-ops-cards';

  /**
   * 获取每日运营卡片的缓存
   * 如无缓存返回 null
   */
  static async getDailyOpsCardCache(date: string): Promise<{
    cards: DailyOpsCard[];
    model: string;
    triggerSource: string;
    generatedAt: Date;
  } | null> {
    const cache = await prisma.dailyOpsCardCache.findUnique({
      where: { date },
    });
    if (!cache) return null;
    return {
      cards: JSON.parse(cache.cards) as DailyOpsCard[],
      model: cache.model,
      triggerSource: cache.triggerSource,
      generatedAt: cache.generatedAt,
    };
  }

  /**
   * 保存每日运营卡片到缓存
   */
  static async saveDailyOpsCardCache(
    date: string,
    cards: DailyOpsCard[],
    model: string,
    triggerSource: string
  ): Promise<void> {
    await prisma.dailyOpsCardCache.upsert({
      where: { date },
      create: {
        date,
        cards: JSON.stringify(cards),
        model,
        triggerSource,
      },
      update: {
        cards: JSON.stringify(cards),
        model,
        triggerSource,
      },
    });
  }

  private static readonly ZULIN_ALERT_CONFIG_ID = 'default';
  private static readonly ZULIN_ALERT_DEFAULT: Omit<ZulinAlertConfig, 'updatedAt'> = {
    minManagedDays: 5,
    maxExposure: 100,
    maxVisitRate: 8,
    weightExposure: 0.45,
    weightVisitRate: 0.35,
    weightManagedDays: 0.2,
    minWarningScore: 60,
    maxWarningItems: 15,
  };

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
    ['dashboard-summary'],
    { revalidate: 3600, tags: [DashboardService.CACHE_TAG_SUMMARY] }
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

  private static normalizeAlertConfig(raw: Partial<ZulinAlertConfig>) {
    const defaults = DashboardService.ZULIN_ALERT_DEFAULT;
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    const asNumber = (value: unknown, fallback: number) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };
    return {
      minManagedDays: Math.round(clamp(asNumber(raw.minManagedDays, defaults.minManagedDays), 1, 365)),
      maxExposure: Math.round(clamp(asNumber(raw.maxExposure, defaults.maxExposure), 1, 1000000)),
      maxVisitRate: clamp(asNumber(raw.maxVisitRate, defaults.maxVisitRate), 0.1, 100),
      weightExposure: clamp(asNumber(raw.weightExposure, defaults.weightExposure), 0, 1),
      weightVisitRate: clamp(asNumber(raw.weightVisitRate, defaults.weightVisitRate), 0, 1),
      weightManagedDays: clamp(asNumber(raw.weightManagedDays, defaults.weightManagedDays), 0, 1),
      minWarningScore: clamp(asNumber(raw.minWarningScore, defaults.minWarningScore), 0, 100),
      maxWarningItems: Math.round(clamp(asNumber(raw.maxWarningItems, defaults.maxWarningItems), 1, 200)),
    };
  }

  private static async ensureZulinAlertConfigRecord() {
    const now = new Date().toISOString();
    const defaults = DashboardService.ZULIN_ALERT_DEFAULT;
    await prisma.zulinAlertConfig.upsert({
      where: { id: DashboardService.ZULIN_ALERT_CONFIG_ID },
      update: {},
      create: {
        id: DashboardService.ZULIN_ALERT_CONFIG_ID,
        minManagedDays: defaults.minManagedDays,
        maxExposure: defaults.maxExposure,
        maxVisitRate: defaults.maxVisitRate,
        weightExposure: defaults.weightExposure,
        weightVisitRate: defaults.weightVisitRate,
        weightManagedDays: defaults.weightManagedDays,
        minWarningScore: defaults.minWarningScore,
        maxWarningItems: defaults.maxWarningItems,
        updatedAt: now,
      },
    });
  }

  static async getZulinAlertConfig(): Promise<ZulinAlertConfig> {
    await DashboardService.ensureZulinAlertConfigRecord();
    const row = await prisma.zulinAlertConfig.findUnique({
      where: { id: DashboardService.ZULIN_ALERT_CONFIG_ID },
    });
    const normalized = DashboardService.normalizeAlertConfig({
      minManagedDays: row?.minManagedDays,
      maxExposure: row?.maxExposure,
      maxVisitRate: row?.maxVisitRate,
      weightExposure: row?.weightExposure,
      weightVisitRate: row?.weightVisitRate,
      weightManagedDays: row?.weightManagedDays,
      minWarningScore: row?.minWarningScore,
      maxWarningItems: row?.maxWarningItems,
    });
    return {
      ...normalized,
      updatedAt: row?.updatedAt || new Date().toISOString(),
    };
  }

  static async updateZulinAlertConfig(input: Partial<ZulinAlertConfig>): Promise<ZulinAlertConfig> {
    await DashboardService.ensureZulinAlertConfigRecord();
    const current = await DashboardService.getZulinAlertConfig();
    const normalized = DashboardService.normalizeAlertConfig({
      minManagedDays: input.minManagedDays ?? current.minManagedDays,
      maxExposure: input.maxExposure ?? current.maxExposure,
      maxVisitRate: input.maxVisitRate ?? current.maxVisitRate,
      weightExposure: input.weightExposure ?? current.weightExposure,
      weightVisitRate: input.weightVisitRate ?? current.weightVisitRate,
      weightManagedDays: input.weightManagedDays ?? current.weightManagedDays,
      minWarningScore: input.minWarningScore ?? current.minWarningScore,
      maxWarningItems: input.maxWarningItems ?? current.maxWarningItems,
    });
    const now = new Date().toISOString();
    await prisma.zulinAlertConfig.update({
      where: { id: DashboardService.ZULIN_ALERT_CONFIG_ID },
      data: {
        minManagedDays: normalized.minManagedDays,
        maxExposure: normalized.maxExposure,
        maxVisitRate: normalized.maxVisitRate,
        weightExposure: normalized.weightExposure,
        weightVisitRate: normalized.weightVisitRate,
        weightManagedDays: normalized.weightManagedDays,
        minWarningScore: normalized.minWarningScore,
        maxWarningItems: normalized.maxWarningItems,
        updatedAt: now,
      },
    });
    return {
      ...normalized,
      updatedAt: now,
    };
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
        product_id: string;
        title: string;
        exposure: number;
        visits: number;
        amount: number;
        managed_days: number;
      }[]>`
        SELECT
          data_date,
          product_id,
          title,
          COALESCE(exposure, 0) AS exposure,
          COALESCE(visits, 0) AS visits,
          COALESCE(amount, 0) AS amount,
          COALESCE(managed_days, 0) AS managed_days
        FROM zulin_daily_metrics
        ORDER BY product_id ASC, data_date ASC
      `;

      if (!rows.length) {
        return null;
      }

      type ProductPoint = {
        date: string;
        exposure: number;
        visits: number;
        revenue: number;
      };
      const perProductSeries = new Map<string, { title: string; managedDays: number; points: ProductPoint[] }>();
      const allDateKeys = new Set<string>();
      let latestRowDate = '';
      for (const row of rows) {
        const productId = String(row.product_id || '').trim();
        if (!productId) {
          continue;
        }
        const dateKey = String(row.data_date || '').trim();
        if (!dateKey) {
          continue;
        }
        allDateKeys.add(dateKey);
        if (!latestRowDate || dateKey > latestRowDate) {
          latestRowDate = dateKey;
        }
        const current = perProductSeries.get(productId) || { title: '', managedDays: 0, points: [] };
        current.title = String(row.title || current.title || '').trim();
        current.managedDays = Number(row.managed_days || 0);
        current.points.push({
          date: dateKey,
          exposure: Number(row.exposure || 0),
          visits: Number(row.visits || 0),
          revenue: Number(row.amount || 0),
        });
        perProductSeries.set(productId, current);
      }

      const previousDateKey = (dateKey: string) => {
        const date = new Date(`${dateKey}T00:00:00`);
        date.setDate(date.getDate() - 1);
        return DashboardService.dateKey(date);
      };

      const valueAtOrBefore = (points: ProductPoint[], dateKey: string, field: 'exposure' | 'visits' | 'revenue') => {
        let value = 0;
        for (const point of points) {
          if (point.date > dateKey) {
            break;
          }
          value = Number(point[field] || 0);
        }
        return value;
      };

      const calcDayDelta = (points: ProductPoint[], dateKey: string, field: 'exposure' | 'visits' | 'revenue') => {
        const currentValue = valueAtOrBefore(points, dateKey, field);
        const previousValue = valueAtOrBefore(points, previousDateKey(dateKey), field);
        return Math.max(0, currentValue - previousValue);
      };

      const trendRows = Array.from(allDateKeys)
        .sort()
        .map((dateKey) => {
          let exposure = 0;
          let visits = 0;
          let revenue = 0;
          for (const { points } of perProductSeries.values()) {
            exposure += calcDayDelta(points, dateKey, 'exposure');
            visits += calcDayDelta(points, dateKey, 'visits');
            revenue += calcDayDelta(points, dateKey, 'revenue');
          }
          const conversionRate = exposure > 0 ? (visits / exposure) * 100 : 0;
          return {
            date: DashboardService.formatZulinDate(dateKey),
            rawDate: dateKey,
            exposure,
            visits,
            revenue,
            conversionRate,
            conversionRateText: `${conversionRate.toFixed(2)}%`,
          };
        });

      const latest = trendRows.find((item) => item.rawDate === latestRowDate) || trendRows[trendRows.length - 1];
      const trend = DashboardService
        .reduceZulinTrendPoints(trendRows, DashboardService.ZULIN_TREND_POINTS)
        .map((item) => ({
          date: item.date,
          exposure: item.exposure,
          visits: item.visits,
          revenue: item.revenue,
          conversionRate: item.conversionRate,
          conversionRateText: item.conversionRateText,
        }));
      const alertConfig = await DashboardService.getZulinAlertConfig();
      const normalizedProducts = Array.from(perProductSeries.entries())
        .filter(([, item]) => item.points.some((point) => point.date === latestRowDate))
        .map(([productId, item]) => {
          const exposure = calcDayDelta(item.points, latestRowDate, 'exposure');
          const visits = calcDayDelta(item.points, latestRowDate, 'visits');
          const revenue = calcDayDelta(item.points, latestRowDate, 'revenue');
          const managedDays = Number(item.managedDays || 0);
          return {
            productId,
            title: String(item.title || productId),
            exposure,
            visits,
            revenue,
            managedDays,
            conversionRate: exposure > 0 ? (visits / exposure) * 100 : 0,
          };
        });
      const topExposureProducts = [...normalizedProducts]
        .sort((a, b) => b.exposure - a.exposure || b.visits - a.visits)
        .slice(0, 10);
      const warningDenominator = alertConfig.weightExposure + alertConfig.weightVisitRate + alertConfig.weightManagedDays || 1;
      const lowExposureProducts = [...normalizedProducts]
        .map((item) => {
          const exposureRisk = 1 - Math.min(item.exposure / Math.max(alertConfig.maxExposure, 1), 1);
          const visitRateRisk = 1 - Math.min(item.conversionRate / Math.max(alertConfig.maxVisitRate, 0.1), 1);
          const managedDaysRisk = Math.min(item.managedDays / Math.max(alertConfig.minManagedDays * 2, 1), 1);
          const warningScore = ((exposureRisk * alertConfig.weightExposure
            + visitRateRisk * alertConfig.weightVisitRate
            + managedDaysRisk * alertConfig.weightManagedDays) / warningDenominator) * 100;
          return { ...item, warningScore };
        })
        .filter((item) => item.managedDays >= alertConfig.minManagedDays && item.exposure <= alertConfig.maxExposure && item.warningScore >= alertConfig.minWarningScore)
        .sort((a, b) => b.warningScore - a.warningScore || a.exposure - b.exposure || b.managedDays - a.managedDays)
        .slice(0, alertConfig.maxWarningItems);

      return {
        summary: {
          date: latest.date,
          exposure: latest.exposure,
          visits: latest.visits,
          revenue: latest.revenue,
          conversionRate: latest.conversionRateText,
        },
        trend,
        topExposureProducts,
        lowExposureProducts,
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
            topExposureProducts: [],
            lowExposureProducts: [],
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
            topExposureProducts: [],
            lowExposureProducts: [],
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
            topExposureProducts: [],
            lowExposureProducts: [],
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
          topExposureProducts: [],
          lowExposureProducts: [],
          sourceFile: latestFile.name,
        };
      } catch (error) {
        console.error('Load zulin panel data failed:', error);
        return {
          summary: null,
          trend: [],
          topExposureProducts: [],
          lowExposureProducts: [],
          sourceFile: null,
        };
      }
    },
    ['dashboard-zulin-panel'],
    { revalidate: 600, tags: [DashboardService.CACHE_TAG_ZULIN_PANEL] }
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
            const key = DashboardService.dateKey(monday);
            weeks.push(key);
            weeklyData[key] = { gmv: 0, orderCount: 0 };
        }

        rawData.forEach(item => {
            const date = new Date(item.createdAt);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(date.setDate(diff));
            const key = DashboardService.dateKey(monday);
            
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
            const key = DashboardService.monthKey(d);
            months.push(key);
            monthlyData[key] = { gmv: 0, orderCount: 0 };
        }

        rawData.forEach(item => {
            const date = new Date(item.createdAt);
            const key = DashboardService.monthKey(date);
            
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
            const dateString = DashboardService.dateKey(date);
            
            const dayData = rawData.filter(item => {
                const itemDate = DashboardService.dateKey(new Date(item.createdAt));
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
          key = DashboardService.dateKey(monday);
      } else if (dimension === 'month') {
          key = DashboardService.monthKey(date);
      } else {
          key = DashboardService.dateKey(date);
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
            keys.push(DashboardService.dateKey(monday));
        }
    } else if (dimension === 'month') {
        for (let i = 0; i < 12; i++) {
            const d = new Date(startDate);
            d.setMonth(startDate.getMonth() + i);
            keys.push(DashboardService.monthKey(d));
        }
    } else {
        for (let i = 0; i < 15; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            keys.push(DashboardService.dateKey(d));
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
                const nextKey = DashboardService.dateKey(nextDate);
                
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

      const currentStartKey = DashboardService.dateKey(currentStart);
      const previousStartKey = DashboardService.dateKey(previousStart);
      const nowKey = DashboardService.dateKey(now);

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

  private static isDailyOpsLlmEnabled() {
    return String(process.env.DAILY_OPS_LLM_ENABLED || '').trim().toLowerCase() === 'true';
  }

  private static getDailyOpsLlmApiUrl() {
    const custom = String(process.env.DAILY_OPS_LLM_API_URL || '').trim();
    return custom || 'https://api.deepseek.com/chat/completions';
  }

  private static getDailyOpsLlmModel() {
    const custom = String(process.env.DAILY_OPS_LLM_MODEL || '').trim();
    return custom || 'deepseek-chat';
  }

  private static parseLlmJsonObject(content: string) {
    const text = String(content || '').trim();
    if (!text) return null;
    const candidates = [text];
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      candidates.unshift(fenced[1].trim());
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      candidates.push(text.slice(start, end + 1).trim());
    }
    for (const item of candidates) {
      try {
        const parsed = JSON.parse(item) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
      }
    }
    return null;
  }

  static getDailyOpsLlmRuntimeStatus() {
    const enabledRaw = String(process.env.DAILY_OPS_LLM_ENABLED || '');
    const apiKey = String(process.env.DAILY_OPS_LLM_API_KEY || '').trim();
    const apiUrl = DashboardService.getDailyOpsLlmApiUrl();
    const model = DashboardService.getDailyOpsLlmModel();
    return {
      enabled: DashboardService.isDailyOpsLlmEnabled(),
      enabledRaw,
      hasApiKey: Boolean(apiKey),
      apiKeyPrefix: apiKey ? apiKey.slice(0, 6) : '',
      apiKeyLength: apiKey.length,
      apiUrl,
      model,
      nodeEnv: process.env.NODE_ENV || '',
      checkedAt: new Date().toISOString(),
    };
  }

  static async probeDailyOpsLlmConnection() {
    const runtime = DashboardService.getDailyOpsLlmRuntimeStatus();
    if (!runtime.enabled) {
      return { ok: false, reason: 'disabled', ...runtime };
    }
    if (!runtime.hasApiKey || !runtime.apiUrl || !runtime.model) {
      return { ok: false, reason: 'missing_config', ...runtime };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(runtime.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${String(process.env.DAILY_OPS_LLM_API_KEY || '').trim()}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: runtime.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: '你是一个 API 连通性检查助手。' },
            { role: 'user', content: '返回 JSON：{"ok":true}' },
          ],
        }),
      });
      const body = await response.text();
      if (!response.ok) {
        return { ok: false, reason: 'request_failed', statusCode: response.status, bodyPreview: body.slice(0, 300), ...runtime };
      }
      return { ok: true, reason: 'success', statusCode: response.status, bodyPreview: body.slice(0, 300), ...runtime };
    } catch (error) {
      return {
        ok: false,
        reason: 'request_failed',
        error: error instanceof Error ? error.message : 'unknown error',
        ...runtime,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private static sanitizeDailyOpsCards(raw: unknown, fallbackCards: DailyOpsCard[]) {
    if (!Array.isArray(raw)) return null;
    const fallbackMetricById = new Map(fallbackCards.map((item) => [item.id, item.metric]));
    const fallbackLinkById = new Map(
      fallbackCards.map((item) => [item.id, { linkName: item.linkName, linkFullName: item.linkFullName, linkId: item.linkId }])
    );
    const normalizeText = (value: unknown, fallback: string) => {
      const text = String(value || '').trim();
      return text || fallback;
    };
    const toNumber = (value: unknown, fallback: number) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : fallback;
    };
    const cards = raw
      .map((item, index) => {
        const row = item as Record<string, unknown>;
        const fallbackId = fallbackCards[index]?.id || `llm-card-${index + 1}`;
        const id = normalizeText(row.id, fallbackId).replace(/\s+/g, '-');
        const metricRow = (row.metric as Record<string, unknown>) || {};
        const fallbackMetric = fallbackMetricById.get(fallbackId) || { unit: '%', current: 0, previous: 0, changeRate: 0 };
        const level = row.level === 'high' || row.level === 'medium' || row.level === 'low' ? row.level : 'medium';
        const tag = row.tag === '可执行' || row.tag === '观察项' ? row.tag : '观察项';
        const scope = row.scope === 'controllable' || row.scope === 'all' ? row.scope : 'all';
        const unit = metricRow.unit === '¥' || metricRow.unit === '单' || metricRow.unit === '%' ? metricRow.unit : fallbackMetric.unit;
        const fallbackLink = fallbackLinkById.get(fallbackId);
        return {
          id,
          title: normalizeText(row.title, fallbackCards[index]?.title || '运营建议'),
          level,
          tag,
          scope,
          insight: normalizeText(row.insight, fallbackCards[index]?.insight || ''),
          action: normalizeText(row.action, fallbackCards[index]?.action || ''),
          linkName: normalizeText(row.linkName, fallbackLink?.linkName || ''),
          linkFullName: normalizeText(row.linkFullName, fallbackLink?.linkFullName || ''),
          linkId: normalizeText(row.linkId, fallbackLink?.linkId || ''),
          metric: {
            unit,
            current: toNumber(metricRow.current, fallbackMetric.current),
            previous: toNumber(metricRow.previous, fallbackMetric.previous),
            changeRate: toNumber(metricRow.changeRate, fallbackMetric.changeRate),
          },
        } as DailyOpsCard;
      })
      .filter((item) => item.title && item.insight && item.action);
    return cards.length ? cards.slice(0, DashboardService.DAILY_OPS_MAX_CARDS) : null;
  }

  private static async generateDailyOpsCardsWithLlm(input: {
    now: string;
    summary: {
      currentAll: { gmv: number; orders: number; aov: number };
      previousAll: { gmv: number; orders: number; aov: number };
      currentControllable: { gmv: number; orders: number; aov: number };
      previousControllable: { gmv: number; orders: number; aov: number };
      currentShare: number;
      previousShare: number;
      shareChange: number;
    };
    platform: Array<{
      name: string;
      currentGmv: number;
      previousGmv: number;
      currentOrders: number;
      previousOrders: number;
      gmvGrowth: number;
    }>;
    zulinSnapshot: Awaited<ReturnType<typeof DashboardService.getZulinOpsSnapshot>>;
    fallbackCards: DailyOpsCard[];
  }): Promise<{ cards: DailyOpsCard[] | null; status: DailyOpsLlmStatus }> {
    const triggeredAt = new Date().toISOString();
    if (!DashboardService.isDailyOpsLlmEnabled()) {
      console.info('[daily-ops-llm] skip: disabled');
      return {
        cards: null,
        status: { enabled: false, attempted: false, used: false, reason: 'disabled', model: '', triggeredAt },
      };
    }
    const apiUrl = DashboardService.getDailyOpsLlmApiUrl();
    const apiKey = String(process.env.DAILY_OPS_LLM_API_KEY || '').trim();
    const model = DashboardService.getDailyOpsLlmModel();
    if (!apiUrl || !apiKey || !model) {
      console.info('[daily-ops-llm] skip: missing_config');
      return {
        cards: null,
        status: { enabled: true, attempted: false, used: false, reason: 'missing_config', model: model || '', triggeredAt },
      };
    }
    console.info('[daily-ops-llm] attempt', { model, apiUrl });
    console.info('[daily-ops-llm] request_body:', JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '你是电商运营分析助手。基于输入数据生成卡片建议，输出必须是 JSON 对象，结构为 {"cards":[...]}，cards 最多 8 条。每条必须包含 id/title/level/tag/scope/insight/action/metric(unit/current/previous/changeRate)。level 仅 high|medium|low，tag 仅 可执行|观察项，scope 仅 controllable|all，metric.unit 仅 ¥|单|%。不要输出 markdown。',
        },
        {
          role: 'user',
          content: JSON.stringify(input).slice(0, 500) + '...(truncated)',
        },
      ],
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: '你是电商运营分析助手。基于输入数据生成卡片建议，输出必须是 JSON 对象，结构为 {"cards":[...]}，cards 最多 8 条。每条必须包含 id/title/level/tag/scope/insight/action/metric(unit/current/previous/changeRate)。level 仅 high|medium|low，tag 仅 可执行|观察项，scope 仅 controllable|all，metric.unit 仅 ¥|单|%。不要输出 markdown。',
            },
            {
              role: 'user',
              content: JSON.stringify(input),
            },
          ],
        }),
      });
      console.info('[daily-ops-llm] response status:', response.status, 'ok:', response.ok);
      console.info('[daily-ops-llm] response_headers:', [...response.headers.entries()].reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}));
      if (!response.ok) {
        console.info('[daily-ops-llm] failed: request_failed', { status: response.status });
        const body = await response.text();
        console.info('[daily-ops-llm] error_body:', body);
        return {
          cards: null,
          status: { enabled: true, attempted: true, used: false, reason: 'request_failed', model, triggeredAt },
        };
      }
      let rawBody: string;
      try {
        rawBody = await response.text();
      } catch (bodyErr) {
        console.info('[daily-ops-llm] failed: body_read_error', { error: String(bodyErr) });
        return {
          cards: null,
          status: { enabled: true, attempted: true, used: false, reason: 'request_failed', model, triggeredAt },
        };
      }
      console.info('[daily-ops-llm] response_body:', rawBody.slice(0, 1000));
      const result = JSON.parse(rawBody) as
        { choices?: Array<{ message?: { content?: string } }> }
        | null;
      const content = String(result?.choices?.[0]?.message?.content || '').trim();
      if (!content) {
        console.info('[daily-ops-llm] failed: empty_content');
        return {
          cards: null,
          status: { enabled: true, attempted: true, used: false, reason: 'empty_content', model, triggeredAt },
        };
      }
      const parsed = DashboardService.parseLlmJsonObject(content) as { cards?: unknown } | null;
      if (!parsed) {
        console.info('[daily-ops-llm] failed: invalid_json');
        return {
          cards: null,
          status: { enabled: true, attempted: true, used: false, reason: 'invalid_json', model, triggeredAt },
        };
      }
      const cards = DashboardService.sanitizeDailyOpsCards(parsed.cards, input.fallbackCards);
      if (!cards || !cards.length) {
        console.info('[daily-ops-llm] failed: invalid_cards');
        return {
          cards: null,
          status: { enabled: true, attempted: true, used: false, reason: 'invalid_cards', model, triggeredAt },
        };
      }
      console.info('[daily-ops-llm] success', { cards: cards.length, model });
      return {
        cards,
        status: { enabled: true, attempted: true, used: true, reason: 'success', model, triggeredAt },
      };
    } catch {
      console.info('[daily-ops-llm] failed: request_failed');
      return {
        cards: null,
        status: { enabled: true, attempted: true, used: false, reason: 'request_failed', model, triggeredAt },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  static getDailyOpsCards = unstable_cache(
    async () => {
      const now = new Date();
      const today = DashboardService.dateKey(now);

      // 优先从数据库缓存读取
      const dbCache = await DashboardService.getDailyOpsCardCache(today);
      if (dbCache) {
        return {
          summary: null, // 缓存模式不返回 summary，前端需要另外获取
          cards: dbCache.cards,
          controllablePlatforms: DashboardService.CONTROLLABLE_PLATFORMS,
          llm: {
            enabled: true,
            attempted: true,
            used: true,
            reason: 'success' as const,
            model: dbCache.model,
            triggeredAt: dbCache.generatedAt.toISOString(),
          },
          generatedAt: now.toISOString(),
          fromCache: true,
        };
      }

      // 无缓存，继续生成
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

      const cards: DailyOpsCard[] = [];

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

      const platformMetrics = DashboardService.CONTROLLABLE_PLATFORMS.map((name) => {
        const current = currentByPlatform.get(name) || { gmv: 0, orders: 0 };
        const previous = previousByPlatform.get(name) || { gmv: 0, orders: 0 };
        return {
          name,
          currentGmv: current.gmv,
          previousGmv: previous.gmv,
          currentOrders: current.orders,
          previousOrders: previous.orders,
          gmvGrowth: growth(current.gmv, previous.gmv),
        };
      });
      const llmResult = await DashboardService.generateDailyOpsCardsWithLlm({
        now: now.toISOString(),
        summary: {
          currentAll,
          previousAll,
          currentControllable,
          previousControllable,
          currentShare,
          previousShare,
          shareChange,
        },
        platform: platformMetrics,
        zulinSnapshot,
        fallbackCards: cards,
      });
      const finalCards = llmResult.cards && llmResult.cards.length ? llmResult.cards : cards;

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
        cards: finalCards.slice(0, DashboardService.DAILY_OPS_MAX_CARDS),
        controllablePlatforms: DashboardService.CONTROLLABLE_PLATFORMS,
        llm: llmResult.status,
        generatedAt: now.toISOString(),
      };

      // 保存到数据库缓存
      if (llmResult.status.used && finalCards.length > 0) {
        await DashboardService.saveDailyOpsCardCache(
          today,
          finalCards,
          llmResult.status.model,
          'scheduled'
        );
      }
    },
    ['dashboard-daily-ops-cards'],
    { revalidate: 300, tags: [DashboardService.CACHE_TAG_DAILY_OPS] }
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

  private static dateKey(date: Date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
  }

  private static monthKey(date: Date) {
    return DashboardService.dateKey(date).slice(0, 7);
  }
}
