import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';

export async function GET() {
  try {
    const data = await DashboardService.getZulinPanelData();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Dashboard Zulin API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch zulin dashboard data' },
      { status: 500 }
    );
  }
}
