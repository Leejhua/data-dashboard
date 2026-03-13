import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  // Find orders where merchantName looks like a date
  const badOrders = await prisma.onlineOrder.findMany({
    where: {
      merchantName: {
        contains: '202', // Simple check for year
      }
    },
    take: 5
  });

  console.log('Found potential bad orders:', badOrders.length);
  if (badOrders.length > 0) {
    console.log('Sample bad order:', JSON.stringify(badOrders[0], null, 2));
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
