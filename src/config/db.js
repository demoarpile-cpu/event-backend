const { PrismaClient } = require('@prisma/client');

// Optimize Prisma client initialization for development (avoid multiple instances on hot reload)
// or just standard for production
const prisma = global.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

module.exports = prisma;
