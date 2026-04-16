const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debugOrder(orderId) {
  console.log(`\n--- Debugging Order: ${orderId} ---`);
  
  try {
    const order = await prisma.purchaseorder.findUnique({
      where: { id: orderId },
      include: { tickets: true }
    });

    if (!order) {
      console.log('❌ Order NOT found in database.');
      return;
    }

    console.log('Order Details:');
    console.log(`- Status: ${order.status}`);
    console.log(`- Payment Status: ${order.paymentStatus}`);
    console.log(`- Status Detail: ${order.statusDetail}`);
    console.log(`- Amount: ${order.amount}`);
    console.log(`- Quantity: ${order.quantity}`);
    console.log(`- stripeSessionId: ${order.stripeSessionId}`);
    console.log(`- stripePaymentIntentId: ${order.stripePaymentIntentId}`);
    console.log(`- processedAt: ${order.processedAt}`);
    
    console.log(`\nTickets found: ${order.tickets.length}`);
    if (order.tickets.length > 0) {
      order.tickets.forEach((t, i) => {
        console.log(`  [${i+1}] Ticket ID: ${t.id}, Status: ${t.status}, QR: ${t.qrPayload}`);
      });
    }

  } catch (error) {
    console.error('Debug error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

const orderId = 'ORD-1774246403749-AC989E';
debugOrder(orderId);
