const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testPurchases() {
  // Find or create an event to test on
  let event = await prisma.event.findFirst();
  if (!event) {
    console.log("No events found in DB. Please run seed script.");
    return;
  }
  
  const testStatuses = ['APPROVED', 'PENDING', 'REJECTED', 'CANCELLED'];
  // (Note: event_status enum doesn't have SUSPENDED according to schema, it has DRAFT, PENDING, APPROVED, REJECTED, CANCELLED)
  
  for (const status of testStatuses) {
    console.log(`\n--- Testing purchase for event status: ${status} ---`);
    
    // Update event status
    await prisma.event.update({
      where: { id: event.id },
      data: { status }
    });
    
    // Attempt purchase
    try {
      const response = await fetch('http://localhost:4000/api/tickets/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          quantity: 1,
          attendeeName: 'Test Automation',
          attendeeEmail: 'test@example.com'
        })
      });
      
      const data = await response.json();
      console.log(`HTTP Status: ${response.status}`);
      console.log(`Response: ${JSON.stringify(data)}`);
      
      if (status === 'APPROVED' && response.status === 201) {
        console.log(`✅ Success: Purchase allowed when APPROVED`);
      } else if (status !== 'APPROVED' && response.status === 400 && data.error === 'Event is not open for sales') {
         console.log(`✅ Success: Purchase rejected when ${status}`);
      } else if (status !== 'APPROVED' && response.status !== 400) {
         console.log(`❌ Failed: Purchase should have been rejected for ${status}`);
      }
    } catch (err) {
      console.error('Fetch error:', err.message);
    }
  }
  
  // Revert back to original status if needed, though this is just a test script
  console.log('\nTesting Complete.');
}

testPurchases().finally(async () => {
    await prisma.$disconnect()
})
