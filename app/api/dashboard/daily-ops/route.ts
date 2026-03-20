import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';

export async function GET() {
  try {
    const data = await DashboardService.getDailyOpsCards();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Dashboard Daily Ops API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch daily ops cards' },
      { status: 500 }
    );
  }
}
