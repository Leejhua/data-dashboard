import { PrismaClient } from '@prisma/client';
import { ExternalOrderService } from '../services/external-order';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toDate = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const toText = (value: unknown, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const specIdCache = new Map<string, string | null>();
const specBizIdCache = new Map<string, string | null>();

async function resolveLocalSpec(specId?: string | null, specBizId?: string | null) {
  const byId = toText(specId);
  if (byId) {
    if (specIdCache.has(byId)) {
      return specIdCache.get(byId) || null;
    }
    const matchedById = await prisma.productSpec.findUnique({
      where: { id: byId },
      select: { id: true },
    });
    const value = matchedById?.id || null;
    specIdCache.set(byId, value);
    if (value) return value;
  }

  const byBizId = toText(specBizId);
  if (byBizId) {
    if (specBizIdCache.has(byBizId)) {
      return specBizIdCache.get(byBizId) || null;
    }
    const matchedByBizId = await prisma.productSpec.findUnique({
      where: { specId: byBizId },
      select: { id: true },
    });
    const value = matchedByBizId?.id || null;
    specBizIdCache.set(byBizId, value);
    return value;
  }

  return null;
}

async function syncOfflineOrders() {
  console.log('Starting offline orders sync (Order model)...');
  let page = 1;
  const pageSize = 50;
  let totalProcessed = 0;

  while (true) {
    try {
      console.log(`Fetching offline orders page ${page}...`);
      const response = await ExternalOrderService.fetchOrders({ page, pageSize });
      
      if (!response.data || response.data.length === 0) {
        break;
      }

      for (const ext of response.data) {
        const localSpecId = await resolveLocalSpec(ext.specId, ext.spec?.specId);
        const localSpec = localSpecId
          ? await prisma.productSpec.findUnique({
              where: { id: localSpecId },
              select: { productId: true },
            })
          : null;
        const localProductId = localSpec?.productId || null;
        const createdAt = toDate(ext.createdAt) || new Date();
        const updatedAt = toDate(ext.updatedAt) || createdAt;

        await prisma.order.upsert({
          where: { orderNo: ext.orderNo },
          update: {
            source: toText(ext.source, 'RETAIL'),
            status: toText(ext.status, 'UNKNOWN'),
            totalAmount: toNumber(ext.totalAmount),
            productName: toText(ext.productName, 'Unknown Product'),
            variantName: toText(ext.variantName, 'Default'),
            platform: toText(ext.platform, 'UNKNOWN'),
            customerXianyuId: toText(ext.customerXianyuId, 'N/A'),
            sourceContact: toText(ext.sourceContact, 'N/A'),
            sn: ext.sn || null,
            recipientName: ext.recipientName,
            recipientPhone: ext.recipientPhone,
            address: toText(ext.address, 'No Address'),
            duration: toNumber(ext.duration, 30),
            rentPrice: toNumber(ext.rentPrice),
            deposit: toNumber(ext.deposit),
            insurancePrice: toNumber(ext.insurancePrice),
            overdueFee: ext.overdueFee === null || ext.overdueFee === undefined ? null : toNumber(ext.overdueFee),
            trackingNumber: ext.trackingNumber,
            latestLogisticsInfo: ext.latestLogisticsInfo || null,
            returnLogisticsCompany: ext.returnLogisticsCompany || null,
            returnTrackingNumber: ext.returnTrackingNumber || null,
            returnLatestLogisticsInfo: ext.returnLatestLogisticsInfo || null,
            rentStartDate: toDate(ext.rentStartDate),
            returnDeadline: toDate(ext.returnDeadline),
            deliveryTime: toDate(ext.deliveryTime),
            actualDeliveryTime: toDate(ext.actualDeliveryTime),
            completedAt: toDate(ext.completedAt),
            remark: ext.remark || null,
            specId: localSpecId,
            productId: localProductId,
            updatedAt,
            logisticsCompany: ext.logisticsCompany,
            creatorName: toText(ext.creatorName, 'System Sync'),
          },
          create: {
            orderNo: ext.orderNo,
            status: toText(ext.status, 'UNKNOWN'),
            source: toText(ext.source, 'RETAIL'),
            platform: toText(ext.platform, 'UNKNOWN'),
            
            customerXianyuId: toText(ext.customerXianyuId, 'N/A'),
            sourceContact: toText(ext.sourceContact, 'N/A'),
            productName: toText(ext.productName, 'Unknown Product'),
            variantName: toText(ext.variantName, 'Default'),
            sn: ext.sn || null,
            
            duration: toNumber(ext.duration, 30),
            rentPrice: toNumber(ext.rentPrice),
            deposit: toNumber(ext.deposit),
            insurancePrice: toNumber(ext.insurancePrice),
            overdueFee: ext.overdueFee === null || ext.overdueFee === undefined ? null : toNumber(ext.overdueFee),
            totalAmount: toNumber(ext.totalAmount),
            
            address: toText(ext.address, 'No Address'),
            recipientName: ext.recipientName,
            recipientPhone: ext.recipientPhone,
            logisticsCompany: ext.logisticsCompany,
            trackingNumber: ext.trackingNumber,
            latestLogisticsInfo: ext.latestLogisticsInfo || null,
            returnLogisticsCompany: ext.returnLogisticsCompany || null,
            returnTrackingNumber: ext.returnTrackingNumber || null,
            returnLatestLogisticsInfo: ext.returnLatestLogisticsInfo || null,
            
            rentStartDate: toDate(ext.rentStartDate),
            returnDeadline: toDate(ext.returnDeadline),
            deliveryTime: toDate(ext.deliveryTime),
            actualDeliveryTime: toDate(ext.actualDeliveryTime),
            completedAt: toDate(ext.completedAt),
            remark: ext.remark || null,
            specId: localSpecId,
            productId: localProductId,
            
            creatorId: 'sync-script',
            creatorName: toText(ext.creatorName, 'System Sync'),
            
            createdAt,
            updatedAt,
          },
        });
      }

      totalProcessed += response.data.length;
      console.log(`Processed ${totalProcessed} offline orders.`);

      if (response.data.length < pageSize) {
        break;
      }
      page++;
    } catch (error) {
      console.error('Error syncing offline orders:', error);
      break;
    }
  }
}

async function syncOnlineOrders() {
  console.log('Starting online orders sync (OnlineOrder model)...');
  let page = 1;
  const pageSize = 50;
  let totalProcessed = 0;

  while (true) {
    try {
      console.log(`Fetching online orders page ${page}...`);
      const response = await ExternalOrderService.fetchOnlineOrders({ page, pageSize });
      
      if (!response.data || response.data.length === 0) {
        break;
      }

      for (const ext of response.data) {
        const localSpecId = await resolveLocalSpec(ext.specId, ext.spec?.specId);
        const localSpec = localSpecId
          ? await prisma.productSpec.findUnique({
              where: { id: localSpecId },
              select: { productId: true },
            })
          : null;
        const localProductId = localSpec?.productId || null;
        const createdAt = toDate(ext.createdAt) || new Date();
        const updatedAt = toDate(ext.updatedAt) || createdAt;

        if (ext.platform === '顺丰速运' || ext.productName === '顺丰速运' || (ext.orderNo && ext.orderNo.length > 50 && ext.orderNo.includes('省'))) {
          console.warn(`Skipping bad order data: ${ext.orderNo.substring(0, 20)}...`);
          continue;
        }

        await prisma.onlineOrder.upsert({
          where: { orderNo: ext.orderNo },
          update: {
            status: toText(ext.status, 'UNKNOWN'),
            totalAmount: toNumber(ext.totalAmount),
            productName: ext.productName,
            variantName: ext.variantName,
            platform: toText(ext.platform, 'UNKNOWN'),
            merchantName: ext.merchantName,
            itemTitle: ext.itemTitle,
            itemSku: ext.itemSku,
            rentPrice: toNumber(ext.rentPrice),
            deposit: toNumber(ext.deposit),
            insurancePrice: toNumber(ext.insurancePrice),
            duration: toNumber(ext.duration),
            source: ext.source || null,
            customerName: ext.customerName || null,
            promotionChannel: ext.promotionChannel || null,
            recipientPhone: ext.recipientPhone,
            address: ext.address,
            logisticsCompany: ext.logisticsCompany,
            trackingNumber: ext.trackingNumber,
            latestLogisticsInfo: ext.latestLogisticsInfo || null,
            returnLogisticsCompany: ext.returnLogisticsCompany || null,
            returnTrackingNumber: ext.returnTrackingNumber || null,
            returnLatestLogisticsInfo: ext.returnLatestLogisticsInfo || null,
            rentStartDate: toDate(ext.rentStartDate),
            returnDeadline: toDate(ext.returnDeadline),
            manualSn: ext.manualSn || null,
            specId: localSpecId,
            productId: localProductId,
            updatedAt,
          },
          create: {
            orderNo: ext.orderNo,
            platform: toText(ext.platform, 'UNKNOWN'),
            status: toText(ext.status, 'UNKNOWN'),
            merchantName: ext.merchantName,
            productName: ext.productName,
            variantName: ext.variantName,
            itemTitle: ext.itemTitle,
            itemSku: ext.itemSku,
            
            totalAmount: toNumber(ext.totalAmount),
            rentPrice: toNumber(ext.rentPrice),
            deposit: toNumber(ext.deposit),
            insurancePrice: toNumber(ext.insurancePrice),
            duration: toNumber(ext.duration),
            
            promotionChannel: ext.promotionChannel,
            source: ext.source,
            customerName: ext.customerName,
            recipientPhone: ext.recipientPhone,
            address: ext.address,
            
            logisticsCompany: ext.logisticsCompany,
            trackingNumber: ext.trackingNumber,
            latestLogisticsInfo: ext.latestLogisticsInfo || null,
            returnLogisticsCompany: ext.returnLogisticsCompany || null,
            returnTrackingNumber: ext.returnTrackingNumber || null,
            returnLatestLogisticsInfo: ext.returnLatestLogisticsInfo || null,
            
            rentStartDate: toDate(ext.rentStartDate),
            returnDeadline: toDate(ext.returnDeadline),
            manualSn: ext.manualSn || null,
            specId: localSpecId,
            productId: localProductId,
            
            createdAt,
            updatedAt,
          },
        });
      }

      totalProcessed += response.data.length;
      console.log(`Processed ${totalProcessed} online orders.`);

      if (response.data.length < pageSize) {
        break;
      }
      page++;
    } catch (error) {
      console.error('Error syncing online orders:', error);
      break;
    }
  }
}

async function main() {
  try {
    await syncOfflineOrders();
    await syncOnlineOrders();
    console.log('Sync completed successfully.');
  } catch (e) {
    console.error('Sync failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
