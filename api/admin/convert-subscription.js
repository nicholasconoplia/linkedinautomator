const { UserDB, CreditDB, SubscriptionDB } = require('../../database');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin authentication - you can modify this
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== 'convert-sub-2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('🔄 Converting all active subscriptions to credits...');
    
    // Get all active subscriptions
    const allUsers = await UserDB.getAllUsers();
    const conversions = [];
    
    for (const user of allUsers) {
      try {
        const subscription = await SubscriptionDB.getUserSubscription(user.id);
        
        if (subscription && subscription.status === 'active') {
          console.log(`📋 Found subscription for user ${user.id}:`, {
            plan: subscription.plan_name,
            posts_limit: subscription.posts_limit,
            status: subscription.status
          });
          
          // Convert posts_limit to credits (1:1 ratio)
          const creditsToAdd = subscription.posts_limit || 30;
          
          // Add credits to user account
          const newBalance = await CreditDB.addCredits(
            user.id, 
            creditsToAdd, 
            `Converted from ${subscription.plan_name} subscription`
          );
          
          console.log(`✅ Added ${creditsToAdd} credits to user ${user.id}. New balance: ${newBalance}`);
          
          // Cancel the subscription (keep it inactive)
          await SubscriptionDB.updateSubscriptionStatus(user.id, 'cancelled');
          console.log(`✅ Subscription status updated to cancelled for user ${user.id}`);
          
          conversions.push({
            userId: user.id,
            creditsAdded: creditsToAdd,
            newBalance: newBalance,
            planName: subscription.plan_name
          });
        }
      } catch (error) {
        console.error(`❌ Error converting subscription for user ${user.id}:`, error);
        conversions.push({
          userId: user.id,
          error: error.message
        });
      }
    }
    
    return res.status(200).json({
      success: true,
      message: `Converted ${conversions.length} subscriptions to credits`,
      conversions: conversions
    });
    
  } catch (error) {
    console.error('❌ Error in conversion process:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
} 