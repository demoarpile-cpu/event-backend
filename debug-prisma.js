const prisma = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function debugRegister() {
    try {
        const hashedPassword = await bcrypt.hash('password123', 10);
        console.log('Attempting to create user...');
        const user = await prisma.user.create({
            data: {
                name: 'Debug User',
                email: `debug_${Date.now()}@example.com`,
                password: hashedPassword,
                role: 'ORGANIZER',
                organizerStatus: 'PENDING'
            }
        });
        console.log('✅ Success! User created:', user.id);
    } catch (err) {
        console.error('❌ Prisma Error:');
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

debugRegister();
