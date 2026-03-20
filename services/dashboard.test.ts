import { DashboardService } from './dashboard';
import { prisma } from '@/lib/prisma';

// Mock unstable_cache to just run the function
jest.mock('next/cache', () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

describe('DashboardService', () => {
  beforeAll(async () => {
    // Database is already seeded by prisma/seed.ts
    // We assume the state from the seed script
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('getSummary', () => {
    it('should return correct summary metrics', async () => {
      const summary = await DashboardService.getSummary();
      
      console.log('Summary Result:', summary);

      // Verify structure
      expect(summary).toHaveProperty('totalGMV');
      expect(summary).toHaveProperty('totalOrders');
      expect(summary).toHaveProperty('activePromoters');

      expect(summary.totalOrders).toBeGreaterThan(0);
      expect(summary.activePromoters).toBeLessThanOrEqual(summary.totalOrders);
      expect(summary.activePromoters).toBeGreaterThan(0);
      
      // GMV should be positive
      expect(summary.totalGMV).toBeGreaterThan(0);

      const zulinPanelData = await DashboardService.getZulinPanelData();
      if (summary.zulinSummary && zulinPanelData.summary) {
        expect(summary.zulinSummary.date).toBe(zulinPanelData.summary.date);
        expect(summary.zulinSummary.exposure).toBe(zulinPanelData.summary.exposure);
        expect(summary.zulinSummary.visits).toBe(zulinPanelData.summary.visits);
        expect(summary.zulinSummary.revenue).toBe(zulinPanelData.summary.revenue);
      }
    });
  });

  describe('getZulinPanelData', () => {
    it('should return zulin summary and reduced trend points', async () => {
      const panel = await DashboardService.getZulinPanelData();

      expect(panel).toHaveProperty('summary');
      expect(panel).toHaveProperty('trend');
      expect(panel).toHaveProperty('sourceFile');
      expect(Array.isArray(panel.trend)).toBe(true);
      expect(panel.trend.length).toBeLessThanOrEqual(7);

      if (panel.summary) {
        expect(typeof panel.summary.date).toBe('string');
        expect(panel.summary.exposure).toBeGreaterThanOrEqual(0);
        expect(panel.summary.visits).toBeGreaterThanOrEqual(0);
        expect(panel.summary.revenue).toBeGreaterThanOrEqual(0);
      }

      if (panel.summary && panel.trend.length > 0) {
        const latest = panel.trend[panel.trend.length - 1];
        expect(latest.date).toBe(panel.summary.date);
        expect(latest.exposure).toBe(panel.summary.exposure);
        expect(latest.visits).toBe(panel.summary.visits);
        expect(latest.revenue).toBe(panel.summary.revenue);
      }
    });
  });

  describe('getTrend', () => {
    it('should return trend data for day dimension', async () => {
      const trend = await DashboardService.getTrend('day');
      
      console.log('Trend Result:', trend);

      expect(trend).toBeInstanceOf(Array);
      expect(trend.length).toBe(15);
      
      // Check structure of first item
      if (trend.length > 0) {
        expect(trend[0]).toHaveProperty('date');
        expect(trend[0]).toHaveProperty('gmv');
        expect(trend[0]).toHaveProperty('orderCount');
      }
    });
  });
});
