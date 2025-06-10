const { Pool } = require('pg');
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');
const { UserDB } = require('../../database');

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';

// JWT verification function
function verifyJWT(token) {
  try {
    return jwt.verify(token, JWT_SECRET, {
      issuer: 'linkedinautomator',
      audience: 'linkedinautomator-users'
    });
  } catch (error) {
    console.log('🔐 JWT verification failed:', error.message);
    return null;
  }
}

// Extract JWT from request
function extractJWTFromRequest(req) {
  // Check Authorization header first
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Check cookies
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [name, value] = cookie.trim().split('=');
      acc[name] = value;
      return acc;
    }, {});
    return cookies.auth_token;
  }
  
  return null;
}

module.exports = async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract and verify JWT token
    const token = extractJWTFromRequest(req);
    
    if (!token) {
      return res.status(401).json({ error: 'Authentication required - no token provided' });
    }
    
    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Authentication required - invalid token' });
    }
    
    // Get fresh user data from database
    const user = await UserDB.getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required - user not found' });
    }

    const userId = user.id;
    console.log('📋 Getting payment history for user:', userId);
    
    // Create database connection
    const dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    // Get all payment-related transactions
    const paymentHistory = await dbPool.query(`
      SELECT 
        ut.*,
        us.plan_name,
        us.status as subscription_status,
        us.stripe_subscription_id,
        us.stripe_customer_id
      FROM usage_tracking ut
      LEFT JOIN user_subscriptions us ON ut.user_id = us.user_id
      WHERE ut.user_id = $1 
      AND (
        ut.metadata::text LIKE '%purchase%' OR 
        ut.metadata::text LIKE '%payment%' OR 
        ut.metadata::text LIKE '%credit_added%' OR
        ut.metadata::text LIKE '%subscription%' OR
        ut.action = 'credit_purchase' OR
        ut.action = 'subscription_created'
      )
      ORDER BY ut.created_at DESC
      LIMIT 50
    `, [userId]);
    
    // Get Stripe payment history if customer exists
    let stripePayments = [];
    try {
      const customer = await stripe.customers.list({
        email: user.email,
        limit: 1
      });
      
      if (customer.data.length > 0) {
        const charges = await stripe.charges.list({
          customer: customer.data[0].id,
          limit: 50
        });
        
        const paymentIntents = await stripe.paymentIntents.list({
          customer: customer.data[0].id,
          limit: 50
        });
        
        stripePayments = [
          ...charges.data.map(charge => ({
            id: charge.id,
            type: 'charge',
            amount: charge.amount / 100,
            currency: charge.currency.toUpperCase(),
            status: charge.status,
            created: new Date(charge.created * 1000),
            description: charge.description,
            receipt_url: charge.receipt_url,
            refunded: charge.refunded,
            refund_amount: charge.amount_refunded / 100
          })),
          ...paymentIntents.data.map(intent => ({
            id: intent.id,
            type: 'payment_intent',
            amount: intent.amount / 100,
            currency: intent.currency.toUpperCase(),
            status: intent.status,
            created: new Date(intent.created * 1000),
            description: intent.description
          }))
        ].sort((a, b) => b.created - a.created);
      }
    } catch (stripeError) {
      console.error('Error fetching Stripe payment history:', stripeError);
    }
    
    await dbPool.end();
    
    res.json({
      success: true,
      database_history: paymentHistory.rows,
      stripe_history: stripePayments,
      user_email: user.email
    });
    
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
} 