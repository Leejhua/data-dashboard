import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Clear existing data (Order matters because of foreign keys)
  // Deleting in reverse order of dependencies
  await prisma.order.deleteMany()
  await prisma.onlineOrder.deleteMany()
  await prisma.promoter.deleteMany()
  await prisma.commissionRule.deleteMany()
  await prisma.accountGroup.deleteMany()
  await prisma.channelConfig.deleteMany()
  await prisma.user.deleteMany()
  await prisma.product.deleteMany()

  console.log('Deleted existing data.')

  // 1. Create Account Group
  await prisma.accountGroup.create({
    data: {
      name: 'Default Group',
      description: 'Default account group for testing',
      highTicketRate: 5.0,
    },
  })

  // 2. Create Channel Config
  const channelConfig = await prisma.channelConfig.create({
    data: {
      name: 'Douyin',
      isEnabled: true,
    },
  })

  // 3. Create Promoters
  const promoters = []
  for (let i = 1; i <= 5; i++) {
    promoters.push(await prisma.promoter.create({
      data: {
        name: `Promoter ${i}`,
        phone: `1380013800${i}`,
        channel: 'Douyin',
        channelConfigId: channelConfig.id,
      },
    }))
  }

  // 4. Create Orders (Distributed over last 10 days)
  const today = new Date()
  
  // Create 50 orders
  for (let i = 0; i < 50; i++) {
    const daysAgo = i % 10 // 0 to 9 days ago
    const orderDate = new Date(today)
    orderDate.setDate(today.getDate() - daysAgo)
    
    // Random promoter
    const promoter = promoters[i % promoters.length]
    
    // Random amount (100 - 1000)
    const amount = Math.floor(Math.random() * 900) + 100

    await prisma.order.create({
      data: {
        orderNo: `ORD-${Date.now()}-${i}`,
        source: 'MANUAL',
        platform: 'Douyin',
        status: i % 5 === 0 ? 'REFUNDED' : 'COMPLETED', // 20% refund rate
        
        // Required fields
        customerXianyuId: `user_${i}`,
        sourceContact: `contact_${i}`,
        productName: 'Test Product',
        variantName: 'Standard',
        
        duration: 7,
        rentPrice: amount * 0.8,
        deposit: 0,
        insurancePrice: amount * 0.2,
        totalAmount: amount,
        
        address: 'Test Address',
        
        promoterId: promoter.id,
        channelId: channelConfig.id,
        
        creatorId: 'admin',
        creatorName: 'Admin',
        
        createdAt: orderDate,
        updatedAt: orderDate,
      },
    })
  }

  console.log('Seeding finished.')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
