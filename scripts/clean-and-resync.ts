import { PrismaClient } from '@prisma/client';
import { ExternalOrderService } from '../services/external-order';
import dotenv from 'dotenv';

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

      for (const ext of response.data) {

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
            source: ext.source || 'RETAIL', 
            platform: ext.platform,
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

      for (const ext of response.data) {

        // Skip orders with obviously bad data
        if (ext.platform === '顺丰速运' || ext.productName === '顺丰速运' || (ext.orderNo && ext.orderNo.length > 50 && ext.orderNo.includes('省'))) {
          console.warn(`Skipping bad order data: ${ext.orderNo.substring(0, 20)}...`);
          continue;
        }

        // Skip orders with obviously bad data if needed, but upsert should handle it if ID matches
        // Here we trust the API to return correct structure now.
        
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
    console.log('Cleaning tables...');
    // Delete all records to start fresh
    // Note: Order table has relations, so we might need to delete related records first 
    // or rely on cascade delete if configured. 
    // But Order has relations to Promoter/Channel/Product/Spec etc.
    // Let's try deleting Orders and OnlineOrders.
    
    await prisma.onlineOrder.deleteMany({});
    console.log('OnlineOrder table cleaned.');
    
    // We need to be careful with Order table deletion due to foreign key constraints if any.
    // But based on schema, Order is usually the child or parent.
    // If Order is deleted, related records like InventoryReservation might block it if not cascade.
    // Let's try deleting Order.
    try {
        await prisma.inventoryReservation.deleteMany({});
        await prisma.inventoryAllocation.deleteMany({});
        await prisma.orderExtension.deleteMany({});
        await prisma.orderLog.deleteMany({});
        await prisma.order.deleteMany({});
        console.log('Order table cleaned.');
    } catch (err) {
        console.warn('Warning during Order table cleanup:', err);
    }

    // Now resync
    // We need to import syncOfflineOrders function logic or just copy it here.
    // To avoid duplication, I will just call the functions defined in this file.
    // But wait, syncOfflineOrders was not defined in this file (clean-and-resync.ts), 
    // I only copied syncOnlineOrders previously.
    // I need to add syncOfflineOrders to this file or import it from sync-orders.ts if I exported it.
    // Since sync-orders.ts didn't export functions, I should probably copy the logic or modify sync-orders.ts to support cleaning.
    
    // Better approach: Let's modify sync-orders.ts to include a "clean" flag or function, 
    // OR just copy syncOfflineOrders here. I will copy it here to be self-contained.
    
    await syncOfflineOrders();
    await syncOnlineOrders();
    
    console.log('Resync completed successfully.');
  } catch (e) {
    console.error('Resync failed:', e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
