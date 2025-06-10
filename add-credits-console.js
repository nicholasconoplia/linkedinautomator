// Browser console script to add credits
// Open browser developer tools on your app and run this in the console

async function addCreditsManually() {
  try {
    // First check if user is authenticated
    const authResponse = await fetch('/api/auth-status');
    const authData = await authResponse.json();
    
    if (!authData.authenticated) {
      console.log('❌ User not authenticated');
      return;
    }
    
    console.log('✅ User authenticated:', authData.user.id);
    
    // Add 30 credits manually (simulating the starter plan purchase)
    const response = await fetch('/api/credits/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credits: 30,
        description: 'Starter plan purchase - manual addition'
      })
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Credits added successfully:', data);
      
      // Refresh the page to show updated balance
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      const errorData = await response.json();
      console.error('❌ Failed to add credits:', errorData);
    }
    
  } catch (error) {
    console.error('❌ Error adding credits:', error);
  }
}

// Run the function
addCreditsManually(); 