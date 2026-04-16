const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function backfillCents() {
    console.log('--- STARTING CENTS BACKFILL ---');
    
    try {
        // 1. Backfill Events
        const events = await prisma.event.findMany();
        console.log(`Processing ${events.length} events...`);
        for (const event of events) {
            const cents = Math.round(event.ticketPrice * 100);
            await prisma.event.update({
                where: { id: event.id },
                data: { ticketPriceCents: cents }
            });
        }
        console.log('✅ Events backfilled.');

        // 2. Backfill Ticket Releases
        const releases = await prisma.ticketrelease.findMany();
        console.log(`Processing ${releases.length} ticket releases...`);
        for (const rel of releases) {
            const cents = Math.round(rel.price * 100);
            await prisma.ticketrelease.update({
                where: { id: rel.id },
                data: { priceCents: cents }
            });
        }
        console.log('✅ Ticket releases backfilled.');

        // 3. Backfill Purchase Orders
        const orders = await prisma.purchaseorder.findMany();
        console.log(`Processing ${orders.length} purchase orders...`);
        for (const order of orders) {
            const amountCents = Math.round(order.amount * 100);
            const amountPaidCents = order.amountPaid ? Math.round(order.amountPaid * 100) : (order.paymentStatus === 'SUCCESS' ? amountCents : 0);
            
            await prisma.purchaseorder.update({
                where: { id: order.id },
                data: { 
                    amountCents,
                    amountPaidCents: amountPaidCents
                }
            });
        }
        console.log('✅ Purchase orders backfilled.');

        // 4. Backfill Platform Settings
        const settings = await prisma.platformsettings.findFirst();
        if (settings) {
            const cents = Math.round(settings.platformFeeFixed * 100);
            await prisma.platformsettings.update({
                where: { id: settings.id },
                data: { platformFeeFixedCents: cents }
            });
            console.log('✅ Platform settings backfilled.');
        }

        console.log('\n--- BACKFILL COMPLETE ---');

    } catch (error) {
        console.error('❌ Backfill failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

backfillCents();
