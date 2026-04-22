const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPayout() {
  try {
    const payout = await prisma.payout.findFirst({
      where: {
        bankDetailsSnapshot: {
          not: null
        }
      },
      select: {
        id: true,
        bankDetailsSnapshot: true,
        amountCents: true,
        status: true
      }
    });

    if (payout) {
      console.log('\n--- FOUND RECORD IN PAYOUT TABLE ---');
      console.log('ID:', payout.id);
      console.log('Status:', payout.status);
      console.log('Amount (Cents):', payout.amountCents);
      console.log('\n--- Current bankDetailsSnapshot (LongText) ---');
      console.log(payout.bankDetailsSnapshot);
      console.log('--------------------------------------------\n');
      
      try {
        JSON.parse(payout.bankDetailsSnapshot);
        console.log('✅ Result: This data is ALREADY valid JSON. It is safe to convert.');
      } catch (e) {
        console.log('⚠️ Result: This is NOT valid JSON text. It will be wiped if you convert to JSON.');
      }
    } else {
      console.log('No records found with bankDetailsSnapshot data.');
    }
  } catch (err) {
    console.error('Error fetching record:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkPayout();
