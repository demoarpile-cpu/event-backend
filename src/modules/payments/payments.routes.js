const express = require('express');
const router = express.Router();
const { createCheckoutSession, getOrderStatus } = require('./stripe.controller');

// Payment Initiation
router.post('/create-session', createCheckoutSession);

// Status Polling (Secure verification for frontend)
router.get('/order/:orderId', getOrderStatus);

module.exports = router;
