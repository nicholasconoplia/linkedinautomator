// Quick fix to activate subscription for user
const { SubscriptionDB } = require('./database');

async function activateSubscription() {
    try {
        console.log('🔄 Activating subscription for user ID 1...');
        
        // Update subscription status from incomplete to active
        await SubscriptionDB.updateSubscriptionStatus(1, 'active');
        
        console.log('✅ Subscription activated successfully!');
        
        // Verify the update
        const subscription = await SubscriptionDB.getUserSubscription(1);
        console.log('📋 Updated subscription:', {
            id: subscription.id,
            plan_name: subscription.plan_name,
            status: subscription.status,
            posts_limit: subscription.posts_limit
        });
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error activating subscription:', error);
        process.exit(1);
    }
}

activateSubscription(); 