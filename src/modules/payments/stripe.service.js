const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Service to handle Stripe interactions
 */
const stripeService = {
    /**
     * Create a Stripe Checkout Session
     * @param {Object} data - session data
     */
    async createCheckoutSession({ orderId, eventTitle, ticketName, quantity, price, customerEmail, metadata, frontendUrl }) {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY is not configured in environment variables.');
        }

        // Robust URL resolution: Use dynamic origin if provided, else fallback to ENV
        const baseTarget = (frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        const successUrl = `${baseTarget}/order-success?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`;
        const cancelUrl = metadata.eventId 
            ? `${baseTarget}/events/${metadata.eventId}`
            : `${baseTarget}/home`;

        console.log(`[STRIPE_SESSION_CREATE] orderId=${orderId} successUrl=${successUrl} cancelUrl=${cancelUrl}`);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            customer_email: customerEmail,
            line_items: [
                {
                    price_data: {
                        currency: (process.env.STRIPE_CURRENCY || 'aud').trim(),
                        product_data: {
                            name: `${eventTitle} - ${ticketName}`,
                            description: `Order ID: ${orderId}`,
                        },
                        unit_amount: price, 
                    },
                    quantity: quantity,
                },
            ],
            mode: 'payment',
            metadata: {
                ...metadata,
                orderId
            },
            payment_intent_data: {
                metadata: {
                    ...metadata,
                    orderId
                }
            },
            success_url: successUrl,
            cancel_url: cancelUrl,
            expires_at: Math.floor(Date.now() / 1000) + (30 * 60) 
        });

        return session;
    },

    /**
     * Retrieve a Stripe Checkout Session
     */
    async getSession(sessionId) {
        return await stripe.checkout.sessions.retrieve(sessionId);
    },

    /**
     * Retrieve a Stripe Payment Intent
     */
    async getPaymentIntent(paymentIntentId) {
        return await stripe.paymentIntents.retrieve(paymentIntentId);
    },

    /**
     * Construct a webhook event and verify signature
     */
    constructEvent(payload, signature) {
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
            throw new Error('STRIPE_WEBHOOK_SECRET is missing.');
        }
        return stripe.webhooks.constructEvent(
            payload,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    }
};

module.exports = stripeService;
