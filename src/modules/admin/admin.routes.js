const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../../config/db');
const { requireAuth, requireRole } = require('../../middlewares/authMiddleware');

const router = express.Router();

/**
 * @route GET /api/admin/events/moderation-stats
 * @desc  Get stats for moderation dashboard
 */
router.get('/events/moderation-stats', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const [pendingCount, suspendedUsers, totalReviewed, approvedCount] = await Promise.all([
            prisma.event.count({ where: { status: 'PENDING' } }),
            prisma.user.count({ where: { status: 'SUSPENDED' } }),
            prisma.event.count({
                where: {
                    status: { in: ['APPROVED', 'REJECTED'] }
                }
            }),
            prisma.event.count({ where: { status: 'APPROVED' } })
        ]);

        const approvalRate = totalReviewed > 0
            ? Math.round((approvedCount / totalReviewed) * 100)
            : 0;

        res.json({
            pendingCount,
            suspendedUsers,
            approvalRate,
            flaggedReports: 0 // Placeholder for future report system
        });
    } catch (error) {
        console.error('Moderation stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/admin/events
 * @desc  Get all events for moderation
 */
router.get('/events', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const events = await prisma.event.findMany({
            include: {
                user_event_organizerIdTouser: {
                    select: {
                        name: true,
                        email: true
                    }
                },
                user_event_reviewedByIdTouser: {
                    select: {
                        name: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Map responses for frontend
        const mappedEvents = events.map(e => ({
            ...e,
            organiser: e.user_event_organizerIdTouser,
            reviewedBy: e.user_event_reviewedByIdTouser
        }));

        res.json(mappedEvents);
    } catch (error) {
        console.error('Error fetching admin events:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/admin/events/history
 * @desc  Get history of reviewed events (Approved/Rejected)
 */
router.get('/events/history', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const history = await prisma.event.findMany({
            where: {
                status: { in: ['APPROVED', 'REJECTED'] }
            },
            include: {
                user_event_organizerIdTouser: {
                    select: { name: true }
                },
                user_event_reviewedByIdTouser: {
                    select: { name: true }
                }
            },
            orderBy: {
                updatedAt: 'desc'
            }
        });

        const mappedHistory = history.map(e => ({
            id: e.id,
            eventId: e.id, // for details lookup
            organizerId: e.organizerId,
            eventName: e.title,
            category: e.category,
            location: e.location,
            eventDate: e.eventDate,
            ticketPrice: e.ticketPrice,
            totalTickets: e.totalTickets,
            organiser: e.user_event_organizerIdTouser?.name || 'Unknown',
            decision: e.status === 'APPROVED' ? 'Approved' : 'Rejected',
            reviewedBy: e.user_event_reviewedByIdTouser?.name || 'Platform Admin',
            reason: e.rejectionReason,
            date: e.updatedAt || e.createdAt
        }));

        res.json(mappedHistory);
    } catch (error) {
        console.error('Error fetching review history:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/admin/events/:id
 * @desc  Get full detailed event for admin audit
 */
router.get('/events/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid event identifier provided' });
        }

        const eventDetail = await prisma.event.findUnique({
            where: { id: id },
            include: {
                user_event_organizerIdTouser: {
                    select: { name: true, email: true, mobile: true }
                },
                user_event_reviewedByIdTouser: {
                    select: { name: true }
                },
                eventimage: true,
                ticketrelease: true,
                promocode: true,
                eventschedule: {
                    orderBy: { orderIndex: 'asc' }
                }
            }
        });

        if (!eventDetail) {
            return res.status(404).json({ error: 'Event record not found' });
        }

        res.json(eventDetail);
    } catch (error) {
        console.error('Error fetching admin event detail:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
/**
 * @route GET /api/admin/dashboard
 * @desc  Get system-wide stats and recent events for admin dashboard
 */
router.get('/dashboard', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const now = new Date();
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

        const [
            totalEvents,
            pendingEvents,
            totalUsers,
            totalTickets,
            recentEvents,
            eventsLastMonth,
            usersLastMonth,
            totalOrganizers
        ] = await Promise.all([
            prisma.event.count(),
            prisma.event.count({ where: { status: 'PENDING' } }),
            prisma.user.count(),
            prisma.ticket.count(),
            prisma.event.findMany({
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: {
                    user_event_organizerIdTouser: {
                        select: { name: true }
                    }
                }
            }),
            prisma.event.count({ where: { createdAt: { gte: lastMonth } } }),
            prisma.user.count({ where: { createdAt: { gte: lastMonth } } }),
            prisma.user.count({ where: { role: 'ORGANIZER' } })
        ]);

        const settledOrders = await prisma.purchaseorder.findMany({
            where: { paymentStatus: 'SUCCESS', status: 'COMPLETED' },
            select: {
                amount: true,
                platformFee: true,
                platformFeeCents: true
            }
        });

        const resolveOrderFee = (order) => {
            if (order.platformFee !== null && order.platformFee !== undefined) return Number(order.platformFee) || 0;
            if (order.platformFeeCents !== null && order.platformFeeCents !== undefined) return (Number(order.platformFeeCents) || 0) / 100;
            return 0;
        };

        const totalRevenue = settledOrders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
        const platformRevenue = settledOrders.reduce((sum, order) => sum + resolveOrderFee(order), 0);
        const netRevenue = totalRevenue - platformRevenue;

        // Calculate Growth Percentages
        const eventGrowth = totalEvents > eventsLastMonth
            ? Math.round(((totalEvents - (totalEvents - eventsLastMonth)) / (totalEvents - eventsLastMonth || 1)) * 100)
            : 0;

        const userGrowth = totalUsers > usersLastMonth
            ? Math.round(((totalUsers - (totalUsers - usersLastMonth)) / (totalUsers - usersLastMonth || 1)) * 100)
            : 0;

        res.json({
            totalEvents,
            pendingEvents,
            totalUsers,
            totalTicketsSold: totalTickets,
            totalGrossRevenue: totalRevenue,
            totalPlatformRevenue: platformRevenue,
            totalNetRevenue: netRevenue,
            eventGrowth: `+${eventsLastMonth} this month`,
            userGrowth: `+${usersLastMonth} this month`,
            totalOrganizers,
            recentEvents: recentEvents.map(e => ({
                ...e,
                organizerName: e.user_event_organizerIdTouser?.name || 'Unknown'
            }))
        });
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/admin/stats
 * @desc  Get system-wide stats for admin dashboard (Legacy/Compact)
 */
router.get('/stats', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const [totalEvents, pendingEvents, totalUsers, totalTickets] = await Promise.all([
            prisma.event.count(),
            prisma.event.count({ where: { status: 'PENDING' } }),
            prisma.user.count(),
            prisma.ticket.count()
        ]);

        const settledOrders = await prisma.purchaseorder.findMany({
            where: { paymentStatus: 'SUCCESS', status: 'COMPLETED' },
            select: {
                amount: true,
                platformFee: true,
                platformFeeCents: true
            }
        });

        const resolveOrderFee = (order) => {
            if (order.platformFee !== null && order.platformFee !== undefined) return Number(order.platformFee) || 0;
            if (order.platformFeeCents !== null && order.platformFeeCents !== undefined) return (Number(order.platformFeeCents) || 0) / 100;
            return 0;
        };

        const totalRevenue = settledOrders.reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
        const platformRevenue = settledOrders.reduce((sum, order) => sum + resolveOrderFee(order), 0);

        res.json({
            totalEvents,
            pendingEvents,
            totalUsers,
            ticketsSold: totalTickets,
            revenue: totalRevenue,
            platformRevenue
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/events/:id/status
 * @desc  Update event status
 */
router.patch('/events/:id/status', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { status, reason } = req.body;

    try {
        const updatedEvent = await prisma.event.update({
            where: { id: parseInt(id) },
            data: {
                status,
                reviewedById: req.user.id,
                rejectionReason: status === 'REJECTED' ? reason : null
            }
        });
        res.json(updatedEvent);
    } catch (error) {
        console.error('Error updating event status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/admin/users
 * @desc  Get all users
 */
router.get('/users', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
                mobile: true,
                organizerStatus: true,
                businessName: true,
                abn: true,
                businessAddress: true,
                bankAccountName: true,
                bsb: true,
                accountNumber: true,
                isVerified: true,
                createdAt: true,
                updatedAt: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/users/:id/role
 * @desc  Change user role
 */
router.patch('/users/:id/role', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['ADMIN', 'ORGANIZER', 'TENANT', 'STAFF'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { role }
        });
        res.json(user);
    } catch (error) {
        console.error('Update role error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/users/:id/status
 * @desc  Update user status (SUSPENDED/ACTIVE)
 */
router.patch('/users/:id/status', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const validStatus = ['ACTIVE', 'SUSPENDED'];
    if (!validStatus.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
    }

    // Safety: Prevent self-suspension
    if (parseInt(id) === req.user.id && status === 'SUSPENDED') {
        return res.status(403).json({ error: 'Safety Guard: You cannot suspend your own account.' });
    }

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { status }
        });
        res.json(user);
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/users/:id/verify
 * @desc  Toggle user verification status
 */
router.patch('/users/:id/verify', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { isVerified } = req.body;

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { isVerified: !!isVerified }
        });
        res.json(user);
    } catch (error) {
        console.error('Update verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route GET /api/admin/organizer-requests
 * @desc  Get all organizers for approval
 */
router.get('/organizer-requests', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { status } = req.query; // optional filter: PENDING | APPROVED | REJECTED

    try {
        const where = { role: 'ORGANIZER' };
        if (status) {
            where.organizerStatus = status;
        }

        const organizers = await prisma.user.findMany({
            where,
            select: {
                id: true,
                name: true,
                email: true,
                organizerStatus: true,
                status: true,
                mobile: true,
                createdAt: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(organizers);
    } catch (error) {
        console.error('Error fetching organizer requests:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/organizers/:id/approve
 * @desc  Approve organizer account
 */
router.patch('/organizers/:id/approve', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { organizerStatus: 'APPROVED' }
        });
        res.json({ message: 'Organizer approved successfully', user });
    } catch (error) {
        console.error('Approve organizer error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/organizers/:id/reject
 * @desc  Reject organizer account
 */
router.patch('/organizers/:id/reject', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;

    try {
        const user = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { organizerStatus: 'REJECTED' }
        });
        res.json({ message: 'Organizer rejected successfully', user });
    } catch (error) {
        console.error('Reject organizer error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Platform Settings (Currency) ───────────────────────────────────────────

/**
 * @route GET /api/admin/settings
 * @desc  Get platform settings (currency)
 */
router.get('/settings', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        let settings = await prisma.platformsettings.findFirst();
        if (!settings) {
            // Seed default row if none exists
            settings = await prisma.platformsettings.create({ data: { currency: 'AUD' } });
        }
        res.json(settings);
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/settings
 * @desc  Update platform settings (currency)
 */
router.patch('/settings', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { currency, platformFeeRate, platformFeeFixed } = req.body;

    const updateData = {};
    if (currency) {
        // NOTE: Only AUD is active. Uncomment others when client wants multi-currency support.
        const SUPPORTED = ['AUD' /*, 'USD', 'INR', 'EUR', 'GBP', 'SGD', 'NZD', 'CAD' */];
        if (!SUPPORTED.includes(currency)) {
            return res.status(400).json({ error: `Unsupported currency. Allowed: ${SUPPORTED.join(', ')}` });
        }
        updateData.currency = currency;
    }

    if (platformFeeRate !== undefined) {
        const rate = parseFloat(platformFeeRate);
        if (isNaN(rate) || rate < 0) return res.status(400).json({ error: 'Invalid fee rate' });
        updateData.platformFeeRate = rate;
    }

    if (platformFeeFixed !== undefined) {
        const fixed = parseFloat(platformFeeFixed);
        if (isNaN(fixed) || fixed < 0) return res.status(400).json({ error: 'Invalid fixed fee' });
        updateData.platformFeeFixed = fixed;
        updateData.platformFeeFixedCents = Math.round(fixed * 100);
    }

    try {
        let settings = await prisma.platformsettings.findFirst();
        if (!settings) {
            settings = await prisma.platformsettings.create({ data: updateData });
        } else {
            settings = await prisma.platformsettings.update({ where: { id: settings.id }, data: updateData });
        }
        res.json({ message: 'Settings updated successfully', settings });
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─── Payout Management ──────────────────────────────────────────────────────

/**
 * @route GET /api/admin/organizers
 * @desc  Get all organizers with earnings, payout history and pending status
 */
router.get('/organizers', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    try {
        const settings = await prisma.platformsettings.findFirst() || await prisma.platformsettings.create({ data: {} });
        const feeRate = Number(settings.platformFeeRate) || 0;
        const fixedFee = Number(settings.platformFeeFixed) || 0;

        const toCents = (order) => {
            if (order.amountCents !== null && order.amountCents !== undefined) return Number(order.amountCents) || 0;
            if (order.amount !== null && order.amount !== undefined) return Math.round((Number(order.amount) || 0) * 100);
            if (order.amountPaidCents !== null && order.amountPaidCents !== undefined) return Number(order.amountPaidCents) || 0;
            return 0;
        };
        const resolveStoredFeeCents = (order) => {
            if (order.platformFeeCents !== null && order.platformFeeCents !== undefined) return Number(order.platformFeeCents) || 0;
            if (order.platformFee !== null && order.platformFee !== undefined) return Math.round((Number(order.platformFee) || 0) * 100);
            return 0;
        };
        const resolveEffectiveFeeCents = (order, feeType) => {
            if (feeType === 'ORGANIZER') {
                const amount = toCents(order) / 100;
                const qty = Number(order.quantity) || 0;
                if (amount <= 0 || qty <= 0) return 0;
                return Math.round((((amount * feeRate) + (fixedFee * qty)) * 100));
            }
            return resolveStoredFeeCents(order);
        };

        const organizers = await prisma.user.findMany({
            where: { role: 'ORGANIZER' },
            select: {
                id: true,
                name: true,
                email: true,
                mobile: true,
                organizerStatus: true,
                isVerified: true,
                businessName: true,
                abn: true,
                bankAccountName: true,
                bsb: true,
                accountNumber: true,
                createdAt: true,
                payout: {
                    orderBy: { createdAt: 'desc' }
                },
                event_event_organizerIdTouser: {
                    include: {
                        purchaseorder: {
                            where: { paymentStatus: 'SUCCESS' },
                            select: {
                                amount: true,
                                amountCents: true,
                                amountPaidCents: true,
                                platformFee: true,
                                platformFeeCents: true,
                                refundedAmount: true,
                                quantity: true
                            }
                        }
                    }
                }
            }
        });

        const mappedOrganizers = organizers.map(org => {
            // Aggregate Earnings and fee split by fee payer type.
            let totalEarnedCents = 0;
            let buyerPaidPlatformFeeCents = 0;
            let organizerPaidPlatformFeeCents = 0;
            org.event_event_organizerIdTouser.forEach(ev => {
                ev.purchaseorder.forEach(po => {
                    const settledAmountCents = toCents(po);
                    const feeCents = resolveEffectiveFeeCents(po, ev.serviceFeeType);
                    const refundCents = Math.round((po.refundedAmount || 0) * 100);
                    const netAfterRefundCents = Math.max(0, settledAmountCents - refundCents);

                    const organizerReceivableCents = ev.serviceFeeType === 'BUYER'
                        ? Math.max(0, netAfterRefundCents - feeCents)
                        : netAfterRefundCents;

                    totalEarnedCents += organizerReceivableCents;
                    if (ev.serviceFeeType === 'BUYER') {
                        buyerPaidPlatformFeeCents += feeCents;
                    } else if (ev.serviceFeeType === 'ORGANIZER') {
                        organizerPaidPlatformFeeCents += feeCents;
                    }
                });
            });

            // Aggregate Paid Out
            const totalPaidCents = org.payout
                .filter(p => p.status === 'PAID')
                .reduce((sum, p) => sum + p.amountCents, 0);

            const pendingPayoutCount = org.payout.filter(p => p.status === 'PENDING').length;
            const availableBalanceCents = totalEarnedCents - totalPaidCents;

            return {
                id: org.id,
                name: org.name,
                email: org.email,
                mobile: org.mobile,
                businessName: org.businessName,
                abn: org.abn,
                bankDetails: {
                    accountName: org.bankAccountName,
                    bsb: org.bsb ? "XXXXXX" : null,
                    accountNumber: org.accountNumber ? `XXXXXX${org.accountNumber.slice(-4)}` : null
                },
                stats: {
                    totalEarned: totalEarnedCents / 100,
                    totalPayoutGenerated: totalEarnedCents / 100,
                    totalPaid: totalPaidCents / 100,
                    availableBalance: availableBalanceCents / 100,
                    buyerPaidPlatformFees: buyerPaidPlatformFeeCents / 100,
                    organizerPaidPlatformFees: organizerPaidPlatformFeeCents / 100,
                    totalEarnedCents,
                    totalPayoutGeneratedCents: totalEarnedCents,
                    totalPaidCents,
                    availableBalanceCents,
                    buyerPaidPlatformFeeCents,
                    organizerPaidPlatformFeeCents
                },
                hasPendingPayout: pendingPayoutCount > 0,
                payoutHistory: org.payout,
                events: org.event_event_organizerIdTouser, // <--- Include events
                isVerified: org.isVerified,
                createdAt: org.createdAt
            };
        });

        res.json(mappedOrganizers);
    } catch (error) {
        console.error('Error fetching admin organizers:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route POST /api/admin/organizers/:id/payouts
 * @desc  Create a new manual payout request
 */
router.post('/organizers/:id/payouts', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { amount, notes } = req.body; // Amount in Dollars (float), optional notes

    try {
        const toCents = (order) => {
            if (order.amountCents !== null && order.amountCents !== undefined) return Number(order.amountCents) || 0;
            if (order.amount !== null && order.amount !== undefined) return Math.round((Number(order.amount) || 0) * 100);
            if (order.amountPaidCents !== null && order.amountPaidCents !== undefined) return Number(order.amountPaidCents) || 0;
            return 0;
        };
        const resolveFeeCents = (order) => {
            if (order.platformFeeCents !== null && order.platformFeeCents !== undefined) return Number(order.platformFeeCents) || 0;
            if (order.platformFee !== null && order.platformFee !== undefined) return Math.round((Number(order.platformFee) || 0) * 100);
            return 0;
        };

        const organizerId = parseInt(id);
        const amountCents = Math.round(parseFloat(amount) * 100);

        if (isNaN(amountCents) || amountCents <= 0) {
            return res.status(400).json({ error: 'Invalid payout amount' });
        }

        // 1. Fetch Organizer & Calc Balance
        const org = await prisma.user.findUnique({
            where: { id: organizerId },
            include: {
                payout: true,
                event_event_organizerIdTouser: {
                    include: {
                        purchaseorder: {
                            where: { paymentStatus: 'SUCCESS' },
                            select: {
                                amount: true,
                                amountCents: true,
                                amountPaidCents: true,
                                platformFee: true,
                                platformFeeCents: true,
                                refundedAmount: true
                            }
                        }
                    }
                }
            }
        });

        if (!org || org.role !== 'ORGANIZER') {
            return res.status(404).json({ error: 'Organizer not found' });
        }

        // 2. Pending Check (Guard)
        const hasPending = org.payout.some(p => p.status === 'PENDING');
        if (hasPending) {
            return res.status(400).json({ error: 'A pending payout already exists for this organizer' });
        }

        // 3. Balance Check (Guard)
        let totalEarnedCents = 0;
        org.event_event_organizerIdTouser.forEach(ev => {
            ev.purchaseorder.forEach(po => {
                const settledAmountCents = toCents(po);
                const feeCents = resolveFeeCents(po);
                const refundCents = Math.round((po.refundedAmount || 0) * 100);
                const netAfterRefundCents = Math.max(0, settledAmountCents - refundCents);
                const organizerReceivableCents = ev.serviceFeeType === 'BUYER'
                    ? Math.max(0, netAfterRefundCents - feeCents)
                    : netAfterRefundCents;
                totalEarnedCents += organizerReceivableCents;
            });
        });
        const totalPaidCents = org.payout.filter(p => p.status === 'PAID').reduce((sum, p) => sum + p.amountCents, 0);
        const availableCents = totalEarnedCents - totalPaidCents;

        if (amountCents > availableCents) {
            return res.status(400).json({ error: `Payout exceeds available balance ($${availableCents / 100})` });
        }

        // 4. Create Payout with Audit Snapshot
        const payout = await prisma.payout.create({
            data: {
                organizerId,
                amountCents,
                currency: 'AUD',
                status: 'PENDING',
                bankDetailsSnapshot: {
                    bsb: org.bsb,
                    accountNumber: org.accountNumber,
                    businessName: org.businessName
                },
                notes: notes || null
            }
        });

        res.status(201).json(payout);
    } catch (error) {
        console.error('Create payout error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PATCH /api/admin/payouts/:id/status
 * @desc  Mark a payout as PAID
 */
router.patch('/payouts/:id/status', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (status !== 'PAID') {
        return res.status(400).json({ error: 'Only transition to PAID is allowed' });
    }

    try {
        const payoutId = parseInt(id);
        const existing = await prisma.payout.findUnique({ where: { id: payoutId } });

        if (!existing) {
            return res.status(404).json({ error: 'Payout record not found' });
        }

        if (existing.status === 'PAID') {
            return res.status(400).json({ error: 'Payout has already been completed' });
        }

        const updatedPayout = await prisma.payout.update({
            where: { id: payoutId },
            data: {
                status: 'PAID',
                paidAt: new Date(),
                notes: notes !== undefined ? notes : existing.notes
            }
        });

        res.json(updatedPayout);
    } catch (error) {
        console.error('Update payout status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route POST /api/admin/settings
 * @desc  Update a platform setting (privacy_policy, terms, etc.)
 */
router.post('/settings', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { key, value } = req.body;
    
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }
    
    try {
        const setting = await prisma.settings.upsert({
            where: { key },
            update: { value },
            create: { key, value }
        });
        
        res.json(setting);
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route POST /api/admin/faqs
 * @desc  Create a new FAQ
 */
router.post('/faqs', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { category, question, answer, orderIndex } = req.body;
    
    try {
        const faq = await prisma.faq.create({
            data: { 
                category, 
                question, 
                answer, 
                orderIndex: orderIndex || 0 
            }
        });
        
        res.json(faq);
    } catch (error) {
        console.error('Create FAQ error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route PUT /api/admin/faqs/:id
 * @desc  Update an existing FAQ
 */
router.put('/faqs/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    const { category, question, answer, orderIndex } = req.body;
    
    try {
        const faqIdx = parseInt(id);
        const faq = await prisma.faq.update({
            where: { id: faqIdx },
            data: { 
                category, 
                question, 
                answer, 
                orderIndex: orderIndex !== undefined ? orderIndex : undefined 
            }
        });
        
        res.json(faq);
    } catch (error) {
        console.error('Update FAQ error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * @route DELETE /api/admin/faqs/:id
 * @desc  Delete an FAQ
 */
router.delete('/faqs/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
    const { id } = req.params;
    
    try {
        await prisma.faq.delete({
            where: { id: parseInt(id) }
        });
        
        res.json({ message: 'FAQ deleted successfully' });
    } catch (error) {
        console.error('Delete FAQ error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
