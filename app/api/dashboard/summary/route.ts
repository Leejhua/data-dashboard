import { NextResponse } from 'next/server';
import { DashboardService } from '@/services/dashboard';

export async function GET() {
  try {
    const data = await DashboardService.getSummary();
    
    // Add Cache-Control header to browser to cache for 60s
    // But data is generated from unstable_cache (1 hour)
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    console.error('Dashboard Summary API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard summary' },
      { status: 500 }
    );
  }
}
