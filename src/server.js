require('dotenv').config();
const app = require('./app');
const prisma = require('./config/db');
const cleanupService = require('./services/cleanupService');

const PORT = process.env.PORT || 4000;

async function startServer() {
    try {
        // Test database connection
        await prisma.$connect();
        console.log('✅ Database connected successfully');

        // Start Background Services
        cleanupService.start();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📡 Local:   http://localhost:${PORT}/health`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

startServer();
