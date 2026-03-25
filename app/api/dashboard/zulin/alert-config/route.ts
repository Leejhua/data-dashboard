import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';

export async function GET() {
  try {
    const data = await DashboardService.getZulinAlertConfig();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Dashboard Zulin Alert Config API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch zulin alert config' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const data = await DashboardService.updateZulinAlertConfig({
      minManagedDays: Number(body?.minManagedDays),
      maxExposure: Number(body?.maxExposure),
      maxVisitRate: Number(body?.maxVisitRate),
      weightExposure: Number(body?.weightExposure),
      weightVisitRate: Number(body?.weightVisitRate),
      weightManagedDays: Number(body?.weightManagedDays),
      minWarningScore: Number(body?.minWarningScore),
      maxWarningItems: Number(body?.maxWarningItems),
    });
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update zulin alert config';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
