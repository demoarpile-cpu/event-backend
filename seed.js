const prisma = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function main() {
    console.log('🌱 Starting database seeding...');

    // 1. Create Admin
    const adminPassword = await bcrypt.hash('admin123', 10);
    const admin = await prisma.user.upsert({
        where: { email: 'admin@eventplatform.com' },
        update: { password: adminPassword },
        create: {
            email: 'admin@eventplatform.com',
            name: 'System Admin',
            password: adminPassword,
            role: 'ADMIN',
            status: 'ACTIVE'
        },
    });
    console.log('✅ Admin user created/verified');

    // 2. Create Organizer
    const organizerPassword = await bcrypt.hash('organizer123', 10);
    const organizer = await prisma.user.upsert({
        where: { email: 'organizer@eventplatform.com' },
        update: { password: organizerPassword, role: 'ORGANIZER' },
        create: {
            email: 'organizer@eventplatform.com',
            name: 'John Organizer',
            password: organizerPassword,
            role: 'ORGANIZER',
            status: 'ACTIVE'
        },
    });
    console.log('✅ Organizer user created/verified');

    // 3. Create initial events
    const event1 = await prisma.event.upsert({
        where: { id: 1 },
        update: {},
        create: {
            id: 1,
            title: 'Summer Music Festival 2026',
            category: 'Music',
            description: 'Get ready for the biggest music event of the summer! Experience incredible live performances and a vibrant community atmosphere.\n\nEnjoy two days of non-stop music from world-renowned artists across three stages. From indie rock to electronic beats, we have something for every fan.',
            location: 'Central Park, New York, NY 10024',
            eventDate: new Date('2026-07-15T18:00:00'),
            ticketPrice: 120,
            totalTickets: 5000,
            ticketsSold: 4200,
            organizerId: organizer.id,
            status: 'APPROVED',
            reviewedById: admin.id,
            isPublic: true,
            tags: ['Outdoor', 'All Ages', 'Food Stalls', 'Music'],
            highlights: ['3 Live Stages', '40+ Artists', 'Food Village', 'VIP Lounge'],
            galleryImages: {
                create: [
                    { imageUrl: 'https://images.unsplash.com/photo-1459749411177-042180ceea72?auto=format&fit=crop&q=80&w=1200', displayOrder: 1 },
                    { imageUrl: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?auto=format&fit=crop&q=80&w=1200', displayOrder: 2 },
                    { imageUrl: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&q=80&w=1200', displayOrder: 3 }
                ]
            },
            schedule: {
                create: [
                    { time: '18:00', act: 'Opening Ceremony', orderIndex: 1 },
                    { time: '19:30', act: 'The Indie Collective', orderIndex: 2 },
                    { time: '21:00', act: 'Headliner: Midnight Waves', orderIndex: 3 }
                ]
            }
        },
    });

    const event2 = await prisma.event.upsert({
        where: { id: 2 },
        update: {},
        create: {
            id: 2,
            title: 'Tech Innovators Conference',
            category: 'Tech',
            description: 'Explore the future of AI, robotics, and biotechnology with industry leaders and visionaries. This conference is the premier gathering for developers, scientists, and investors.',
            location: 'Moscone Center, San Francisco, CA',
            eventDate: new Date('2026-09-22T09:00:00'),
            ticketPrice: 250,
            totalTickets: 1200,
            ticketsSold: 1185,
            organizerId: organizer.id,
            status: 'PENDING',
            isPublic: true,
            tags: ['AI', 'Networking', 'Robotics', 'Conference'],
            highlights: ['50+ Speakers', 'Live Demos', 'Startup Pitches', 'Workshops'],
            galleryImages: {
                create: [
                    { imageUrl: 'https://images.unsplash.com/photo-1540575861501-7ad0582373f2?auto=format&fit=crop&q=80&w=1200', displayOrder: 1 }
                ]
            }
        },
    });

    console.log('✅ Initial events seeded with detailed content');
    console.log('🌲 Seeding complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
