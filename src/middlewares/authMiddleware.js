const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const requireAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersafe_jwt_secret_for_local_development');
        req.user = decoded; // { id, role, email... }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized: Token expired or invalid' });
    }
};

const requireRole = (allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
        }
        next();
    };
};

/**
 * For ORGANIZER role only: require live DB organizerStatus === APPROVED.
 * ADMIN/TENANT pass through unchanged.
 */
const requireApprovedOrganizer = async (req, res, next) => {
    if (!req.user || req.user.role !== 'ORGANIZER') {
        return next();
    }

    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { organizerStatus: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (user.organizerStatus === 'REJECTED') {
            return res.status(403).json({
                error: 'Your organizer account application has been rejected. Please contact support.'
            });
        }

        if (user.organizerStatus !== 'APPROVED') {
            return res.status(403).json({
                error: 'Your organizer account is awaiting admin approval. Please wait until admin approves your request.'
            });
        }

        next();
    } catch (err) {
        console.error('requireApprovedOrganizer error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    requireAuth,
    requireRole,
    requireApprovedOrganizer
};
