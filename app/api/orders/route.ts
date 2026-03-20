import { NextResponse } from 'next/server';
import { OrderService } from '@/services/order';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');

    if (mode === 'product-mapping') {
      const data = await OrderService.getProductMappingData();
      return NextResponse.json(data);
    }
    
    // Parse query params
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '10', 10);
    const status = searchParams.get('status') || undefined;
    const orderNo = searchParams.get('orderNo') || undefined;
    const platform = searchParams.get('platform') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const result = await OrderService.getOrders({
      page,
      pageSize,
      status,
      orderNo,
      platform,
      startDate,
      endDate,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Orders API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode');
    if (mode !== 'product-mapping') {
      return NextResponse.json(
        { error: 'Unsupported patch mode' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const itemTypeId = String(body?.itemTypeId || body?.specId || body?.productId || '').trim();
    const keywords = Array.isArray(body?.keywords) ? body.keywords : [];

    if (!itemTypeId) {
      return NextResponse.json(
        { error: 'itemTypeId is required' },
        { status: 400 }
      );
    }

    const updated = await OrderService.updateProductKeywords(itemTypeId, keywords);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update mapping';
    const statusCode = message === 'ITEM_TYPE_NOT_FOUND' ? 404 : 500;
    return NextResponse.json(
      { error: message },
      { status: statusCode }
    );
  }
}
