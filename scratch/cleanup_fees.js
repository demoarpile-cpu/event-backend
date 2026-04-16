const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- CLEANING UP HARDCODED FEES ---');
    
    // Set serviceFeeRate to NULL for all events currently using the old default (0.03)
    // This allows them to inherit the latest dynamic platform settings.
    const result = await prisma.event.updateMany({
        where: {
            serviceFeeRate: 0.03
        },
        data: {
            serviceFeeRate: null
        }
    });

    console.log(`Successfully updated ${result.count} events to follow dynamic global fees.`);

    // Also fix the stale platformFeeFixedCents if needed
    const settings = await prisma.platformsettings.findFirst();
    if (settings && settings.platformFeeFixed === 0.5 && settings.platformFeeFixedCents !== 50) {
        await prisma.platformsettings.update({
            where: { id: settings.id },
            data: { platformFeeFixedCents: 50 }
        });
        console.log('Synchronized platformFeeFixedCents to $0.50 (50 cents).');
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
