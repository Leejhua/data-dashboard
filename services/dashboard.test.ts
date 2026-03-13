import { DashboardService } from './dashboard';
import { prisma } from '@/lib/prisma';

// Mock unstable_cache to just run the function
jest.mock('next/cache', () => ({
  unstable_cache: (fn: any) => fn,
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

      // Verify values based on seed data
      // We seeded 50 orders
      expect(summary.totalOrders).toBe(50);
      
      // We seeded 5 promoters, and distributed orders randomly among them
      // With 50 orders, it's highly likely all 5 are active
      expect(summary.activePromoters).toBeLessThanOrEqual(5);
      expect(summary.activePromoters).toBeGreaterThan(0);
      
      // GMV should be positive
      expect(summary.totalGMV).toBeGreaterThan(0);
    });
  });

  describe('getTrend', () => {
    it('should return trend data for the last 7 days', async () => {
      const days = 7;
      const trend = await DashboardService.getTrend(days);
      
      console.log('Trend Result:', trend);

      // Expect an array of length 'days'
      expect(trend).toBeInstanceOf(Array);
      // Currently implemented as returning [], so this might fail if we expect 7 items
      // But let's write the test to EXPECT the correct behavior
      expect(trend.length).toBe(days);
      
      // Check structure of first item
      if (trend.length > 0) {
        expect(trend[0]).toHaveProperty('date');
        expect(trend[0]).toHaveProperty('gmv');
        expect(trend[0]).toHaveProperty('orderCount');
      }
    });
  });
});
