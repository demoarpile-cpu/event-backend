const prisma = require('../../config/db');
const stripeService = require('./stripe.service');
const emailService = require('../../services/emailService');
const crypto = require('crypto');

/**
 * Handle Stripe Webhooks
 */
const handleWebhook = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Stripe expects the RAW body for signature verification
        event = stripeService.constructEvent(req.body, sig);
        console.log(`[WEBHOOK_RECEIVED] id=${event.id} type=${event.type}`);
    } catch (err) {
        console.error(`[WEBHOOK_ERROR] Signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Process the event
    try {
        const sessionOrIntent = event.data.object;
        const orderId = sessionOrIntent.metadata?.orderId;

        switch (event.type) {
            case 'checkout.session.completed':
            case 'payment_intent.succeeded':
                // Check if it's already processed via idempotency inside the handler
                await confirmOrderPayment(sessionOrIntent);
                break;
            case 'checkout.session.expired':
            case 'payment_intent.payment_failed':
                await handlePaymentFailure(orderId, sessionOrIntent.id);
                break;
            default:
                console.log(`[WEBHOOK_INFO] Unhandled event type ${event.type}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error(`[WEBHOOK_PROCESS_ERROR] Failed to process ${event.type}: ${error.message}`);
        res.status(500).json({ error: 'Internal processing error' });
    }
};

/**
 * Handle successful payment completion
 * Exported so the tickets retrieval API can use it as a self-healing fallback
 */
async function confirmOrderPayment(sessionOrIntent) {
    const orderId = sessionOrIntent.metadata?.orderId;
    if (!orderId) {
        console.warn('[CONFIRM_PAYMENT_ERROR] Missing orderId in metadata.');
        return;
    }
    
    // 1. Idempotency Guard: Double Check (Status + ProcessedAt)
    const order = await prisma.purchaseorder.findUnique({
        where: { id: orderId }
    });

    if (!order || order.processedAt) {
        console.log(`[WEBHOOK_INFO] Order ${orderId} already processed or missing (idempotency guard).`);
        return;
    }

    // 2. Validate Amount and Currency
    const amountPaidCents = sessionOrIntent.amount_total || sessionOrIntent.amount_received || sessionOrIntent.amount;
    const currency = (sessionOrIntent.currency || 'AUD').toUpperCase();
    
    // NEW: Check against amountCents primarily, fallback to amount * 100 for very old orders
    const expectedCents = order.amountCents > 0 ? order.amountCents : Math.round(order.amount * 100);

    if (Math.abs(amountPaidCents - expectedCents) > 0 || currency !== order.currency.toUpperCase()) {
        console.error(`[PAYMENT_ERROR] Integrity check failed for ${orderId}. 
            Paid: ${amountPaidCents} unit=${currency}
            Expected: ${expectedCents} unit=${order.currency.toUpperCase()}`);
        
        await prisma.purchaseorder.update({
            where: { id: orderId },
            data: { 
                paymentStatus: 'FAILED', 
                status: 'PRICE_MISMATCH',
                statusDetail: `Expect:${expectedCents}${order.currency.toUpperCase()} Paid:${amountPaidCents}${currency}`
            }
        });
        return;
    }

    // 3. Confirm Booking & Increment Capacity (Atomic Confirmation)
    let generatedTickets = [];
    try {
        await prisma.$transaction(async (tx) => {
            // Update Order Status with Tracing
            const updatedOrder = await tx.purchaseorder.update({
                where: { id: orderId },
                data: {
                    paymentStatus: 'SUCCESS',
                    status: 'COMPLETED',
                    processedAt: new Date(),
                    stripePaymentIntentId: sessionOrIntent.payment_intent || sessionOrIntent.id,
                    amountPaid: amountPaidCents / 100, // Float field (legacy)
                    amountPaidCents: amountPaidCents, // New Cents field
                    statusDetail: order.status === 'EXPIRED' ? 'LATE_PAYMENT_RECOVERED' : 'ONLINE_CONFIRMED'
                }
            });
            console.log(`[PAYMENT_SUCCESS] orderId=${orderId}`);

            // Lock in capacity
            if (order.ticketReleaseId) {
                const release = await tx.ticketrelease.update({
                    where: { id: order.ticketReleaseId },
                    data: { sold: { increment: order.quantity } }
                });

                // (Removed AUTO-PROGRESSION logic to allow organizer manual control of multiple active tiers)
            }
            
            // 3.5. Increment Promo Code Usage
            const promoCodeId = sessionOrIntent.metadata?.promoCodeId;
            if (promoCodeId && promoCodeId !== 'null') {
                await tx.promocode.update({
                    where: { id: parseInt(promoCodeId) },
                    data: { currentUsage: { increment: 1 } }
                });
                console.log(`[PROMO_USED] promoCodeId=${promoCodeId}`);
            }

            await tx.event.update({
                where: { id: order.eventId },
                data: { ticketsSold: { increment: order.quantity } }
            });

            // 4. Generate Tickets
            for (let i = 0; i < order.quantity; i++) {
                const secureToken = crypto.randomBytes(8).toString('hex');
                const ticket = await tx.ticket.create({
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
                generatedTickets.push(ticket);
            }

            console.log(`[PAYMENT_CONFIRMED] orderId=${orderId} tickets=${generatedTickets.length}`);
        }, { timeout: 15000 });

        // 5. Fire Emails (OUTSIDE Transaction for Resilience/Speed)
        try {
            // Re-fetch to check idempotency flag
            const latestOrder = await prisma.purchaseorder.findUnique({
                where: { id: orderId }
            });

            if (latestOrder && !latestOrder.emailSent) {
                const event = await prisma.event.findUnique({
                    where: { id: order.eventId },
                    include: { user_event_organizerIdTouser: true }
                });

                const emailResult = await emailService.processPurchaseEmails({
                    attendeeEmail: order.customerEmail,
                    attendeeName: order.customerName,
                    orderId: orderId,
                    totalAmount: amountPaidCents / 100,
                    eventTitle: event.title,
                    eventDate: event.eventDate,
                    location: event.location,
                    organizerEmail: event.user_event_organizerIdTouser?.email,
                    tickets: generatedTickets
                });

                if (emailResult?.attendeeSent) {
                    await prisma.purchaseorder.update({
                        where: { id: orderId },
                        data: { emailSent: true }
                    });
                    console.log(`[EMAIL_CONFIRMED] attendee email sent for ${orderId}`);
                } else {
                    console.error(`[EMAIL_PENDING] attendee email failed for ${orderId}. Will retry on fallback paths. reason=${emailResult?.attendeeError || 'unknown'}`);
                }
            } else {
                console.log(`[EMAIL_SKIPPED] Idempotency: Emails already sent for ${orderId}`);
            }
        } catch (emailError) {
            console.error(`[POST_PAYMENT_ERROR] Stats/Email update failed for ${orderId}:`, emailError.message);
        }

        return generatedTickets;

    } catch (txError) {
        console.error(`[WEBHOOK_TX_ERROR] Critical failure for ${orderId}:`, txError.message);
        // If we caught an error in the transaction, it rolled back. 
        // We might want to mark it as TICKET_PENDING only if we are relatively sure payment succeeded but tickets failed.
        // But since we catch at the very top, we re-throw for Stripe to retry.
        throw txError; 
    }
}

/**
 * Handle payment failure or session expiration
 */
async function handlePaymentFailure(orderId, sessionIdOrId) {
    if (!orderId && !sessionIdOrId) return;

    // Try finding by orderId first (more reliable from metadata)
    let order = null;
    if (orderId) {
        order = await prisma.purchaseorder.findUnique({ where: { id: orderId } });
    }
    
    // Fallback to sessionId lookup
    if (!order && sessionIdOrId) {
        order = await prisma.purchaseorder.findUnique({
            where: { stripeSessionId: sessionIdOrId }
        });
    }

    if (order && (order.paymentStatus === 'PENDING' || order.paymentStatus === 'PAYMENT_PENDING')) {
        await prisma.purchaseorder.update({
            where: { id: order.id },
            data: { 
                paymentStatus: 'FAILED', 
                status: 'FAILED',
                processedAt: new Date(),
                statusDetail: 'PAYMENT_FAILED_AT_STRIPE'
            }
        });
        console.log(`[PAYMENT_FAILED] orderId=${order.id} (Webhook released lock)`);
    }
}

module.exports = { handleWebhook, confirmOrderPayment };
