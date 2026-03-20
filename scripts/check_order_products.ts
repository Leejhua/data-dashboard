import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.onlineOrder.groupBy({
    by: ['productName'],
    _count: {
      id: true
    },
    orderBy: {
      _count: {
        id: 'desc'
      }
    },
    take: 20
  });

  console.log('Top 20 Product Names in Online Orders:');
  products.forEach(p => {
    console.log(`- ${p.productName}: ${p._count.id} orders`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
