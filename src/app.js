const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
const allowedOrigins = [
  'http://event.kiaansoftware.com',
  'https://event.kiaansoftware.com',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.ngrok-free.app')
    ) {
      return callback(null, true);
    }

    console.log('CORS Blocked:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning'
  ]
}));

// ✅ FIXED preflight
app.options('*', (req, res) => {
    res.sendStatus(204);
});

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
