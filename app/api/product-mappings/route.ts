import { NextResponse } from 'next/server';
import { OrderService } from '@/services/order';

export async function GET() {
  try {
    const data = await OrderService.getProductMappingData();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Product Mapping API Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch product mappings' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const productSpecId = String(body?.productSpecId || body?.specId || '').trim();
    const productId = String(body?.productId || '').trim();

    if (!productSpecId || !productId) {
      return NextResponse.json(
        { error: 'productSpecId and productId are required' },
        { status: 400 }
      );
    }

    const updated = await OrderService.updateProductMapping({
      productSpecId,
      productId,
    });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update mapping';
    const statusCode = message === 'SPEC_NOT_FOUND' || message === 'PRODUCT_NOT_FOUND' ? 404 : message === 'MAPPING_PARAMS_REQUIRED' ? 400 : 500;
    return NextResponse.json(
      { error: message },
      { status: statusCode }
    );
  }
}
