import { NextResponse } from 'next/server';
import { OrderService } from '@/services/order';
import ExcelJS from 'exceljs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const status = searchParams.get('status') || undefined;
    const orderNo = searchParams.get('orderNo') || undefined;
    const platform = searchParams.get('platform') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    // Get all matching orders (no pagination)
    const orders = await OrderService.getAllOrdersForExport({
      status,
      orderNo,
      platform,
      startDate,
      endDate,
    });

    // Create Workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');

    // Define Columns
    worksheet.columns = [
      { header: '订单号', key: 'orderNo', width: 25 },
      { header: '商品名称', key: 'productName', width: 20 },
      { header: '平台', key: 'platform', width: 10 },
      { header: '状态', key: 'status', width: 10 },
      { header: '总金额', key: 'totalAmount', width: 12 },
      { header: '收件人', key: 'recipientName', width: 15 },
      { header: '收件人电话', key: 'recipientPhone', width: 15 },
      { header: '收件地址', key: 'address', width: 30 },
      { header: '物流单号', key: 'trackingNumber', width: 20 },
      { header: '推广员', key: 'promoterName', width: 15 },
      { header: '创建时间', key: 'createdAt', width: 20 },
    ];

    // Add Data
    orders.forEach((order) => {
      worksheet.addRow({
        orderNo: order.orderNo,
        productName: order.productName,
        platform: order.platform,
        status: order.status,
        totalAmount: order.totalAmount,
        recipientName: order.recipientName || '-',
        recipientPhone: order.recipientPhone || '-',
        address: order.address || '-',
        trackingNumber: order.trackingNumber || '-',
        promoterName: order.promoter?.name || '-',
        createdAt: order.createdAt.toISOString().split('T')[0],
      });
    });

    // Write to buffer
    const buffer = await workbook.xlsx.writeBuffer();

    // Return response with correct headers
    // Using simple buffer response for now
    return new NextResponse(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="orders-${Date.now()}.xlsx"`,
      },
    });
  } catch (error) {
    console.error('Export API Error:', error);
    return NextResponse.json(
      { error: 'Failed to export orders' },
      { status: 500 }
    );
  }
}
