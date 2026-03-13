import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = searchParams.get('days') || 'day';
    
    // Validate dimension
    const dimension = (['day', 'week', 'month'].includes(days) ? days : 'day') as 'day' | 'week' | 'month';

    const data = await DashboardService.getTrend(dimension);
    
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Dashboard Trend API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard trend' },
      { status: 500 }
    );
  }
}
