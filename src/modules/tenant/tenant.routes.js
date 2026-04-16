const express = require('express');
const crypto = require('crypto');
const prisma = require('../../config/db');
const emailService = require('../../services/emailService');
const { requireAuth, requireRole, requireApprovedOrganizer } = require('../../middlewares/authMiddleware');

const router = express.Router();

/**
 * @route POST /api/tickets/purchase
 * @desc  Handle ticket purchase
 */
router.post('/purchase', async (req, res) => {
    const { eventId, quantity, attendeeName, attendeeEmail, promoCode, ticketReleaseId, idempotencyKey } = req.body;

    if (!eventId || !quantity || !attendeeName || !attendeeEmail) {
        return res.status(400).json({ error: 'Missing required purchase details' });
    }

    try {
        const eventIdInt = parseInt(eventId);
        const ticketReleaseIdInt = ticketReleaseId ? parseInt(ticketReleaseId) : null;

        // 1. Idempotency Check (PRE-TRANSACTION)
        if (idempotencyKey) {
            const existingOrder = await prisma.purchaseorder.findUnique({
                where: { idempotencyKey },
                include: { tickets: true }
            });
            if (existingOrder) {
                return res.status(200).json({
                    message: 'Purchase successful (Recovered)',
                    orderId: existingOrder.id,
                    tickets: existingOrder.tickets,
                    totalAmount: existingOrder.amount.toFixed(2),
                    idempotent: true
                });
            }
        }

        // 2. Main Purchase Transaction
        const result = await prisma.$transaction(async (tx) => {
            // Fetch current state for baseline calculations
            const event = await tx.event.findUnique({
                where: { id: eventIdInt },
                include: { user_event_organizerIdTouser: true }
            });

            if (!event) throw new Error('Event not found');
            if (event.status !== 'APPROVED') throw new Error('Event is not open for sales');

            let ticketPrice = event.ticketPrice;
            let releaseName = "General Admission";
            let release = null; // Declared in outer scope for auto-progression access

            // MULTI Pricing Logic & Atomic Guard
            if (event.pricingType === 'MULTI') {
                if (!ticketReleaseIdInt) throw new Error('Ticket selection required for this event.');

                release = await tx.ticketrelease.findUnique({
                    where: { id: ticketReleaseIdInt }
                });

                if (!release || release.eventId !== eventIdInt) throw new Error('Invalid ticket selection.');
                
                // STRICT PRODUCTION CHECK
                if (!release.isActive) {
                    throw new Error(`The "${release.name}" release is currently deactivated.`);
                }

                // Date-based validation
                const now = new Date();
                if (release.releaseDate && now < new Date(release.releaseDate)) {
                    throw new Error(`The "${release.name}" release is coming soon and not yet available for purchase.`);
                }
                if (release.endDate && now > new Date(release.endDate)) {
                    throw new Error(`The "${release.name}" release has expired and is no longer available.`);
                }
                
                if (release.sold >= release.quantity) {
                    throw new Error(`The "${release.name}" release is sold out.`);
                }
                
                // ATOMIC GUARD: Update only if space is available
                const updateRelease = await tx.ticketrelease.updateMany({
                    where: { 
                        id: ticketReleaseIdInt, 
                        sold: { lte: release.quantity - quantity },
                        isActive: true // Double check active status at exact moment of update
                    },
                    data: { sold: { increment: quantity } }
                });

                if (updateRelease.count === 0) {
                    throw new Error(`Insufficient tickets remaining for ${release.name}.`);
                }

                ticketPrice = release.price;
                releaseName = release.name;
            }

            // ATOMIC GUARD (Global Event Capacity)
            const updateEvent = await tx.event.updateMany({
                where: { 
                    id: eventIdInt, 
                    ticketsSold: { lte: event.totalTickets - quantity },
                    status: 'APPROVED'
                },
                data: { ticketsSold: { increment: quantity } }
            });

            if (updateEvent.count === 0) {
                throw new Error('Total event capacity reached.');
            }

            // Promo Code Logic
            let discountAmount = 0;
            const subtotal = ticketPrice * quantity;

            if (promoCode) {
                const promo = await tx.promocode.findUnique({
                    where: { eventId_code: { eventId: eventIdInt, code: promoCode.toUpperCase() } }
                });

                if (promo && promo.maxUsage > 0 && promo.currentUsage >= promo.maxUsage) {
                    throw new Error('Promo code usage limit reached');
                }

                if (promo && (!promo.expiresAt || new Date(promo.expiresAt) > new Date())) {
                    // Calculate Discount
                    discountAmount = promo.discountType === 'PERCENTAGE' 
                        ? (subtotal * promo.discountValue) / 100 
                        : promo.discountValue;

                    await tx.promocode.update({
                        where: { id: promo.id },
                        data: { currentUsage: { increment: 1 } }
                    });
                }
            }

            const settings = await tx.platformsettings.findFirst() || await tx.platformsettings.create({ data: {} });
            const effectiveFeeRate = settings.platformFeeRate;
            const globalFeeFixed = settings.platformFeeFixed;
            const buyerPaysFee = event.serviceFeeType === 'BUYER';

            // Platform fee must be calculated from post-promo amount.
            const clampedDiscount = Math.max(0, Math.min(discountAmount, subtotal));
            const discountedSubtotal = Math.max(0, subtotal - clampedDiscount);
            const fee = (discountedSubtotal <= 0)
                ? 0 
                : parseFloat(((discountedSubtotal * effectiveFeeRate) + (globalFeeFixed * quantity)).toFixed(2));
            
            const finalTotal = Math.max(0, discountedSubtotal + (buyerPaysFee ? fee : 0));
            const finalTotalCents = Math.round(finalTotal * 100);

            // 3. Create Purchase Order Tracking
            const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
            await tx.purchaseorder.create({
                data: {
                    id: orderId,
                    idempotencyKey: idempotencyKey || null,
                    eventId: eventIdInt,
                    amount: finalTotal,
                    amountCents: finalTotalCents,
                    platformFee: fee,
                    platformFeeCents: Math.round(fee * 100),
                    currency: 'AUD',
                    status: 'COMPLETED',
                    paymentStatus: 'SUCCESS',
                    processedAt: new Date(),
                    customerName: attendeeName,
                    customerEmail: attendeeEmail,
                    quantity: quantity
                }
            });

            // 4. Generate Tickets
            const tickets = [];
            for (let i = 0; i < quantity; i++) {
                const secureToken = crypto.randomBytes(8).toString('hex');
                const ticket = await tx.ticket.create({
                    data: {
                        eventId: eventIdInt,
                        ticketReleaseId: ticketReleaseIdInt,
                        purchaseOrderId: orderId,
                        buyerName: attendeeName,
                        buyerEmail: attendeeEmail,
                        qrPayload: `/verify/${secureToken}`,
                        status: 'UNUSED'
                    }
                });
                tickets.push(ticket);
            }

            // 5. AUTO-PROGRESSION LOGIC
            // If the purchased tier is now sold out (or this purchase fills it), activate the next one
            if (event.pricingType === 'MULTI' && (release.sold + quantity >= release.quantity)) {
                // Fetch all releases to evaluate state safely
                const allReleases = await tx.ticketrelease.findMany({
                    where: { eventId: eventIdInt }
                });

                const otherActiveAvailable = allReleases.find(r => 
                    r.isActive && 
                    r.id !== ticketReleaseIdInt && 
                    r.sold < r.quantity
                );

                if (!otherActiveAvailable) {
                    // Find the "Next" tier: Not active, has capacity, earliest date or lowest price
                    const nextRelease = allReleases
                        .filter(r => !r.isActive && r.sold < r.quantity)
                        .sort((a, b) => {
                            if (a.releaseDate && b.releaseDate) return new Date(a.releaseDate) - new Date(b.releaseDate);
                            if (a.releaseDate) return -1;
                            if (b.releaseDate) return 1;
                            return a.price - b.price;
                        })[0];

                    if (nextRelease) {
                        await tx.ticketrelease.update({
                            where: { id: nextRelease.id },
                            data: { isActive: true }
                        });
                        
                        // Deactivate the current one for strict single-tier enforcement
                        await tx.ticketrelease.update({
                            where: { id: ticketReleaseIdInt },
                            data: { isActive: false }
                        });
                        
                        console.log(`Auto-Progressed: ${event.title} -> Activated ${nextRelease.name}`);
                    }
                }
            }

            return { 
                tickets, 
                orderId, 
                totalAmount: finalTotal,
                eventTitle: event.title,
                eventDate: event.eventDate,
                location: event.location,
                organizerEmail: event.user_event_organizerIdTouser?.email
            };
        });

        // Trigger Emails (Non-blocking Fire-and-Forget)
        const latestOrder = await prisma.purchaseorder.findUnique({
            where: { id: result.orderId }
        });

        if (latestOrder && !latestOrder.emailSent) {
            const emailResult = await emailService.processPurchaseEmails({
                attendeeEmail,
                attendeeName,
                orderId: result.orderId,
                totalAmount: result.totalAmount,
                eventTitle: result.eventTitle,
                eventDate: result.eventDate,
                location: result.location,
                organizerEmail: result.organizerEmail,
                tickets: result.tickets
            });

            if (emailResult?.attendeeSent) {
                await prisma.purchaseorder.update({
                    where: { id: result.orderId },
                    data: { emailSent: true }
                });
            } else {
                console.error(`[EMAIL_PENDING] attendee email failed for ${result.orderId}. reason=${emailResult?.attendeeError || 'unknown'}`);
            }
        }

        res.status(201).json({
            message: 'Purchase successful',
            orderId: result.orderId,
            tickets: result.tickets,
            totalAmount: result.totalAmount.toFixed(2)
        });

    } catch (error) {
        console.error('Purchase failure:', error.message);
        res.status(400).json({ error: error.message });
    }
});

/**
 * @route POST /api/tickets/validate
 * @desc  Validate a ticket QR payload (Used by scanner)
 */
router.post('/validate', requireAuth, requireRole(['ADMIN', 'ORGANIZER']), requireApprovedOrganizer, async (req, res) => {
    const { qrPayload } = req.body;

    if (!qrPayload) {
        return res.status(400).json({ error: 'QR Payload required' });
    }

    try {
        // Try direct lookup first
        let ticket = await prisma.ticket.findUnique({
            where: { qrPayload },
            include: { event: true }
        });

        // Smart Fallback: If it's a URL, extract the payload part
        if (!ticket && qrPayload.includes('/verify/')) {
            const parts = qrPayload.split('/verify/');
            const extractedPayload = '/verify/' + parts[parts.length - 1];

            ticket = await prisma.ticket.findUnique({
                where: { qrPayload: extractedPayload },
                include: { event: true }
            });

            // Extreme Fallback: If still not found, check if it's just the ID at the end
            if (!ticket) {
                const idMatch = qrPayload.match(/\/(\d+)$/);
                if (idMatch) {
                    ticket = await prisma.ticket.findUnique({
                        where: { id: parseInt(idMatch[1]) },
                        include: { event: true }
                    });
                }
            }
        }

        if (!ticket) {
            return res.status(400).json({ error: 'Invalid Ticket: No matching record found.' });
        }

        if (ticket.status === 'USED') {
            return res.status(400).json({
                error: 'Ticket already used',
                ticket: {
                    id: ticket.id,
                    buyerName: ticket.buyerName,
                    buyerEmail: ticket.buyerEmail,
                    eventTitle: ticket.event.title,
                    scannedAt: ticket.scannedAt
                }
            });
        }

        // Optional: Check if the logged in user has permission for THIS specific event
        if (req.user.role === 'ORGANIZER' && ticket.event.organizerId !== req.user.id) {
            return res.status(403).json({ error: 'Access denied: You are not the organizer of this event' });
        }

        // Mark as used
        const updatedTicket = await prisma.ticket.update({
            where: { id: ticket.id },
            data: {
                status: 'USED',
                scannedAt: new Date()
            }
        });

        res.json({
            status: 'valid',
            message: 'Ticket successfully verified. Enjoy the event!',
            ticket: {
                id: updatedTicket.id,
                buyerName: updatedTicket.buyerName,
                buyerEmail: updatedTicket.buyerEmail,
                eventTitle: ticket.event.title
            }
        });
    } catch (error) {
        console.error('Validation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
