const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const settings = await prisma.platformsettings.findFirst();
    const latestEvent = await prisma.event.findFirst({
        orderBy: { id: 'desc' }
    });

    console.log('--- GLOBAL SETTINGS ---');
    console.log(JSON.stringify(settings, null, 2));

    console.log('\n--- LATEST EVENT ---');
    console.log(JSON.stringify({
        id: latestEvent.id,
        title: latestEvent.title,
        serviceFeeRate: latestEvent.serviceFeeRate,
        serviceFeeType: latestEvent.serviceFeeType
    }, null, 2));
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
