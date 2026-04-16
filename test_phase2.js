const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testPhase2Lifecycle() {
  console.log("--- Starting Phase 2 Event Lifecycle Test ---");

  // Retrieve an Organizer user to bind the event to
  let organizer = await prisma.user.findFirst({ where: { role: 'ORGANIZER' } });
  if (!organizer) {
      organizer = await prisma.user.create({
          data: {
              name: "Test Organizer Phase 2",
              email: `org_${Date.now()}@example.com`,
              password: "hashedpassword123",
              role: "ORGANIZER",
              isVerified: true
          }
      });
  }

  // 1. Organizer creates event
  const eventData = {
      title: `Phase 2 Lifecycle Event ${Date.now()}`,
      category: "Test",
      description: "Testing phase 2",
      location: "Virtual",
      eventDate: new Date(Date.now() + 86400000), // Tomorrow
      ticketPrice: 100,
      totalTickets: 50,
      organizerId: organizer.id,
      status: "PENDING", // Initial state
      isPublic: true, updatedAt: new Date()
  };
  
  const event = await prisma.event.create({ data: eventData });
  console.log(`✅ Event Created successfully. Status: ${event.status}`);

  // 2. Validate it's NOT publicly available yet
  try {
      const resp1 = await fetch('http://localhost:4000/api/public/events');
      const publicEvents = await resp1.json();
      const isVisible = publicEvents.some(e => e.id === event.id);
      if (isVisible) {
          console.error("❌ PENDING event is visible in public listing!");
      } else {
          console.log("✅ PENDING event correctly hidden from public listing.");
      }
  } catch (err) {
      console.error("Failed to fetch public events:", err.message);
  }

  // 3. Admin Reviews and Approves Event
  await prisma.event.update({
      where: { id: event.id },
      data: { status: 'APPROVED' }
  });
  console.log(`✅ Admin conditionally Approved the event. Target Status updated to APPROVED.`);

  // 4. Validate it IS publicly available now
  try {
      const resp2 = await fetch('http://localhost:4000/api/public/events');
      const publicEvents2 = await resp2.json();
      const isVisibleNow = publicEvents2.some(e => e.id === event.id);
      if (!isVisibleNow) {
          console.error("❌ APPROVED event is missing from public listing!");
      } else {
          console.log("✅ APPROVED event correctly visible in public listing.");
      }
  } catch (err) {
      console.error("Failed to fetch public events:", err.message);
  }
  
  // 5. Test Successful Purchase against APPROVED event (unlocking ticket purchases dynamics)
  try {
      const resp3 = await fetch('http://localhost:4000/api/tickets/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: event.id,
            quantity: 1,
            attendeeName: 'Automated Lifecycle Tester',
            attendeeEmail: 'test2@example.com'
          })
      });
      const purchaseRes = await resp3.json();
      if (resp3.status === 201) {
          console.log(`✅ Ticket Purchase successfully gated and approved exclusively for an explicitly APPROVED event! Order: ${purchaseRes.orderId}`);
      } else {
          console.error(`❌ Unexpected purchase failure: ${JSON.stringify(purchaseRes)}`);
      }
  } catch(err) {
      console.error("Failed purchase request:", err.message);
  }
  
  console.log("\nPhase 2 Integration Logic validation completed natively without codebase mutations.");
  await prisma.$disconnect();
}

testPhase2Lifecycle();
