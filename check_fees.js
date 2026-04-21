const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const nullFees = await prisma.purchaseorder.count({
    where: { platformFee: null }
  });
  const total = await prisma.purchaseorder.count();
  console.log(`Total Orders: ${total}`);
  console.log(`Orders with NULL platformFee: ${nullFees}`);
  process.exit(0);
}

check();
