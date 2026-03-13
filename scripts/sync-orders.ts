import { PrismaClient } from '@prisma/client';
import { ExternalOrderService } from '../services/external-order';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

async function syncOfflineOrders() {
  console.log('Starting offline orders sync (Order model)...');
  let page = 1;
  const pageSize = 50;
  let totalProcessed = 0;

  // Ensure default relations exist
  const defaultPromoter = await prisma.promoter.findFirst();
  const defaultChannel = await prisma.channelConfig.findFirst();

  if (!defaultPromoter || !defaultChannel) {
    console.error('Error: No Promoter or ChannelConfig found. Please seed the database first.');
    return;
  }

  while (true) {
    try {
      console.log(`Fetching offline orders page ${page}...`);
      const response = await ExternalOrderService.fetchOrders({ page, pageSize });
      
      if (!response.data || response.data.length === 0) {
        break;
      }

      for (const order of response.data) {
        // Map external order to local Order schema
        // Note: We use 'as any' for some fields because the external API type definition 
        // in our service might not perfectly match the runtime data, 
        // and we need to handle potential missing fields with defaults.
        const ext = order as any;

        await prisma.order.upsert({
          where: { orderNo: ext.orderNo },
          update: {
            status: ext.status,
            totalAmount: Number(ext.totalAmount) || 0,
            productName: ext.productName || 'Unknown Product',
            platform: ext.platform,
            recipientName: ext.recipientName,
            recipientPhone: ext.recipientPhone,
            address: ext.address || 'No Address',
            trackingNumber: ext.trackingNumber,
            updatedAt: new Date(ext.updatedAt),
            logisticsCompany: ext.logisticsCompany,
            rentStartDate: ext.rentStartDate ? new Date(ext.rentStartDate) : null,
            returnDeadline: ext.returnDeadline ? new Date(ext.returnDeadline) : null,
          },
          create: {
            orderNo: ext.orderNo,
            status: ext.status,
            source: ext.source || 'RETAIL', // Default source
            platform: ext.platform,
            
            // Required fields in local schema that might be missing in API response
            customerXianyuId: ext.customerXianyuId || 'N/A',
            sourceContact: ext.sourceContact || 'N/A',
            productName: ext.productName || 'Unknown Product',
            variantName: ext.variantName || 'Default',
            
            duration: Number(ext.duration) || 30,
            rentPrice: Number(ext.rentPrice) || 0,
            deposit: Number(ext.deposit) || 0,
            insurancePrice: Number(ext.insurancePrice) || 0,
            totalAmount: Number(ext.totalAmount) || 0,
            
            address: ext.address || 'No Address',
            recipientName: ext.recipientName,
            recipientPhone: ext.recipientPhone,
            logisticsCompany: ext.logisticsCompany,
            trackingNumber: ext.trackingNumber,
            
            rentStartDate: ext.rentStartDate ? new Date(ext.rentStartDate) : null,
            returnDeadline: ext.returnDeadline ? new Date(ext.returnDeadline) : null,
            
            creatorId: 'sync-script',
            creatorName: ext.creatorName || 'System Sync',
            
            // Link to existing relations
            promoterId: defaultPromoter.id,
            channelId: defaultChannel.id,
            
            createdAt: new Date(ext.createdAt),
            updatedAt: new Date(ext.updatedAt),
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

      // DEBUG: Log the first order to inspect structure
      if (page === 1) {
        console.log('DEBUG: First Online Order Raw Data:', JSON.stringify(response.data[0], null, 2));
        break; // Stop after first page for debugging
      }

      for (const order of response.data) {
        const ext = order as any;

        // Skip orders with obviously bad data
        if (ext.platform === '顺丰速运' || ext.productName === '顺丰速运' || (ext.orderNo && ext.orderNo.length > 50 && ext.orderNo.includes('省'))) {
          console.warn(`Skipping bad order data: ${ext.orderNo.substring(0, 20)}...`);
          continue;
        }

        await prisma.onlineOrder.upsert({
          where: { orderNo: ext.orderNo },
          update: {
            status: ext.status,
            totalAmount: Number(ext.totalAmount) || 0,
            productName: ext.productName,
            platform: ext.platform,
            merchantName: ext.merchantName,
            recipientPhone: ext.recipientPhone,
            address: ext.address,
            logisticsCompany: ext.logisticsCompany,
            trackingNumber: ext.trackingNumber,
            updatedAt: new Date(ext.updatedAt),
          },
          create: {
            orderNo: ext.orderNo,
            platform: ext.platform,
            status: ext.status,
            merchantName: ext.merchantName,
            productName: ext.productName,
            variantName: ext.variantName,
            itemTitle: ext.itemTitle,
            itemSku: ext.itemSku,
            
            totalAmount: Number(ext.totalAmount) || 0,
            rentPrice: Number(ext.rentPrice) || 0,
            deposit: Number(ext.deposit) || 0,
            insurancePrice: Number(ext.insurancePrice) || 0,
            duration: Number(ext.duration) || 0,
            
            promotionChannel: ext.promotionChannel,
            source: ext.source,
            customerName: ext.customerName,
            recipientPhone: ext.recipientPhone,
            address: ext.address,
            
            logisticsCompany: ext.logisticsCompany,
            trackingNumber: ext.trackingNumber,
            
            rentStartDate: ext.rentStartDate ? new Date(ext.rentStartDate) : null,
            returnDeadline: ext.returnDeadline ? new Date(ext.returnDeadline) : null,
            
            createdAt: new Date(ext.createdAt),
            updatedAt: new Date(ext.updatedAt),
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
    // await syncOfflineOrders();
    await syncOnlineOrders();
    console.log('Sync completed successfully.');
  } catch (e) {
    console.error('Sync failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
