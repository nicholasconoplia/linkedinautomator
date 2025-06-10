const { Pool } = require('pg');
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');
const { UserDB, CreditDB } = require('../../database');

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
  // Only allow POST requests
  if (req.method !== 'POST') {
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
    const { payment_id, reason, amount, description } = req.body;
    
    console.log('💰 Refund request:', { userId, payment_id, reason, amount });
    
    if (!payment_id || !reason) {
      return res.status(400).json({ error: 'Payment ID and reason are required' });
    }
    
    // Validate the payment belongs to the user
    const customer = await stripe.customers.list({
      email: user.email,
      limit: 1
    });
    
    if (customer.data.length === 0) {
      return res.status(404).json({ error: 'No Stripe customer found' });
    }
    
    // Get the payment details
    let payment = null;
    try {
      payment = await stripe.charges.retrieve(payment_id);
    } catch (error) {
      try {
        payment = await stripe.paymentIntents.retrieve(payment_id);
      } catch (error2) {
        return res.status(404).json({ error: 'Payment not found' });
      }
    }
    
    if (payment.customer !== customer.data[0].id) {
      return res.status(403).json({ error: 'Payment does not belong to your account' });
    }
    
    // Check if payment is refundable
    if (payment.status !== 'succeeded' && payment.status !== 'paid') {
      return res.status(400).json({ error: 'Payment is not in a refundable state' });
    }
    
    // Check if already fully refunded
    if (payment.refunded || (payment.amount_refunded && payment.amount_refunded >= payment.amount)) {
      return res.status(400).json({ error: 'Payment has already been fully refunded' });
    }
    
    // Determine refund amount
    let refundAmount = amount ? Math.round(amount * 100) : payment.amount; // Convert to cents
    const maxRefundable = payment.amount - (payment.amount_refunded || 0);
    
    if (refundAmount > maxRefundable) {
      refundAmount = maxRefundable;
    }
    
    // Create refund
    const refund = await stripe.refunds.create({
      charge: payment_id,
      amount: refundAmount,
      reason: reason === 'duplicate' ? 'duplicate' : reason === 'fraudulent' ? 'fraudulent' : 'requested_by_customer',
      metadata: {
        user_id: userId.toString(),
        user_email: user.email,
        refund_reason: reason,
        refund_description: description || '',
        processed_by: 'automatic_system'
      }
    });
    
    // Log the refund in our database
    const dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    await dbPool.query(`
      INSERT INTO usage_tracking (user_id, action, credits_used, metadata) 
      VALUES ($1, 'refund_processed', 0, $2)
    `, [userId, JSON.stringify({
      refund_id: refund.id,
      original_payment_id: payment_id,
      refund_amount: refundAmount / 100,
      reason: reason,
      description: description,
      status: refund.status
    })]);
    
    // If this was a credit purchase, deduct the credits
    if (reason.includes('credit') || description?.includes('credit')) {
      const creditAmount = Math.floor((refundAmount / 100) * 25); // Estimate credits based on amount
      try {
        await CreditDB.deductCredits(userId, creditAmount, `Refund processed - deducted credits for payment ${payment_id}`);
      } catch (creditError) {
        console.error('Error deducting credits for refund:', creditError);
      }
    }
    
    await dbPool.end();
    
    console.log('✅ Refund processed:', refund.id);
    
    res.json({
      success: true,
      refund_id: refund.id,
      refund_amount: refundAmount / 100,
      status: refund.status,
      message: 'Refund processed successfully. It may take 5-10 business days to appear on your statement.'
    });
    
  } catch (error) {
    console.error('Error processing refund:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
} 