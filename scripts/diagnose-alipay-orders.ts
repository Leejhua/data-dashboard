import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  console.log('Diagnosing Alipay Mini Program Orders...');

  // Case 1: itemSku is "支付宝小程序"
  const skuOrders = await prisma.onlineOrder.findMany({
    where: {
      itemSku: '支付宝小程序'
    },
    take: 100
  });
  console.log(`Found ${skuOrders.length} orders with itemSku="支付宝小程序".`);
  if (skuOrders.length > 0) {
    // Check if all of them have "顺丰速运" as platform
    const badCount = skuOrders.filter(o => o.platform === '顺丰速运').length;
    console.log(`Of which ${badCount} have platform="顺丰速运".`);
    
    // Print unique patterns
    const patterns = new Set(skuOrders.map(o => `${o.platform}|${o.productName}`));
    console.log('Unique patterns (platform|productName):', Array.from(patterns));
  }

  // Case 2: productName is "顺丰速运"
  const sfOrders = await prisma.onlineOrder.findMany({
    where: {
      productName: '顺丰速运'
    },
    take: 3
  });
  console.log(`\nFound ${sfOrders.length} orders with productName="顺丰速运". Sample:`);
  if (sfOrders.length > 0) {
    console.log(JSON.stringify(sfOrders[0], null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
