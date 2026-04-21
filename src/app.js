// FORCED RESTART TO APPLY FEE STABILITY FIXES
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middlewares
const normalizedFrontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const allowedOrigins = new Set([
    'http://event.kiaansoftware.com',
    'https://event.kiaansoftware.com',
    normalizedFrontendUrl
].filter(Boolean));

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        const normalizedOrigin = origin.replace(/\/$/, '');
        const isAllowed = normalizedOrigin.includes('localhost') ||
                          normalizedOrigin.includes('127.0.0.1') ||
                          normalizedOrigin.includes('ngrok') ||
                          allowedOrigins.has(normalizedOrigin);

        if (isAllowed) return callback(null, true);

        console.warn(`[CORS] Rejected origin: ${origin}`);
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// Stripe Webhook (MUST be before express.json() for raw body signature check)
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), (req, res) => {
    require('./modules/payments/stripe.webhook').handleWebhook(req, res);
});

app.use(express.json());

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Routes
const authRoutes = require('./modules/auth/auth.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const organizerRoutes = require('./modules/owner/organizer.routes');
const tenantRoutes = require('./modules/tenant/tenant.routes');
const publicRoutes = require('./modules/tenant/public.routes');
const blogAdminRoutes = require('./modules/admin/blog.routes');

app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/organizer', organizerRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/tickets', tenantRoutes);
app.use('/api/admin/blogs', blogAdminRoutes);
app.use('/api/payments', require('./modules/payments/payments.routes'));

module.exports = app;
