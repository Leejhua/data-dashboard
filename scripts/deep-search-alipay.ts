import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  console.log('Deep searching for "支付宝小程序"...');

  const term = '支付宝小程序';

  const results = await prisma.onlineOrder.findMany({
    where: {
      OR: [
        { platform: { contains: term } },
        { source: { contains: term } },
        { promotionChannel: { contains: term } },
        { merchantName: { contains: term } },
        { productName: { contains: term } },
        { itemSku: { contains: term } },
        { itemTitle: { contains: term } },
      ]
    },
    take: 10
  });

  console.log(`Found ${results.length} orders containing "${term}".`);
  
  if (results.length > 0) {
    console.log('Sample result:', JSON.stringify(results[0], null, 2));
    
    // Analyze distribution
    const fieldAnalysis: Record<string, number> = {};
    for (const res of results) {
        if (res.platform?.includes(term)) fieldAnalysis['platform'] = (fieldAnalysis['platform'] || 0) + 1;
        if (res.source?.includes(term)) fieldAnalysis['source'] = (fieldAnalysis['source'] || 0) + 1;
        if (res.promotionChannel?.includes(term)) fieldAnalysis['promotionChannel'] = (fieldAnalysis['promotionChannel'] || 0) + 1;
        if (res.merchantName?.includes(term)) fieldAnalysis['merchantName'] = (fieldAnalysis['merchantName'] || 0) + 1;
        if (res.itemSku?.includes(term)) fieldAnalysis['itemSku'] = (fieldAnalysis['itemSku'] || 0) + 1;
    }
    console.log('Field distribution:', fieldAnalysis);
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
