const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

const orderId = 'ORD-1775022253262-E46FE9';

async function forceSuccess() {
    try {
        const order = await prisma.purchaseorder.findUnique({
            where: { id: orderId }
        });

        if (!order) {
            console.log('Order not found');
            return;
        }

        console.log('Forcing success for order:', order.id);

        await prisma.$transaction(async (tx) => {
            // Update order
            await tx.purchaseorder.update({
                where: { id: orderId },
                data: {
                    paymentStatus: 'SUCCESS',
                    status: 'COMPLETED',
                    processedAt: new Date(),
                    statusDetail: 'MANUAL_RECOVERY_FROM_PRICE_MISMATCH'
                }
            });

            // Update stats
            await tx.event.update({
                where: { id: order.eventId },
                data: { ticketsSold: { increment: order.quantity } }
            });

            if (order.ticketReleaseId) {
                await tx.ticketrelease.update({
                    where: { id: order.ticketReleaseId },
                    data: { sold: { increment: order.quantity } }
                });
            }

            // Generate tickets
            for (let i = 0; i < order.quantity; i++) {
                const secureToken = crypto.randomBytes(8).toString('hex');
                await tx.ticket.create({
                    data: {
                        eventId: order.eventId,
                        ticketReleaseId: order.ticketReleaseId,
                        purchaseOrderId: orderId,
                        buyerName: order.customerName,
                        buyerEmail: order.customerEmail,
                        qrPayload: `/verify/${secureToken}`,
                        status: 'UNUSED'
                    }
                });
            }
        });

        console.log('Tickets generated successfully!');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await prisma.$disconnect();
    }
}

forceSuccess();
