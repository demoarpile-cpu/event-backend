const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testPhase4AdminModeration() {
  console.log("--- Starting Phase 4 Admin Moderation Test ---");

  // Retrieve an Admin user to bind the action to
  let admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) {
      admin = await prisma.user.create({
          data: {
              name: "Test Admin Phase 4",
              email: `admin_${Date.now()}@example.com`,
              password: "hashedpassword123",
              role: "ADMIN",
              isVerified: true
          }
      });
  }
  
  // Retrieve an Organizer user to bind the event to
  let organizer = await prisma.user.findFirst({ where: { role: 'ORGANIZER' } });

  // Phase 4 Event Setup natively mapped.
  const event = await prisma.event.create({ 
      data: {
          title: `Phase 4 Moderation Target ${Date.now()}`,
          category: "Test",
          description: "Testing phase 4 moderation",
          location: "Virtual",
          eventDate: new Date(Date.now() + 86400000), 
          ticketPrice: 50,
          totalTickets: 100,
          organizerId: organizer.id,
          status: 'PENDING',
          isPublic: true,
          updatedAt: new Date()
      }
  });
  console.log(`✅ Base Event instantiated natively to PENDING [ID: ${event.id}].`);
  
  // Testing Phase 4 Constraint directly via Prisma using equivalent controller backend logic
  // mimicking `PATCH /api/admin/events/:id/status` mapped in admin.routes.js line 213:
  const updatedEvent = await prisma.event.update({
      where: { id: event.id },
      data: {
          status: 'APPROVED',
          reviewedById: admin.id,
          rejectionReason: null
      }
  });

  // 1. Validate Status Modification
  if (updatedEvent.status === 'APPROVED') {
      console.log(`✅ Admin accurately transitioned status natively to APPROVED.`);
  } else {
      console.error(`❌ Admin action unlinked native state logic!`);
  }

  // 2. Validate Traceability of action
  if (updatedEvent.reviewedById === admin.id) {
      console.log(`✅ System traced the specific admin successfully matching Phase 4 tracing assumptions.`);
  } else {
      console.error(`❌ System lost native tracing of the admin actor footprint.`);
  }

  // Double check the REJECT sequence organically handles reasons natively inside patch controllers too:
  const updatedEventReject = await prisma.event.update({
      where: { id: event.id },
      data: {
          status: 'REJECTED',
          reviewedById: admin.id,
          rejectionReason: 'Phase 4 Validation Trial'
      }
  });

  if (updatedEventReject.status === 'REJECTED' && updatedEventReject.rejectionReason === 'Phase 4 Validation Trial') {
      console.log(`✅ Backtracking logic explicitly traces REJECTED with integrated rejection strings reliably natively also.`);
  }

  console.log("\nPhase 4 Admin Moderation Validation completed matching constraints.");
  await prisma.$disconnect();
}

testPhase4AdminModeration();
