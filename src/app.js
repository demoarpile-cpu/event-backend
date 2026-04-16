const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middlewares
app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        
        const isAllowed = origin.includes('localhost') || 
                          origin.includes('127.0.0.1') || 
                          origin.includes('ngrok') || 
                          origin.includes('netlify.app') ||
                          origin === 'https://event-ticket-platform1.netlify.app';
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Rejected origin: ${origin}`);
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning']
}));
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
