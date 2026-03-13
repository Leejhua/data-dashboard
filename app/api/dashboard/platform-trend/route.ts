import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = searchParams.get('days') || 'day';
    
    // Validate dimension
    const dimension = (['day', 'week', 'month'].includes(days) ? days : 'day') as 'day' | 'week' | 'month';
    
    const data = await DashboardService.getPlatformTrend(dimension);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Platform Trend API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch platform trend data' },
      { status: 500 }
    );
  }
}
