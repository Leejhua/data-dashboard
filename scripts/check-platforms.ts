import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const platforms = await prisma.onlineOrder.groupBy({
    by: ['platform'],
    _count: {
      platform: true
    }
  });

  console.log('Platforms found in DB:', JSON.stringify(platforms, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
