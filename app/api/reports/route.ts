
import { NextResponse } from 'next/server';
import { ReportService } from '@/services/report';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') as 'week' | 'biweek' | 'month' || 'week';

  try {
    const data = await ReportService.getReportData(period);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching report data:', error);
    return NextResponse.json({ error: 'Failed to fetch report data' }, { status: 500 });
  }
}
