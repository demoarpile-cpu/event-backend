const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testPhase5PublicDiscovery() {
  console.log("--- Starting Phase 5 Public Event Discovery Test ---");

  // Retrieve an Organizer user to bind the events to
  let organizer = await prisma.user.findFirst({ where: { role: 'ORGANIZER' } });
  if (!organizer) {
      console.error("No organizer found. Ensure seed data exists.");
      return;
  }

  // Define 4 mock events to test all permutations:
  // 1. APPROVED and Public (Should be visible)
  // 2. APPROVED but Private (Should be hidden)
  // 3. PENDING and Public (Should be hidden)
  // 4. REJECTED and Public (Should be hidden)

  const mockBase = {
      category: "Test Phase 5",
      description: "Testing phase 5 discovery rules",
      location: "Virtual",
      eventDate: new Date(Date.now() + 86400000), 
      ticketPrice: 50,
      totalTickets: 100,
      ticketsSold: 85, // Giving it an 85% fill rate to test the Urgency logic availability
      organizerId: organizer.id,
      updatedAt: new Date()
  };

  const e1 = await prisma.event.create({ data: { ...mockBase, title: `Phase 5 - Visible ${Date.now()}`, status: 'APPROVED', isPublic: true } });
  const e2 = await prisma.event.create({ data: { ...mockBase, title: `Phase 5 - Private ${Date.now()}`, status: 'APPROVED', isPublic: false } });
  const e3 = await prisma.event.create({ data: { ...mockBase, title: `Phase 5 - Pending ${Date.now()}`, status: 'PENDING', isPublic: true } });
  const e4 = await prisma.event.create({ data: { ...mockBase, title: `Phase 5 - Rejected ${Date.now()}`, status: 'REJECTED', isPublic: true } });

  console.log(`✅ Base Events instantiated natively.`);

  // Validate the public API behavior natively:
  try {
      const response = await fetch('http://localhost:4000/api/public/events');
      const publicEvents = await response.json();
      
      const foundE1 = publicEvents.some(e => e.id === e1.id);
      const foundE2 = publicEvents.some(e => e.id === e2.id);
      const foundE3 = publicEvents.some(e => e.id === e3.id);
      const foundE4 = publicEvents.some(e => e.id === e4.id);

      if (foundE1) console.log(`✅ Correctly surfacing APPROVED & Public event [ID: ${e1.id}]`);
      else console.error(`❌ Missing APPROVED & Public event [ID: ${e1.id}]!`);

      if (!foundE2) console.log(`✅ Correctly omitted APPROVED but Private event [ID: ${e2.id}]`);
      else console.error(`❌ Leaked APPROVED but Private event [ID: ${e2.id}]!`);

      if (!foundE3) console.log(`✅ Correctly omitted PENDING but Public event [ID: ${e3.id}]`);
      else console.error(`❌ Leaked PENDING but Public event [ID: ${e3.id}]!`);

      if (!foundE4) console.log(`✅ Correctly omitted REJECTED but Public event [ID: ${e4.id}]`);
      else console.error(`❌ Leaked REJECTED but Public event [ID: ${e4.id}]!`);

      // Verify the Data Payload matches Phase 5 requirements for urgency
      const retrievedE1 = publicEvents.find(e => e.id === e1.id);
      if (retrievedE1) {
          if (retrievedE1.totalTickets === 100 && retrievedE1.ticketsSold === 85) {
               console.log(`✅ Payload explicitly transports totalTickets and ticketsSold seamlessly supporting the native frontend 'Selling Fast' calculations.`);
          } else {
               console.error(`❌ Missing intrinsic capacity mapping logic natively.`);
          }
      }

  } catch (err) {
      console.error("Fetch error:", err.message);
  }

  console.log("\nPhase 5 Public Discovery Validation completed against native endpoints.");
  await prisma.$disconnect();
}

testPhase5PublicDiscovery();
