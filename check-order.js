const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const orderId = 'ORD-1775022253262-E46FE9'; // New order from user error

async function checkOrder() {
    try {
        const order = await prisma.purchaseorder.findUnique({
            where: { id: orderId }
        });
        console.log('Order:', JSON.stringify(order, null, 2));

        const tickets = await prisma.ticket.findMany({
            where: { purchaseOrderId: orderId }
        });
        console.log('Tickets count:', tickets.length);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkOrder();
