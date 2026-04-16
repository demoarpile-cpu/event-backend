/**
 * One-time migration: Add organizerStatus column to user table.
 * Run with: node prisma/migrate_organizer_status.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🔄 Running migration: add organizerStatus to user table...');

    try {
        // Step 1: Add the ENUM type column (MySQL syntax)
        await prisma.$executeRawUnsafe(`
            ALTER TABLE \`user\`
            ADD COLUMN IF NOT EXISTS \`organizerStatus\`
            ENUM('PENDING', 'APPROVED', 'REJECTED') NULL DEFAULT 'PENDING'
        `);
        console.log('✅ Column organizerStatus added successfully.');
    } catch (err) {
        if (err.message && err.message.includes('Duplicate column name')) {
            console.log('ℹ️  Column organizerStatus already exists — skipping.');
        } else {
            throw err;
        }
    }

    // Step 2: Ensure demo organizer account is APPROVED (if it exists)
    const demoOrganizer = await prisma.user.findUnique({
        where: { email: 'organizer@eventplatform.com' }
    });

    if (demoOrganizer) {
        await prisma.user.update({
            where: { email: 'organizer@eventplatform.com' },
            data: { organizerStatus: 'APPROVED' }
        });
        console.log('✅ Demo organizer set to APPROVED.');
    }

    // Step 3: Set all existing non-ORGANIZER users to null (clean up default PENDING on admins/tenants)
    await prisma.$executeRawUnsafe(`
        UPDATE \`user\` SET \`organizerStatus\` = NULL
        WHERE \`role\` != 'ORGANIZER'
    `);
    console.log('✅ Cleared organizerStatus for non-organizer roles.');

    console.log('🎉 Migration complete!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
