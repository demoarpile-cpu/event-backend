const prisma = require('../config/db');

/**
 * Service to handle background cleanup of expired ticket locks
 */
const cleanupService = {
    /**
     * Release expired PENDING orders
     * This restores 'available' capacity by marking PENDING orders as FAILED
     */
    async releaseExpiredLocks() {
        try {
            const now = new Date();
            // Buffer: PAYMENT_PENDING orders get an extra 5 minutes (Total 35m) to avoid race with Stripe redirect
            const expiredOrders = await prisma.purchaseorder.findMany({
                where: {
                    OR: [
                        {
                            paymentStatus: 'PENDING',
                            expiresAt: { lt: now }
                        },
                        {
                            paymentStatus: 'PAYMENT_PENDING',
                            expiresAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } // 5m buffer
                        }
                    ]
                }
            });

            if (expiredOrders.length === 0) return;

            console.log(`[CLEANUP] Found ${expiredOrders.length} potentially expired orders.`);

            for (const order of expiredOrders) {
                // ATOMIC UPDATE: Only expire if still in a pending state
                const updated = await prisma.purchaseorder.updateMany({
                    where: {
                        id: order.id,
                        paymentStatus: { in: ['PENDING', 'PAYMENT_PENDING'] }
                    },
                    data: {
                        paymentStatus: 'FAILED',
                        status: 'EXPIRED'
                    }
                });

                if (updated.count > 0) {
                    console.log(`[CLEANUP_EXPIRED] orderId=${order.id} (Reason: Expiry)`);
                    console.log(`[PAYMENT_FAILED] orderId=${order.id} (Reason: Expired by Cleanup)`);
                } else {
                    console.log(`[CLEANUP_SKIPPED_ACTIVE_PAYMENT] orderId=${order.id} (Status changed during cleanup)`);
                }
            }
        } catch (error) {
            console.error(`[CLEANUP_ERROR] Failed to release expired locks: ${error.message}`);
        }
    },

    /**
     * Start the background cleanup job
     */
    start() {
        console.log('🚀 Cleanup Service Started (Interval: 2 minutes)');
        // Run every 2 minutes
        setInterval(() => {
            this.releaseExpiredLocks();
        }, 2 * 60 * 1000);
    }
};

module.exports = cleanupService;
