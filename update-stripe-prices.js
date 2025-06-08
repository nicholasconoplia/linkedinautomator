require('dotenv').config();
const { initializeDatabase, SubscriptionDB } = require('./database');

const NEW_PRICE_IDS = {
  'Starter': 'price_1RXelQKkxlEtPdqxvLmom609', // Current price ID being used
  'Professional': 'price_1RXeWkQNESKipGbatzlHO7ix',
  'Business': 'price_1RXeWlQNESKipGbauhCh7oCy',
  'Enterprise': 'price_1RXeWmQNESKipGba2g6IpbAF'
};

async function updatePriceIds() {
  try {
    console.log('🔄 Initializing database...');
    await initializeDatabase();
    
    console.log('📋 Getting current plans...');
    const plans = await SubscriptionDB.getPlans();
    console.log('\nCurrent plans:');
    plans.forEach(plan => {
      console.log(`${plan.name}: ${plan.stripe_price_id || 'No price ID'}`);
    });
    
    console.log('\n🔄 Updating price IDs...');
    for (const [planName, priceId] of Object.entries(NEW_PRICE_IDS)) {
      try {
        await SubscriptionDB.updatePlanStripeId(planName, priceId);
        console.log(`✅ Updated ${planName} with price ID: ${priceId}`);
      } catch (error) {
        console.error(`❌ Failed to update ${planName}:`, error.message);
      }
    }
    
    console.log('\n📋 Verifying updates...');
    const updatedPlans = await SubscriptionDB.getPlans();
    console.log('\nUpdated plans:');
    updatedPlans.forEach(plan => {
      console.log(`${plan.name}: ${plan.stripe_price_id || 'No price ID'}`);
    });
    
    console.log('\n✅ Price ID update complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating price IDs:', error);
    process.exit(1);
  }
}

updatePriceIds(); 