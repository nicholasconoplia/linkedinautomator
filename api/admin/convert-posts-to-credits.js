const { SubscriptionDB, CreditDB, pool } = require('../../database');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin authentication
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== 'convert-posts-2024') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get current user's subscription status
    const userId = req.body.userId || 1; // Default to user ID 1
    
    // Get subscription usage info
    const subscriptionStatus = await SubscriptionDB.getUserSubscription(userId);
    if (!subscriptionStatus) {
      return res.status(404).json({ error: 'No subscription found for user' });
    }

    // Get current usage to calculate remaining posts
    const usageQuery = await pool.query(`
      SELECT COUNT(*) as posts_used 
      FROM usage_tracking 
      WHERE user_id = $1 
      AND action_type = 'post_generation'
      AND created_at >= date_trunc('month', CURRENT_DATE)
    `, [userId]);
    
    const postsUsed = parseInt(usageQuery.rows[0]?.posts_used || 0);
    const postsLimit = subscriptionStatus.posts_limit || 30;
    const postsRemaining = Math.max(0, postsLimit - postsUsed);
    
    console.log(`📊 User ${userId} subscription status:`, {
      plan: subscriptionStatus.plan_name,
      postsLimit,
      postsUsed,
      postsRemaining
    });
    
    if (postsRemaining > 0) {
      // Convert remaining posts to credits (1:1 ratio)
      const newBalance = await CreditDB.addCredits(
        userId, 
        postsRemaining, 
        `Converted ${postsRemaining} remaining posts from ${subscriptionStatus.plan_name} subscription`
      );
      
      // Reset monthly usage so they don't get double credits
      await pool.query(`
        UPDATE usage_tracking 
        SET metadata = jsonb_set(metadata, '{converted_to_credits}', 'true')
        WHERE user_id = $1 
        AND action_type = 'post_generation'
        AND created_at >= date_trunc('month', CURRENT_DATE)
      `, [userId]);
      
      return res.json({
        success: true,
        message: `Converted ${postsRemaining} subscription posts to credits`,
        details: {
          userId,
          postsConverted: postsRemaining,
          newCreditBalance: newBalance,
          subscriptionPlan: subscriptionStatus.plan_name
        }
      });
    } else {
      return res.json({
        success: false,
        message: 'No remaining posts to convert',
        details: {
          userId,
          postsUsed,
          postsLimit,
          postsRemaining: 0
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Error converting posts to credits:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
} 