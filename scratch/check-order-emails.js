const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkOrders() {
    console.log('--- ORDER STATUS CHECK ---');
    const orders = await prisma.purchaseorder.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            customerEmail: true,
            paymentStatus: true,
            emailSent: true,
            createdAt: true
        }
    });

    orders.forEach(o => {
        console.log(`ID: ${o.id} | Email: ${o.customerEmail} | Status: ${o.paymentStatus} | EmailSent: ${o.emailSent} | Created: ${o.createdAt}`);
    });
    console.log('--------------------------');
    await prisma.$disconnect();
}

checkOrders();
