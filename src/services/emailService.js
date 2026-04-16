const sgMail = require('@sendgrid/mail');
const qrcode = require('qrcode');
const puppeteer = require('puppeteer');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

// Configure SendGrid — fail explicitly if key is missing
if (!process.env.SENDGRID_API_KEY) {
    console.error('[EMAIL_FATAL] SENDGRID_API_KEY is not set. All outgoing emails will be skipped.');
} else {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    console.log('[EMAIL_INIT] SendGrid API key configured successfully.');
}

if (!process.env.SENDGRID_FROM_EMAIL) {
    console.error('[EMAIL_FATAL] SENDGRID_FROM_EMAIL is not set. Emails cannot be sent without a verified sender.');
}

// Structured sender with name for proper domain alignment and DMARC compliance
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL
    ? { name: 'EventHubix', email: process.env.SENDGRID_FROM_EMAIL }
    : null;
const REPLY_TO_EMAIL = process.env.SENDGRID_REPLY_TO_EMAIL || process.env.ADMIN_EMAIL;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const BACKEND_BASE_URL = (process.env.BACKEND_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
const TICKET_DOWNLOAD_TOKEN_SECRET = process.env.TICKET_DOWNLOAD_TOKEN_SECRET || process.env.JWT_SECRET || 'local_ticket_download_secret';

// Puppeteer Singleton Browser Manager
let browserInstance = null;
async function getBrowser() {
    if (!browserInstance || !browserInstance.isConnected()) {
        try {
            if (browserInstance) {
                await browserInstance.close().catch(() => {});
            }
            browserInstance = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            console.log('[BROWSER] Singleton browser instance launched.');
            
            browserInstance.on('disconnected', () => {
                console.log('[BROWSER] Browser disconnected.');
                browserInstance = null;
            });
        } catch (error) {
            console.error('[BROWSER_ERROR] Failed to launch browser:', error.message);
            throw error;
        }
    }
    return browserInstance;
}

/**
 * Helper to wrap a promise with a timeout
 */
function withTimeout(promise, ms, errorName) {
    const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${errorName} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]);
}

function createTicketDownloadToken(orderId, email, ttlSeconds = 60 * 60 * 24 * 30) {
    const payload = {
        orderId: String(orderId),
        email: String(email || '').toLowerCase(),
        exp: Date.now() + (ttlSeconds * 1000)
    };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', TICKET_DOWNLOAD_TOKEN_SECRET).update(encoded).digest('base64url');
    return `${encoded}.${sig}`;
}

function verifyTicketDownloadToken(token, expectedOrderId, expectedEmail) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return false;
    const [encoded, providedSig] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', TICKET_DOWNLOAD_TOKEN_SECRET).update(encoded).digest('base64url');

    if (!providedSig) return false;
    const providedSigBuffer = Buffer.from(providedSig);
    const expectedSigBuffer = Buffer.from(expectedSig);
    if (providedSigBuffer.length !== expectedSigBuffer.length) return false;
    if (!crypto.timingSafeEqual(providedSigBuffer, expectedSigBuffer)) return false;

    try {
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        if (!payload || payload.orderId !== String(expectedOrderId)) return false;
        if ((payload.email || '').toLowerCase() !== String(expectedEmail || '').toLowerCase()) return false;
        if (!payload.exp || Date.now() > Number(payload.exp)) return false;
        return true;
    } catch {
        return false;
    }
}

/**
 * Generate QR Code as Base64 Data URL
 */
async function generateQRCode(payload, orderId = 'N/A') {
    try {
        const dataUrl = await withTimeout(qrcode.toDataURL(payload), 5000, 'QR_GENERATION');
        return dataUrl;
    } catch (error) {
        console.error(`[QR_ERROR] orderId=${orderId} error=${error.message}`);
        return null;
    }
}

/**
 * Generate a minimalist PDF ticket
 */
async function generateTicketPDF(eventData, attendeeData, orderData, qrCodes) {
    let page = null;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        const safeTitle = eventData.title || 'Event Ticket';
        const safeDate = eventData.eventDate
            ? new Date(eventData.eventDate).toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short' })
            : 'Date TBA';
        const safeLocation = eventData.location || 'Venue TBA';
        const safeEmail = attendeeData.email || 'N/A';
        const currency = (orderData.currency || 'AUD').toUpperCase();
        const orderAmount = typeof orderData.amount === 'number'
            ? `${currency} ${orderData.amount.toFixed(2)}`
            : `${currency} ${orderData.amount || '0.00'}`;

        const ticketsHtml = qrCodes.map((qr, index) => `
            <section class="sheet" style="${index < qrCodes.length - 1 ? 'page-break-after: always;' : ''}">
                <div class="ticket-shell">
                    <header class="hero">
                        <p class="eyebrow">Invoice Manifest</p>
                        <h1>${safeTitle}</h1>
                        <p class="hero-meta">${safeDate}</p>
                        <p class="hero-meta">${safeLocation}</p>
                    </header>

                    <div class="row">
                        <div class="cell">
                            <span class="label">Order ID</span>
                            <strong>${orderData.id}</strong>
                        </div>
                        <div class="cell">
                            <span class="label">Pass</span>
                            <strong>${index + 1} of ${qrCodes.length}</strong>
                        </div>
                    </div>

                    <div class="row">
                        <div class="cell">
                            <span class="label">Attendee</span>
                            <strong>${attendeeData.name}</strong>
                            <p class="muted">${safeEmail}</p>
                        </div>
                        <div class="cell align-right">
                            <span class="label">Final Total</span>
                            <strong class="total">${orderAmount}</strong>
                        </div>
                    </div>

                    <div class="qr-wrap">
                        <img class="qr-image" src="${qr}" alt="Ticket QR ${index + 1}" />
                        <p class="muted">Scan this QR at event entry gate</p>
                    </div>

                    <footer class="footer">
                        Powered by EventHubix • This PDF is system-generated and valid for admission.
                    </footer>
                </div>
            </section>
        `).join('');

        const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    * { box-sizing: border-box; }
                    body { font-family: Inter, Arial, sans-serif; margin: 0; color: #0f172a; background: #f3f4f6; }
                    .sheet { padding: 24px; min-height: 100vh; }
                    .ticket-shell {
                        max-width: 700px;
                        margin: 0 auto;
                        border-radius: 28px;
                        background: #0b1438;
                        color: #fff;
                        padding: 28px;
                        border: 1px solid rgba(255,255,255,0.12);
                    }
                    .hero { border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 16px; margin-bottom: 16px; }
                    .eyebrow { margin: 0 0 8px; text-transform: uppercase; letter-spacing: 2px; font-size: 10px; color: #8b96ff; font-weight: 700; }
                    h1 { margin: 0 0 6px; font-size: 38px; line-height: 1.1; }
                    .hero-meta { margin: 0; color: rgba(255,255,255,0.75); font-size: 14px; }
                    .row { display: flex; gap: 14px; margin-top: 12px; }
                    .cell { flex: 1; background: rgba(255,255,255,0.06); border-radius: 14px; padding: 12px; }
                    .align-right { text-align: right; }
                    .label { display: block; text-transform: uppercase; letter-spacing: 1.6px; font-size: 10px; color: rgba(255,255,255,0.7); margin-bottom: 6px; }
                    strong { font-size: 16px; }
                    .total { font-size: 28px; color: #8b96ff; }
                    .muted { margin: 6px 0 0; color: rgba(255,255,255,0.7); font-size: 12px; }
                    .qr-wrap { margin-top: 18px; text-align: center; background: rgba(255,255,255,0.04); border-radius: 18px; padding: 18px; }
                    .qr-image { width: 210px; height: 210px; border-radius: 12px; background: #fff; padding: 8px; }
                    .footer { margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.15); padding-top: 10px; text-align: center; font-size: 11px; color: rgba(255,255,255,0.7); }
                </style>
            </head>
            <body>
                ${ticketsHtml}
            </body>
            </html>
        `;

        await withTimeout(page.setContent(htmlContent, { waitUntil: 'load' }), 10000, 'PDF_CONTENT_SET');
        const pdfBuffer = await withTimeout(page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } }), 12000, 'PDF_GENERATION');
        return pdfBuffer;
    } catch (error) {
        console.error(`[PDF_ERROR] orderId=${orderData.id} error=${error.message}`);
        return null;
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

/**
 * Generate a fallback PDF without browser dependencies.
 * This is used when Puppeteer PDF generation fails in production environments.
 */
async function generateTicketPDFWithPdfKit(eventData, attendeeData, orderData, qrCodes) {
    try {
        return await new Promise((resolve, reject) => {
            const doc = new PDFDocument({ size: 'A4', margin: 42 });
            const chunks = [];

            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const safeTitle = eventData.title || 'Event Ticket';
            const safeDate = eventData.eventDate
                ? new Date(eventData.eventDate).toLocaleString('en-AU', { dateStyle: 'full', timeStyle: 'short' })
                : 'Date TBA';
            const safeLocation = eventData.location || 'Venue TBA';
            const safeEmail = attendeeData.email || 'N/A';
            const currency = (orderData.currency || 'AUD').toUpperCase();
            const orderAmount = typeof orderData.amount === 'number'
                ? `${currency} ${orderData.amount.toFixed(2)}`
                : `${currency} ${orderData.amount || '0.00'}`;

            qrCodes.forEach((qr, index) => {
                if (index > 0) doc.addPage();

                doc.rect(30, 30, doc.page.width - 60, doc.page.height - 60)
                    .lineWidth(1)
                    .strokeColor('#E2E8F0')
                    .stroke();

                doc.fontSize(10).fillColor('#6366F1').text('Invoice Manifest', 50, 55, { uppercase: true });
                doc.fontSize(24).fillColor('#0F172A').text(safeTitle, 50, 72, { width: 500 });
                doc.fontSize(11).fillColor('#64748B').text(safeDate, 50, 108);
                doc.fontSize(11).fillColor('#64748B').text(safeLocation, 50, 124);

                doc.fontSize(10).fillColor('#94A3B8').text('Order ID', 50, 170);
                doc.fontSize(12).fillColor('#0F172A').text(orderData.id || 'N/A', 50, 184);
                doc.fontSize(10).fillColor('#94A3B8').text('Pass', 370, 170);
                doc.fontSize(12).fillColor('#0F172A').text(`${index + 1} of ${qrCodes.length}`, 370, 184);

                doc.fontSize(10).fillColor('#94A3B8').text('Attendee', 50, 220);
                doc.fontSize(12).fillColor('#0F172A').text(attendeeData.name || 'Guest', 50, 234);
                doc.fontSize(11).fillColor('#64748B').text(safeEmail, 50, 250);

                doc.fontSize(10).fillColor('#94A3B8').text('Final Total', 370, 220);
                doc.fontSize(18).fillColor('#4F46E5').text(orderAmount, 370, 236);

                try {
                    const qrBuffer = Buffer.from(String(qr).split(',')[1] || '', 'base64');
                    if (qrBuffer.length > 0) {
                        doc.image(qrBuffer, 210, 320, { fit: [180, 180], align: 'center', valign: 'center' });
                        doc.fontSize(10).fillColor('#64748B').text('Scan this QR at event entry gate', 185, 512);
                    }
                } catch (imageErr) {
                    doc.fontSize(10).fillColor('#EF4444').text(`QR rendering failed for pass ${index + 1}`, 50, 360);
                    console.error(`[PDFKIT_QR_ERROR] orderId=${orderData.id} pass=${index + 1} error=${imageErr.message}`);
                }

                doc.fontSize(9)
                    .fillColor('#94A3B8')
                    .text('Powered by EventHubix • This PDF is system-generated and valid for admission.', 50, 760, {
                        width: 500,
                        align: 'center'
                    });
            });

            doc.end();
        });
    } catch (error) {
        console.error(`[PDFKIT_ERROR] orderId=${orderData.id} error=${error.message}`);
        return null;
    }
}

/**
 * Base Layout Wrapper for consistency (Premium Redesign)
 */
function getEmailLayout(content, preheader = '') {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>EventHubix Notification</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
                body { margin: 0; padding: 0; min-width: 100%; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important; background-color: #F8FAFC; -webkit-font-smoothing: antialiased; }
                table { border-spacing: 0; }
                img { border: 0; }
                .wrapper { width: 100%; table-layout: fixed; background-color: #F8FAFC; padding-bottom: 40px; padding-top: 40px; }
                .main { background-color: #FFFFFF; margin: 0 auto; width: 100%; max-width: 600px; border-spacing: 0; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); }
                @media only screen and (max-width: 600px) {
                    .main { border-radius: 0 !important; }
                    .content { padding: 30px 20px !important; }
                }
            </style>
        </head>
        <body>
            <center class="wrapper">
                <div style="display: none; max-height: 0; overflow: hidden; font-size: 1px; color: #F8FAFC; line-height: 1px;">${preheader}</div>
                <table class="main" width="100%">
                    <!-- Header -->
                    <tr>
                        <td style="padding: 40px 0 35px; text-align: center; background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%);">
                            <h1 style="color: #FFFFFF; margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -1px;">EventHubix</h1>
                        </td>
                    </tr>
                    <!-- Body -->
                    <tr>
                        <td class="content" style="padding: 50px 40px; background-color: #FFFFFF;">
                            ${content}
                        </td>
                    </tr>
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 40px 40px 50px; text-align: center; background-color: #FBFCFE; border-top: 1px solid #F1F5F9;">
                            <p style="margin: 0; color: #94A3B8; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;">© 2026 <strong>EventHubix</strong></p>
                            <div style="margin-top: 20px; color: #64748B; font-size: 14px; line-height: 1.6;">
                                <p style="margin: 0;">Need any assistance? Connect with our <a href="mailto:${REPLY_TO_EMAIL}" style="color: #4F46E5; text-decoration: none; font-weight: 600;">Support Team</a></p>
                                <p style="margin: 15px 0 0; font-size: 11px; color: #cbd5e1; max-width: 400px; margin-left: auto; margin-right: auto;">
                                    This email was sent regarding your order. By using our platform, you agree to our 
                                    <a href="${FRONTEND_URL}/terms" style="color: #94a3b8; text-decoration: underline;">Terms</a> and 
                                    <a href="${FRONTEND_URL}/privacy" style="color: #94a3b8; text-decoration: underline;">Privacy Policy</a>.
                                </p>
                            </div>
                        </td>
                    </tr>
                </table>
            </center>
        </body>
        </html>
    `;
}

/**
 * Modern CTA Button helper
 */
function getCTAButton(text, url) {
    return `
        <div style="text-align: center; margin: 40px 0;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:55px;v-text-anchor:middle;width:220px;" arcsize="15%" stroke="f" fillcolor="#4F46E5">
                <w:anchorlock/>
                <center style="color:#ffffff;font-family:sans-serif;font-size:16px;font-weight:bold;">${text}</center>
            </v:roundrect>
            <![endif]-->
            <a href="${url}" style="background-color: #4F46E5; color: #FFFFFF; padding: 18px 36px; border-radius: 14px; text-decoration: none; font-weight: 700; display: inline-block; font-size: 16px; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.2), 0 4px 6px -2px rgba(79, 70, 229, 0.1);">
                ${text}
            </a>
        </div>
    `;
}

/**
 * Template: Ticket Confirmation (Buyer)
 */
function getTicketConfirmationTemplate({ attendeeName, eventTitle, eventDate, location, orderId, amount, ticketsCount, qrCodes, hasPdfAttachment = false, downloadToken = '' }) {
    const ticketUrl = orderId
        ? `${FRONTEND_URL}/order/${orderId}/tickets`
        : `${FRONTEND_URL}/order-tickets`;

    const formattedDate = (eventDate instanceof Date) 
        ? eventDate.toLocaleString('en-AU', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : (eventDate || 'Coming Soon');

    const qrSections = (qrCodes || []).map((_, index) => `
        <div style="display: inline-block; width: 220px; vertical-align: top; margin: 15px; padding: 25px; background-color: #FFFFFF; border: 1.5px solid #F1F5F9; border-radius: 20px; text-align: center;">
            <img src="cid:ticket_qr_${index}" width="160" height="160" style="display: block; margin: 0 auto; border-radius: 12px; border: 1px solid #F1F5F9; padding: 8px; background-color: white;" alt="Ticket QR Code ${index + 1}" />
            <p style="margin: 15px 0 0; color: #64748B; font-size: 10px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.1em;">Pass ${index + 1} of ${ticketsCount}</p>
        </div>
    `).join('');

    const downloadUrl = `${BACKEND_BASE_URL}/api/public/orders/${orderId}/tickets/download`;

    const content = `
        <div style="text-align: center; margin-bottom: 35px;">
            <div style="display: inline-block; padding: 12px 24px; background-color: #F0F9FF; border-radius: 100px; margin-bottom: 20px;">
                <span style="color: #0284C7; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em;">Booking Confirmed</span>
            </div>
            <h2 style="margin: 0; color: #0F172A; font-size: 32px; font-weight: 800; letter-spacing: -1px; line-height: 1.1;">You're going to <br/><span style="color: #4F46E5;">${eventTitle}</span></h2>
            <p style="margin: 15px 0 0; color: #64748B; font-size: 17px; line-height: 1.6;">Hi ${attendeeName}, we've secured your spots! Your digital passes are ready below.</p>
        </div>
        
        <div style="background-color: #FFFFFF; border: 1.5px solid #F1F5F9; border-radius: 28px; padding: 35px; margin-bottom: 35px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                    <td style="padding-bottom: 25px; border-bottom: 1.5px dashed #F1F5F9;">
                        <p style="margin: 0 0 5px; color: #94A3B8; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em;">Event Details</p>
                        <p style="margin: 0; font-size: 18px; color: #1E293B; font-weight: 700; line-height: 1.4;">${eventTitle}</p>
                        <p style="margin: 8px 0 0; font-size: 15px; color: #64748B;">📅 ${formattedDate}</p>
                        <p style="margin: 4px 0 0; font-size: 15px; color: #64748B;">📍 ${location || 'Venue TBD'}</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding-top: 25px;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                            <tr>
                                <td style="width: 50%; vertical-align: top; padding-right: 15px;">
                                    <p style="margin: 0 0 4px; color: #94A3B8; font-size: 10px; font-weight: 800; text-transform: uppercase;">Order ID</p>
                                    <p style="margin: 0; font-size: 14px; color: #1E293B; font-weight: 700; font-family: 'Courier New', monospace;">${orderId}</p>
                                </td>
                                <td style="width: 50%; vertical-align: top; text-align: right;">
                                    <p style="margin: 0 0 4px; color: #94A3B8; font-size: 10px; font-weight: 800; text-transform: uppercase;">Tickets</p>
                                    <p style="margin: 0; font-size: 14px; color: #1E293B; font-weight: 700;">${ticketsCount} Admit(s)</p>
                                </td>
                            </tr>
                            <tr>
                                <td colspan="2" style="padding-top: 20px;">
                                    <div style="background-color: #FAFAFB; padding: 15px 20px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;">
                                        <span style="font-size: 13px; color: #475569; font-weight: 600;">Paid Total</span>
                                        <span style="font-size: 20px; color: #4F46E5; font-weight: 800; float: right;">${amount}</span>
                                        <div style="clear: both;"></div>
                                    </div>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>

        ${qrCodes && qrCodes.length > 0 ? `
        <div style="text-align: center; padding: 20px; background-color: #F8FAFC; border-radius: 28px; margin: 35px 0; border: 2px dashed #E2E8F0;">
            ${qrSections}
            <p style="margin: 10px 0 0; color: #94A3B8; font-size: 13px; font-weight: 500;">
                ${hasPdfAttachment
                    ? 'A consolidated PDF with all tickets is attached to this email.'
                    : 'PDF generation is in progress. You can always download all tickets using the button below.'}
            </p>
        </div>
        ` : ''}

        ${getCTAButton('View My Tickets', ticketUrl)}
        ${getCTAButton('Download Ticket PDF', `${downloadUrl}?token=${downloadToken}`)}
        
        <p style="text-align: center; color: #94A3B8; font-size: 13px; margin-top: 20px;">
            Need a refund? Check out our <a href="${FRONTEND_URL}/terms" style="color: #4F46E5; text-decoration: none;">refund policy</a> or reply to this email.
        </p>
    `;
    return getEmailLayout(content, `You're going to ${eventTitle}! Checkout your tickets.`);
}

/**
 * Template: Organizer Notification (Sale)
 */
function getOrganizerNotificationTemplate({ organizerName, eventTitle, quantity, amount, orderId, buyerName, buyerEmail }) {
    const content = `
        <div style="text-align: center; margin-bottom: 35px;">
            <div style="display: inline-block; padding: 12px 24px; background-color: #ECFDF5; border-radius: 100px; margin-bottom: 20px;">
                <span style="color: #059669; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em;">Transaction Successful</span>
            </div>
            <h2 style="margin: 0; color: #0F172A; font-size: 32px; font-weight: 800; letter-spacing: -1px; line-height: 1.1;">🎉 Ticket Sold!</h2>
            <p style="margin: 15px 0 0; color: #64748B; font-size: 16px;">Great news! You have a new registration for your event.</p>
        </div>

        <div style="background-color: #F8FAFC; border: 1.5px solid #F1F5F9; border-radius: 28px; padding: 35px; margin-bottom: 35px;">
            <p style="margin: 0 0 5px; color: #94A3B8; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em;">Event Project</p>
            <p style="margin: 0; font-size: 18px; color: #1E293B; font-weight: 700; line-height: 1.4;">${eventTitle}</p>
            
            <div style="margin-top: 30px; padding: 25px; background-color: #FFFFFF; border-radius: 20px; border: 1px solid #E2E8F0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                <p style="margin: 0 0 5px; color: #94A3B8; font-size: 10px; font-weight: 800; text-transform: uppercase; text-align: center;">Total Revenue</p>
                <h3 style="margin: 0; font-size: 36px; color: #4F46E5; font-weight: 800; text-align: center; letter-spacing: -1px;">${amount}</h3>
                <p style="margin: 5px 0 0; color: #64748B; font-size: 13px; text-align: center;">for <strong>${quantity}</strong> ticket(s)</p>
            </div>

            <div style="margin-top: 35px; border-top: 1.5px dashed #E2E8F0; pt-30px;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 25px;">
                    <tr>
                        <td style="padding-bottom: 15px;">
                            <p style="margin: 0 0 4px; color: #94A3B8; font-size: 10px; font-weight: 800; text-transform: uppercase;">Buyer Details</p>
                            <p style="margin: 0; font-size: 15px; color: #1E293B; font-weight: 700;">${buyerName}</p>
                            <p style="margin: 2px 0 0; font-size: 13px; color: #64748B;">${buyerEmail}</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding-top: 15px;">
                            <p style="margin: 0 0 4px; color: #94A3B8; font-size: 10px; font-weight: 800; text-transform: uppercase;">Reference ID</p>
                            <p style="margin: 0; font-size: 14px; color: #1E293B; font-weight: 700; font-family: 'Courier New', monospace;">${orderId}</p>
                        </td>
                    </tr>
                </table>
            </div>
        </div>

        ${getCTAButton('View Analytics Dashboard', `${FRONTEND_URL}/organiser/dashboard`)}
        
        <p style="text-align: center; color: #94A3B8; font-size: 13px; margin-top: 20px;">
            This notification was sent by EventHubix Platform. <br/>You can manage your notification preferences in your dashboard settings.
        </p>
    `;
    return getEmailLayout(content, `You just sold ${quantity} tickets for ${eventTitle}!`);
}

/**
 * Template: Admin Notification (New Organizer)
 */
function getAdminNotificationTemplate({ organizerName, organizerEmail, timestamp }) {
    const content = `
        <div style="text-align: center; margin-bottom: 35px;">
            <div style="display: inline-block; padding: 12px 24px; background-color: #FEF2F2; border-radius: 100px; margin-bottom: 20px; border: 1px solid #FEE2E2;">
                <span style="color: #EF4444; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em;">Pending Approval</span>
            </div>
            <h2 style="margin: 0; color: #0F172A; font-size: 28px; font-weight: 800; letter-spacing: -1px; line-height: 1.1;">🆕 New Organiser Registration</h2>
            <p style="margin: 15px 0 0; color: #64748B; font-size: 16px;">An account is awaiting your review and activation.</p>
        </div>

        <div style="background-color: #FFFFFF; border: 1.5px solid #F1F5F9; border-radius: 28px; padding: 35px; margin-bottom: 35px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02);">
            <p style="margin: 0 0 25px; color: #94A3B8; font-size: 11px; font-weight: 800; text-transform: uppercase; border-bottom: 1px solid #F1F5F9; padding-bottom: 15px;">Registrant Profile</p>
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                    <td style="padding-bottom: 12px;">
                        <p style="margin: 0; color: #64748B; font-size: 13px; font-weight: 600;">Full Name</p>
                        <p style="margin: 4px 0 0; color: #0F172A; font-size: 16px; font-weight: 700;">${organizerName}</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding-bottom: 12px; padding-top: 12px;">
                        <p style="margin: 0; color: #64748B; font-size: 13px; font-weight: 600;">Email Address</p>
                        <p style="margin: 4px 0 0; color: #4F46E5; font-size: 16px; font-weight: 700;">${organizerEmail}</p>
                    </td>
                </tr>
                <tr>
                    <td style="padding-top: 12px;">
                        <p style="margin: 0; color: #64748B; font-size: 13px; font-weight: 600;">Submitted At</p>
                        <p style="margin: 4px 0 0; color: #0F172A; font-size: 16px; font-weight: 700;">${timestamp}</p>
                    </td>
                </tr>
            </table>
        </div>

        ${getCTAButton('Review & Approve Submission', `${FRONTEND_URL}/admin/organiser-requests`)}
        
        <p style="text-align: center; color: #94A3B8; font-size: 12px; margin-top: 30px; letter-spacing: 0.05em; text-transform: uppercase;">
            Admin Governance • EventHubix Internal Notification
        </p>
    `;
    return getEmailLayout(content, `New organizer registration: ${organizerName}`);
}

/**
 * Template: Newsletter Welcome
 */
function getNewsletterWelcomeTemplate(email) {
    const content = `
        <h2 style="margin: 0 0 15px; color: #111827; font-size: 24px; text-align: center;">Welcome to the Loop! 🚀</h2>
        <p style="margin: 0 0 25px; color: #4B5563; font-size: 16px; text-align: center; line-height: 1.6;">
            Thanks for subscribing to the <strong>EventHubix</strong> newsletter. You're now officially in the inner circle!
        </p>
        
        <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
            <p style="margin: 0; color: #4B5563; font-size: 15px; line-height: 1.6;">
                Get ready for:
                <ul style="margin: 15px 0 0; padding-left: 20px; color: #4B5563;">
                    <li style="margin-bottom: 8px;">Exclusive event marketing tips</li>
                    <li style="margin-bottom: 8px;">Early access to new features</li>
                    <li style="margin-bottom: 8px;">Industry news and trends</li>
                </ul>
            </p>
        </div>

        <p style="margin: 0 0 20px; color: #6B7280; font-size: 14px; text-align: center;">
            You are receiving this because you subscribed at <span style="color: #4F46E5;">${FRONTEND_URL.replace(/https?:\/\//, '')}</span>
        </p>

        ${getCTAButton('Explore Events', `${FRONTEND_URL}/events`)}
    `;
    return getEmailLayout(content, "You're now subscribed to EventHubix!");
}

/**
 * Retry wrapper for SendGrid API calls
 */
async function sendWithRetry(sendFn, retries = 3, logType = 'unknown') {
    try {
        return await sendFn();
    } catch (err) {
        if (retries === 0) throw err;
        console.warn(`[EMAIL_RETRY] type=${logType} attempts_left=${retries} error=${err.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return sendWithRetry(sendFn, retries - 1, logType);
    }
}

/**
 * Generic internal function to send emails safely.
 */
async function sendEmailRaw(msg, logType = 'unknown', orderId = 'N/A') {
    if (!process.env.SENDGRID_API_KEY) {
        console.error(`[EMAIL_BLOCKED] SENDGRID_API_KEY missing. type=${logType} to=${msg.to} — email NOT sent.`);
        return;
    }
    if (!FROM_EMAIL) {
        console.error(`[EMAIL_BLOCKED] SENDGRID_FROM_EMAIL missing. type=${logType} to=${msg.to} — email NOT sent.`);
        return;
    }

    try {
        // Always use structured from object for DMARC/SPF alignment
        msg.from = FROM_EMAIL;
        msg.replyTo = REPLY_TO_EMAIL;

        console.log(`[EMAIL_SENDING] type=${logType} to=${msg.to} from=${FROM_EMAIL.email} orderId=${orderId}`);
        const response = await sendWithRetry(() => sgMail.send(msg), 3, logType);
        console.log(`[EMAIL_SUCCESS] status=${response[0].statusCode} to=${msg.to} type=${logType} via=sendgrid_api`);
    } catch (error) {
        console.error(`[EMAIL_FAILED] to=${msg.to} type=${logType} message=${error.message}`);
        if (error.response) {
            console.error(`[EMAIL_FAILED_DETAIL] statusCode=${error.code} body=${JSON.stringify(error.response.body)}`);
        }
        // Do NOT fall back to any other mail transport — fail explicitly
    }
}

/**
 * Send ticket confirmation to the attendee.
 */
async function sendTicketConfirmation(attendeeData, orderData, tickets) {
    let qrCodes = [];
    let pdfBuffer = null;

    try {
        // Generate QR codes for ALL tickets in parallel
        qrCodes = await Promise.all(
            tickets.map(t => generateQRCode(t.qrPayload, orderData.id))
        );

        // Filter out any failed generations (nulls)
        const validQrs = qrCodes.filter(q => q !== null);

        if (validQrs.length > 0) {
            // Pass all valid QR codes to generate a consolidated PDF
            pdfBuffer = await generateTicketPDF({ title: orderData.eventTitle }, attendeeData, orderData, validQrs);
        }
    } catch (err) {
        console.error(`[CONFIRMATION_ERROR] orderId=${orderData.id} error=${err.message}`);
    }

    // Fallback PDF if styled renderer fails for any reason.
    if (!pdfBuffer) {
        try {
            const browser = await getBrowser();
            const page = await browser.newPage();
            const fallbackHtml = `
                <html>
                <body style="font-family: Arial, sans-serif; padding: 24px;">
                    <h1 style="margin:0 0 8px;">${orderData.eventTitle}</h1>
                    <p style="margin:0 0 12px;">Order: ${orderData.id}</p>
                    <p style="margin:0 0 12px;">Attendee: ${attendeeData.name} (${attendeeData.email})</p>
                    ${(qrCodes || []).map((qr, idx) => `
                        <div style="margin: 18px 0; page-break-inside: avoid;">
                            <p style="font-size:12px; color:#666;">Ticket ${idx + 1} of ${(qrCodes || []).length}</p>
                            <img src="${qr}" style="width:180px;height:180px;border:1px solid #ddd;padding:6px;" />
                        </div>
                    `).join('')}
                </body>
                </html>
            `;
            await withTimeout(page.setContent(fallbackHtml, { waitUntil: 'load' }), 8000, 'PDF_FALLBACK_CONTENT_SET');
            pdfBuffer = await withTimeout(page.pdf({ format: 'A4', printBackground: true }), 10000, 'PDF_FALLBACK_GENERATION');
            await page.close().catch(() => {});
            console.log(`[PDF_FALLBACK_SUCCESS] orderId=${orderData.id}`);
        } catch (fallbackError) {
            console.error(`[PDF_FALLBACK_ERROR] orderId=${orderData.id} error=${fallbackError.message}`);
        }
    }

    // Browserless fallback: always try PDFKit before giving up.
    if (!pdfBuffer) {
        pdfBuffer = await generateTicketPDFWithPdfKit(
            { title: orderData.eventTitle, eventDate: orderData.eventDate, location: orderData.location },
            attendeeData,
            orderData,
            (qrCodes || []).filter(Boolean)
        );
        if (pdfBuffer) {
            console.log(`[PDFKIT_FALLBACK_SUCCESS] orderId=${orderData.id} tickets=${tickets.length}`);
        }
    }

    const hasPdfAttachment = !!pdfBuffer;

    const downloadToken = createTicketDownloadToken(orderData.id, attendeeData.email);
    const htmlTemplate = getTicketConfirmationTemplate({
        attendeeName: attendeeData.name,
        eventTitle: orderData.eventTitle,
        eventDate: orderData.eventDate,
        location: orderData.location,
        orderId: orderData.id,
        amount: orderData.amount,
        ticketsCount: tickets.length,
        qrCodes: qrCodes,
        hasPdfAttachment,
        downloadToken
    });

    let attachments = [];
    
    // Add all QR codes as inline attachments
    qrCodes.forEach((qr, index) => {
        if (qr) {
            const base64Data = qr.split(',')[1];
            attachments.push({
                content: base64Data,
                filename: `qr-${index}.png`,
                type: 'image/png',
                disposition: 'inline',
                content_id: `ticket_qr_${index}`
            });
        }
    });

    if (pdfBuffer) {
        try {
            const base64Content = Buffer.from(pdfBuffer).toString('base64');
            attachments.push({
                content: base64Content,
                filename: `tickets-${orderData.id}.pdf`,
                type: 'application/pdf',
                disposition: 'attachment'
            });
            console.log(`[EMAIL_DEBUG] type=attachment_ready orderId=${orderData.id} tickets=${tickets.length}`);
        } catch (encodingError) {
            console.error(`[EMAIL_ERROR] type=encoding_failed orderId=${orderData.id} error=${encodingError.message}`);
        }
    }

    const msg = {
        to: attendeeData.email,
        subject: `Your Tickets for ${orderData.eventTitle} - ${orderData.id}`,
        text: `Hi ${attendeeData.name}, your purchase for ${orderData.eventTitle} was successful! You have ${tickets.length} tickets. Order ID: ${orderData.id}.`,
        html: htmlTemplate,
        attachments: attachments
    };
 
    await sendEmailRaw(msg, 'ticket_confirmation', orderData.id);
}

/**
 * Notify organizer about a sale.
 */
async function sendOrganizerSaleNotification(organizerEmail, eventTitle, quantity, amount, orderId, buyerName, buyerEmail) {
    if (!organizerEmail) {
        console.warn(`[EMAIL_SKIPPED] type=organizer_ticket_sold reason=missing_email`);
        return;
    }

    const htmlTemplate = getOrganizerNotificationTemplate({
        eventTitle,
        quantity,
        amount,
        orderId,
        buyerName,
        buyerEmail
    });

    const msg = {
        to: organizerEmail,
        subject: `🎉 Ticket Sold! - ${eventTitle}`,
        text: `Great news! You just sold ${quantity} ticket(s) for your event: ${eventTitle}. Amount: ${amount}. Buyer: ${buyerName} (${buyerEmail})`,
        html: htmlTemplate,
    };
    await sendEmailRaw(msg, 'organizer_ticket_sold', orderId);
}

/**
 * Notify admin about a new organizer registration.
 */
async function sendAdminNewOrganizerAlert(organizerData) {
    if (!ADMIN_EMAIL) {
        console.warn(`[EMAIL_SKIPPED] type=admin_new_organizer reason=missing_admin_email`);
        return;
    }

    const timestamp = new Date().toLocaleString("en-AU", {
        dateStyle: "medium",
        timeStyle: "short"
    });

    const htmlTemplate = getAdminNotificationTemplate({
        organizerName: organizerData.name,
        organizerEmail: organizerData.email,
        timestamp
    });

    const msg = {
        to: ADMIN_EMAIL,
        subject: `🆕 New Organizer: ${organizerData.name}`,
        text: `A new organizer has registered: ${organizerData.name} (${organizerData.email}). Time: ${timestamp}`,
        html: htmlTemplate,
    };
    await sendEmailRaw(msg, 'admin_new_organizer');
}

/**
 * Send newsletter welcome email.
 */
async function sendNewsletterWelcome(email) {
    const htmlTemplate = getNewsletterWelcomeTemplate(email);
    const msg = {
        to: email,
        subject: `Welcome to EventHubix! 🚀`,
        text: `Thanks for subscribing to the EventHubix newsletter! We'll keep you updated with the latest event tips and news.`,
        html: htmlTemplate,
    };
    await sendEmailRaw(msg, 'newsletter_welcome');
}

/**
 * Orchestrator for purchase-related emails (fire-and-forget).
 */
async function processPurchaseEmails({ attendeeEmail, attendeeName, orderId, totalAmount, eventTitle, eventDate, location, organizerEmail, tickets }) {
    try {
        const [attendeeResult, organizerResult] = await Promise.allSettled([
            sendTicketConfirmation(
                { name: attendeeName, email: attendeeEmail },
                { id: orderId, amount: totalAmount, eventTitle, eventDate, location },
                tickets
            ),
            sendOrganizerSaleNotification(organizerEmail, eventTitle, tickets.length, totalAmount, orderId, attendeeName, attendeeEmail)
        ]);

        return {
            attendeeSent: attendeeResult.status === 'fulfilled',
            organizerSent: organizerResult.status === 'fulfilled',
            attendeeError: attendeeResult.status === 'rejected' ? attendeeResult.reason?.message : null,
            organizerError: organizerResult.status === 'rejected' ? organizerResult.reason?.message : null
        };
    } catch (err) {
        console.error('[EMAIL_ORCHESTRATOR_ERROR] Critical failure in email batch:', err.message);
        return {
            attendeeSent: false,
            organizerSent: false,
            attendeeError: err.message,
            organizerError: err.message
        };
    }
}

module.exports = {
    sendTicketConfirmation,
    sendOrganizerSaleNotification,
    sendAdminNewOrganizerAlert,
    sendNewsletterWelcome,
    processPurchaseEmails,
    verifyTicketDownloadToken
};
