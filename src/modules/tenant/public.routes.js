const express = require('express');
const prisma = require('../../config/db');
const { verifyTicketDownloadToken } = require('../../services/emailService');

const router = express.Router();

/**
 * @route GET /api/public/events
 * @desc  Get all approved events for public listing
 */
router.get('/events', async (req, res) => {
    try {
        const events = await prisma.event.findMany({
            where: {
                status: 'APPROVED',
                isPublic: true
            },
            include: {
                user_event_organizerIdTouser: {
                    select: {
                        name: true
                    }
                },
                ticketrelease: {
                    where: { isActive: true },
                    orderBy: [
                        { releaseDate: 'asc' },
                        { price: 'asc' }
                    ]
                }
            },
            orderBy: {
                eventDate: 'asc'
            }
        });

        const now = new Date();
        const mappedEvents = events
            .filter(e => {
                if (e.pricingType === 'MULTI') {
                    // Only show events that have at least one potentially active tier
                    return e.ticketrelease.some(tr => tr.isActive && (tr.sold < tr.quantity));
                }
                return true;
            })
            .map(e => {
                const releasesWithStatus = (e.ticketrelease || []).map(tr => {
                    let status = 'INACTIVE';
                    if (tr.isActive) {
                        if (tr.sold >= tr.quantity) status = 'SOLD_OUT';
                        else if (tr.releaseDate && now < new Date(tr.releaseDate)) status = 'COMING_SOON';
                        else if (tr.endDate && now > new Date(tr.endDate)) status = 'EXPIRED';
                        else status = 'ACTIVE';
                    }
                    return { ...tr, status };
                });

                const activeReleases = releasesWithStatus.filter(r => r.status === 'ACTIVE');
                let minPrice = e.ticketPrice;
                let maxPrice = e.ticketPrice;
                let minPriceCents = e.ticketPriceCents;
                let maxPriceCents = e.ticketPriceCents;

                if (e.pricingType === 'MULTI' && activeReleases.length > 0) {
                    const prices = activeReleases.map(r => r.price);
                    const pricesCents = activeReleases.map(r => r.priceCents);
                    minPrice = Math.min(...prices);
                    maxPrice = Math.max(...prices);
                    minPriceCents = Math.min(...pricesCents);
                    maxPriceCents = Math.max(...pricesCents);
                } else if (e.pricingType === 'MULTI' && releasesWithStatus.length > 0) {
                    // Fallback to all active (but maybe sold out/expired) for price range
                    const allActive = releasesWithStatus.filter(r => r.isActive);
                    if (allActive.length > 0) {
                        minPrice = Math.min(...allActive.map(r => r.price));
                        maxPrice = Math.max(...allActive.map(r => r.price));
                        minPriceCents = Math.min(...allActive.map(r => r.priceCents));
                        maxPriceCents = Math.max(...allActive.map(r => r.priceCents));
                    }
                }

                // For MULTI events: compute accurate sold/total from actual release data
                let accurateTicketsSold = e.ticketsSold || 0;
                let accurateTotalTickets = e.totalTickets || 0;
                if (e.pricingType === 'MULTI' && releasesWithStatus.length > 0) {
                    accurateTicketsSold = releasesWithStatus.reduce((sum, r) => sum + (r.sold || 0), 0);
                    accurateTotalTickets = releasesWithStatus.reduce((sum, r) => sum + (r.quantity || 0), 0);
                }

                return {
                    ...e,
                    ticketsSold: accurateTicketsSold,
                    totalTickets: accurateTotalTickets,
                    ticketrelease: releasesWithStatus,
                    organizer: e.user_event_organizerIdTouser,
                    minPrice,
                    maxPrice,
                    minPriceCents,
                    maxPriceCents
                };
            });

        res.json(mappedEvents);
    } catch (error) {
        console.error('Error fetching public events:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/events/:id
 * @desc  Get event details by ID
 */
router.get('/events/:id', async (req, res) => {
    const { id } = req.params;
    const eventId = parseInt(id);
    if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
    }
    try {
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: {
                user_event_organizerIdTouser: {
                    select: {
                        name: true
                    }
                },
                eventimage: {
                    orderBy: {
                        displayOrder: 'asc'
                    }
                },
                eventschedule: {
                    orderBy: {
                        orderIndex: 'asc'
                    }
                },
                ticketrelease: {
                    orderBy: [
                        { releaseDate: 'asc' },
                        { price: 'asc' }
                    ]
                }
            }
        });

        if (!event) return res.status(404).json({ error: 'Event not found' });

        // Visibility Check:
        // 1. If not approved, only allow if preview=true
        // 2. If private, only allow if private=true OR preview=true
        const isApproved = event.status === 'APPROVED';
        const isPublic = event.isPublic;
        const isPreview = req.query.preview === 'true';
        const isPrivateAccess = req.query.private === 'true';

        if (!isApproved && !isPreview) {
            return res.status(403).json({ error: 'This event is currently awaiting admin approval.' });
        }

        if (!isPublic && !isPrivateAccess && !isPreview) {
            return res.status(404).json({ error: 'This is a private event. You need a direct link to access it.' });
        }

        const now = new Date();
        const releasesWithStatus = (event.ticketrelease || []).map(tr => {
            let status = 'INACTIVE';
            if (tr.isActive) {
                if (tr.sold >= tr.quantity) status = 'SOLD_OUT';
                else if (tr.releaseDate && now < new Date(tr.releaseDate)) status = 'COMING_SOON';
                else if (tr.endDate && now > new Date(tr.endDate)) status = 'EXPIRED';
                else status = 'ACTIVE';
            }
            return { ...tr, status };
        });

        const eventData = {
            ...event,
            ticketReleases: releasesWithStatus,
            tags: event.tags ? (typeof event.tags === 'string' ? JSON.parse(event.tags) : event.tags) : [],
            highlights: event.highlights ? (typeof event.highlights === 'string' ? JSON.parse(event.highlights) : event.highlights) : [],
            organizer: event.user_event_organizerIdTouser,
            galleryImages: event.eventimage,
            schedule: event.eventschedule
        };

        // Calculate price range for details based on current availability
        if (event.pricingType === 'MULTI') {
            const activeReleases = releasesWithStatus.filter(r => r.status === 'ACTIVE');
            if (activeReleases.length > 0) {
                const prices = activeReleases.map(r => r.price);
                eventData.minPrice = Math.min(...prices);
                eventData.maxPrice = Math.max(...prices);
            } else {
                const allActive = releasesWithStatus.filter(r => r.isActive);
                if (allActive.length > 0) {
                    const prices = allActive.map(r => r.price);
                    eventData.minPrice = Math.min(...prices);
                    eventData.maxPrice = Math.max(...prices);
                }
            }

            // Accurate sold/total from release sums (more reliable than event-level counter)
            if (releasesWithStatus.length > 0) {
                eventData.ticketsSold = releasesWithStatus.reduce((sum, r) => sum + (r.sold || 0), 0);
                eventData.totalTickets = releasesWithStatus.reduce((sum, r) => sum + (r.quantity || 0), 0);
            }
        }

        res.json(eventData);
    } catch (error) {
        console.error('Error fetching event details:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/tickets/:id
 * @desc  Fetch ticket by ID (Public)
 */
router.get('/tickets/:id', async (req, res) => {
    try {
        const ticketId = parseInt(req.params.id);
        if (isNaN(ticketId)) {
            return res.status(400).json({ error: 'Invalid ticket ID format' });
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                ticketrelease: true,
                event: {
                    select: {
                        title: true,
                        location: true,
                        eventDate: true,
                        image: true,
                        isPublic: true,
                        user_event_organizerIdTouser: {
                            select: {
                                name: true,
                                email: true
                            }
                        }
                    }
                }
            }
        });

        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
        res.json(ticket);
    } catch (error) {
        console.error('Error fetching ticket:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/orders/:orderId/tickets
 * @desc  Fetch all tickets associated with a Purchase Order
 */
router.get('/orders/:orderId/tickets', async (req, res) => {
    try {
        const { orderId } = req.params;

        let tickets = await prisma.ticket.findMany({
            where: { purchaseOrderId: orderId },
            include: {
                ticketrelease: true,
                event: {
                    select: {
                        title: true,
                        location: true,
                        eventDate: true,
                        image: true,
                        isPublic: true,
                        user_event_organizerIdTouser: {
                            select: {
                                name: true,
                                email: true
                            }
                        }
                    }
                }
            },
            orderBy: { id: 'asc' }
        });

        // SELF-HEALING LOGIC: If no tickets found, check if order is stuck in PAYMENT_PENDING
        if (!tickets || tickets.length === 0) {
            const order = await prisma.purchaseorder.findUnique({
                where: { id: orderId }
            });

            if (order && order.paymentStatus === 'PAYMENT_PENDING' && order.stripeSessionId) {
                console.log(`[SELF_HEAL] Checking Stripe status for order: ${orderId}`);
                const { confirmOrderPayment } = require('../payments/stripe.webhook');
                const stripeService = require('../payments/stripe.service');

                try {
                    const session = await stripeService.getSession(order.stripeSessionId);
                    if (session.payment_status === 'paid') {
                        console.log(`[SELF_HEAL] Stripe confirmed 'paid'. Triggering manual recovery for ${orderId}`);
                        const generatedTickets = await confirmOrderPayment(session);
                        if (generatedTickets && generatedTickets.length > 0) {
                            // Re-fetch with full includes for consistent UI data
                            tickets = await prisma.ticket.findMany({
                                where: { purchaseOrderId: orderId },
                                include: {
                                    ticketrelease: true,
                                    event: { include: { user_event_organizerIdTouser: true } }
                                },
                                orderBy: { id: 'asc' }
                            });
                        }
                    } else {
                        console.log(`[SELF_HEAL] Stripe status is ${session.payment_status} for ${orderId}. Skipping recovery.`);
                    }
                } catch (stripeError) {
                    console.error(`[SELF_HEAL_ERROR] Stripe verification failed for ${orderId}:`, stripeError.message);
                }
            }
        }

        if (!tickets || tickets.length === 0) {
            return res.status(404).json({ error: 'No tickets found for this order. Payment may still be processing or was not completed.' });
        }

        res.json(tickets);
    } catch (error) {
        console.error('Error fetching order tickets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/orders/:orderId/tickets/download
 * @desc  Download consolidated ticket PDF using secure token
 */
router.get('/orders/:orderId/tickets/download', async (req, res) => {
    try {
        const { orderId } = req.params;
        const token = req.query.token;

        const order = await prisma.purchaseorder.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                customerEmail: true,
                customerName: true,
                amount: true,
                currency: true,
                event: {
                    select: {
                        title: true,
                        eventDate: true,
                        location: true
                    }
                }
            }
        });

        if (!order) return res.status(404).json({ error: 'Order not found' });

        const tokenValid = verifyTicketDownloadToken(token, order.id, order.customerEmail);
        if (!tokenValid) return res.status(403).json({ error: 'Invalid or expired download link' });

        const tickets = await prisma.ticket.findMany({
            where: { purchaseOrderId: order.id },
            select: {
                qrPayload: true
            },
            orderBy: { id: 'asc' }
        });

        if (!tickets.length) return res.status(404).json({ error: 'No tickets found for this order' });

        // Build a PDF for direct download.
        const qrcode = require('qrcode');
        const PDFDocument = require('pdfkit');
        const qrCodes = await Promise.all(tickets.map(t => qrcode.toDataURL(t.qrPayload)));

        const pdfBuffer = await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 42 });
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const safeTitle = order.event?.title || 'Event Ticket';
            const safeDate = order.event?.eventDate
                ? new Date(order.event.eventDate).toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short' })
                : 'Date TBA';
            const safeLocation = order.event?.location || 'Venue TBA';
            const safeEmail = order.customerEmail || 'N/A';
            const currency = (order.currency || 'AUD').toUpperCase();
            const orderAmount = `${currency} ${(Number(order.amount) || 0).toFixed(2)}`;

            qrCodes.forEach((qr, index) => {
                if (index > 0) doc.addPage();
                doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60).lineWidth(1).strokeColor('#E2E8F0').stroke();
                doc.fontSize(10).fillColor('#6366F1').text('Invoice Manifest', 50, 55, { uppercase: true });
                doc.fontSize(24).fillColor('#0F172A').text(safeTitle, 50, 72, { width: 500 });
                doc.fontSize(11).fillColor('#64748B').text(safeDate, 50, 108);
                doc.fontSize(11).fillColor('#64748B').text(safeLocation, 50, 124);
                doc.fontSize(10).fillColor('#94A3B8').text('Order ID', 50, 170);
                doc.fontSize(12).fillColor('#0F172A').text(order.id, 50, 184);
                doc.fontSize(10).fillColor('#94A3B8').text('Pass', 370, 170);
                doc.fontSize(12).fillColor('#0F172A').text(`${index + 1} of ${qrCodes.length}`, 370, 184);
                doc.fontSize(10).fillColor('#94A3B8').text('Attendee', 50, 220);
                doc.fontSize(12).fillColor('#0F172A').text(order.customerName || 'Guest', 50, 234);
                doc.fontSize(11).fillColor('#64748B').text(safeEmail, 50, 250);
                doc.fontSize(10).fillColor('#94A3B8').text('Final Total', 370, 220);
                doc.fontSize(18).fillColor('#4F46E5').text(orderAmount, 370, 236);

                const qrBuffer = Buffer.from(String(qr).split(',')[1] || '', 'base64');
                if (qrBuffer.length > 0) {
                    doc.image(qrBuffer, 210, 320, { fit: [180, 180], align: 'center', valign: 'center' });
                    doc.fontSize(10).fillColor('#64748B').text('Scan this QR at event entry gate', 185, 512);
                }
                doc.fontSize(9).fillColor('#94A3B8').text(
                    'Powered by EventHubix • This PDF is system-generated and valid for admission.',
                    50,
                    760,
                    { width: 500, align: 'center' }
                );
            });
            doc.end();
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=\"tickets-${order.id}.pdf\"`);
        return res.send(pdfBuffer);
    } catch (error) {
        console.error('Ticket download error:', error);
        return res.status(500).json({ error: 'Failed to generate ticket PDF' });
    }
});

/**
 * @route GET /api/public/promo/:eventId/:code
 * @desc  Validate a promo code
 */
router.get('/promo/:eventId/:code', async (req, res) => {
    const { eventId, code } = req.params;
    try {
        const promo = await prisma.promocode.findUnique({
            where: {
                eventId_code: {
                    eventId: parseInt(eventId),
                    code: code.toUpperCase()
                }
            }
        });

        if (!promo) {
            return res.status(404).json({ error: 'Invalid promo code' });
        }

        // Check expiry and usage
        if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
            return res.status(400).json({ error: 'Promo code expired' });
        }

        if (promo.maxUsage > 0 && promo.currentUsage >= promo.maxUsage) {
            return res.status(400).json({ error: 'Promo code use limit reached' });
        }

        res.json({
            code: promo.code,
            discountType: promo.discountType.toLowerCase(),
            value: promo.discountValue
        });
    } catch (error) {
        console.error('Promo validation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/stats
 * @desc  Get platform-wide statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const totalEvents = await prisma.event.count({
            where: { status: 'APPROVED' }
        });

        const events = await prisma.event.findMany({
            select: { ticketsSold: true }
        });
        const totalTicketsSold = events.reduce((acc, e) => acc + (e.ticketsSold || 0), 0);

        res.json({
            totalEvents,
            totalTicketsSold
        });
    } catch (error) {
        console.error('Error fetching public stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/settings
 * @desc  Get platform settings (currency) - public, no auth required
 */
router.get('/settings', async (req, res) => {
    try {
        let settings = await prisma.platformsettings.findFirst();
        if (!settings) {
            settings = await prisma.platformsettings.create({ data: { currency: 'AUD' } });
        }
        res.json(settings);
    } catch (error) {
        console.error('Get public settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/blogs
 * @desc  Get all published blog posts
 */
router.get('/blogs', async (req, res) => {
    try {
        const blogs = await prisma.blog.findMany({
            where: { status: 'PUBLISHED' },
            orderBy: { publishedAt: 'desc' }
        });
        res.json(blogs);
    } catch (error) {
        console.error('Error fetching public blogs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/blogs/:slug
 * @desc  Get a single blog post by slug
 */
router.get('/blogs/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const blog = await prisma.blog.findUnique({
            where: { slug, status: 'PUBLISHED' }
        });
        if (!blog) return res.status(404).json({ error: 'Blog post not found' });
        res.json(blog);
    } catch (error) {
        console.error('Error fetching blog post:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route POST /api/public/newsletter/subscribe
 * @desc  Subscribe a new email to the newsletter
 */
router.post('/newsletter/subscribe', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ error: 'Please provide a valid email address.' });
        }

        // Check if already subscribed
        const existing = await prisma.newsletter.findUnique({
            where: { email: email.toLowerCase() }
        });

        if (existing) {
            // Already subscribed, return 200 to be friendly and not leak existence too harshly
            return res.status(200).json({ message: "You're already subscribed! Stay tuned for updates." });
        }

        // Save to DB
        await prisma.newsletter.create({
            data: { email: email.toLowerCase() }
        });

        // Trigger welcome email (fire-and-forget)
        const { sendNewsletterWelcome } = require('../../services/emailService');
        setImmediate(() => {
            sendNewsletterWelcome(email).catch(err => {
                console.error('[NEWSLETTER_EMAIL_ERROR]', err.message);
            });
        });

        res.status(201).json({ message: 'Welcome to the loop! Please check your email.' });
    } catch (error) {
        console.error('Newsletter subscription error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/legal/:key
 * @desc  Get a legal setting by key (privacy_policy, terms_and_conditions, etc.)
 */
router.get('/legal/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const setting = await prisma.settings.findUnique({
            where: { key }
        });
        
        if (!setting) {
            return res.status(404).json({ error: 'Legal content not found' });
        }
        
        res.json(setting);
    } catch (error) {
        console.error('Error fetching legal content:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/public/faqs
 * @desc  Get all FAQs grouped by category
 */
router.get('/faqs', async (req, res) => {
    try {
        const faqs = await prisma.faq.findMany({
            orderBy: {
                id: 'asc'
            }
        });
        
        // Group by category for easier frontend handling
        const grouped = faqs.reduce((acc, faq) => {
            const existingCat = acc.find(cat => cat.category === faq.category);
            if (existingCat) {
                existingCat.items.push(faq);
            } else {
                acc.push({
                    category: faq.category,
                    items: [faq]
                });
            }
            return acc;
        }, []);
        
        res.json(grouped);
    } catch (error) {
        console.error('Error fetching public FAQs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
