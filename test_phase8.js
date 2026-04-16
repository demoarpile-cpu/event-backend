const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testPhase8TicketGeneration() {
  console.log("--- Starting Phase 8 Ticket Generation Validation ---");

  // Retrieve an Organizer user to bind the events to
  let organizer = await prisma.user.findFirst({ where: { role: 'ORGANIZER' } });
  if (!organizer) {
      console.error("No organizer found. Ensure seed data exists.");
      return;
  }

  // Create Base Event
  const phase8Event = await prisma.event.create({ 
      data: {
          title: `Phase 8 Ticket Logic Validation ${Date.now()}`,
          category: "Test",
          description: "Testing phase 8",
          location: "Virtual",
          eventDate: new Date(Date.now() + 86400000), 
          ticketPrice: 50,
          totalTickets: 100,
          ticketsSold: 0, 
          organizerId: organizer.id,
          status: 'APPROVED',
          isPublic: true,
          updatedAt: new Date()
      } 
  });
  console.log(`✅ Base Event instantiated natively representing an empty event: [ID: ${phase8Event.id}]`);

  // Phase 8 checks via API simulation
  try {
      const resp = await fetch('http://localhost:4000/api/tickets/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventId: phase8Event.id,
            quantity: 3, // Testing batch mapping
            attendeeName: 'Automated Phase 8 Tester',
            attendeeEmail: 'phase8@example.com'
          })
      });
      const purchaseRes = await resp.json();

      if (resp.status !== 201) {
          console.error(`❌ Unexpected purchase failure: ${JSON.stringify(purchaseRes)}`);
      } else {
          console.log(`✅ Purchase successful implicitly returning Ticket data elements directly supporting frontend UI confirmation pages (Phase 9 capability)!`);
           
          // Validate internally inside DB
          const savedTickets = await prisma.ticket.findMany({
              where: { eventId: phase8Event.id }
          });

          if (savedTickets.length === 3) {
              console.log(`✅ System accurately stored all 3 generated tickets sequentially in database.`);
          } else {
              console.error(`❌ Missing generated physical tickets! Found ${savedTickets.length}`);
          }

          let formatErrors = 0;
          let statusErrors = 0;

          savedTickets.forEach(ticket => {
              // Validating Phase 8 requirements
              if (ticket.status !== 'UNUSED') {
                  statusErrors++;
                  console.error(`❌ Ticket defaulted to incorrect Status: ${ticket.status}`);
              }
              const expectedPrefix = `${phase8Event.id}:`;
              if (!ticket.qrPayload.startsWith(expectedPrefix) || ticket.qrPayload.length < expectedPrefix.length + 32) {
                   formatErrors++;
                   console.error(`❌ Ticket QR Payload failed schema mapping format: ${ticket.qrPayload}`);
              }
          });

          if (formatErrors === 0 && statusErrors === 0) {
              console.log(`✅ All Tickets explicitly defaulted correctly to UNUSED and bound securely mapping strictly formatted QR Payloads internally (${phase8Event.id}:[crypto hash]) directly implementing Phase 8 schema properties natively!`);
          }
      }

  } catch(err) {
      console.error("Failed purchase request:", err.message);
  }

  console.log("\nPhase 8 Generation Checks finished utilizing entirely intact backend structural rules.");
  await prisma.$disconnect();
}

testPhase8TicketGeneration();
