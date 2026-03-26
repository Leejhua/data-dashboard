import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';

export async function GET() {
  try {
    const data = await DashboardService.getZulinPanelData();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
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
