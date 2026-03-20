import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      matchKeywords: true
    }
  });

  console.log(`Found ${products.length} standard products in the database.`);
  if (products.length > 0) {
    console.log('Sample products:');
    products.slice(0, 5).forEach(p => {
      console.log(`- ${p.name}: [Keywords: ${p.matchKeywords}]`);
    });
  } else {
    console.log('No standard products found. We might need to seed or create them.');
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
