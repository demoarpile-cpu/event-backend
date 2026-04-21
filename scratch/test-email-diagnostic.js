require('dotenv').config();
const sgMail = require('@sendgrid/mail');

async function testEmail() {
    console.log('--- EMAIL DIAGNOSTIC START ---');
    console.log('FROM_EMAIL:', process.env.SENDGRID_FROM_EMAIL);
    console.log('API_KEY_EXISTS:', !!process.env.SENDGRID_API_KEY);
    
    if (!process.env.SENDGRID_API_KEY) {
        console.error('ERROR: SENDGRID_API_KEY is missing in .env');
        return;
    }

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    const msg = {
        to: process.env.SENDGRID_FROM_EMAIL, // Send to yourself as a test
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'EventHubix - System Diagnostic Test',
        text: 'This is a test email to verify SendGrid configuration.',
        html: '<strong>System Diagnostic:</strong> If you receive this, your SendGrid API key and Sender are working correctly.',
    };

    try {
        console.log('Attempting to send test email...');
        const result = await sgMail.send(msg);
        console.log('SUCCESS: Email sent successfully!');
        console.log('Response Status:', result[0].statusCode);
    } catch (error) {
        console.error('FAILED: Email delivery error.');
        if (error.response) {
            console.error('Error Code:', error.code);
            console.error('Error Body:', JSON.stringify(error.response.body, null, 2));
        } else {
            console.error('Error Message:', error.message);
        }
    }
    console.log('--- EMAIL DIAGNOSTIC END ---');
}

testEmail();
