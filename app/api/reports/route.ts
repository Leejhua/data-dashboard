
import { NextResponse } from 'next/server';
import { ReportService } from '@/services/report';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const allowedPeriods = ['week', 'biweek', 'month', 'current_week', 'current_month'] as const;
  type ReportPeriod = (typeof allowedPeriods)[number];
  const rawPeriod = searchParams.get('period');
  const period: ReportPeriod = (rawPeriod && allowedPeriods.includes(rawPeriod as ReportPeriod))
    ? (rawPeriod as ReportPeriod)
    : 'week';

  try {
    const data = await ReportService.getReportData(period);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching report data:', error);
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 });
  }
}
