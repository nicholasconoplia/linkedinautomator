const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { UserDB, SubscriptionDB } = require('../../database');

// JWT verification
function verifyJWT(token) {
  const jwt = require('jsonwebtoken');
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

function extractJWTFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  const tokenFromCookie = req.headers.cookie?.split(';')
    .find(c => c.trim().startsWith('token='))?.split('=')[1];
  
  return tokenFromCookie || null;
}

async function requireAuth(req) {
  const token = extractJWTFromRequest(req);
  if (!token) {
    throw new Error('Authentication required');
  }
  
  const decoded = verifyJWT(token);
  if (!decoded) {
    throw new Error('Invalid token');
  }
  
  return decoded;
}

async function createCustomer(user) {
  try {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        linkedin_id: user.linkedin_id,
        user_id: user.id.toString()
      }
    });

    console.log('✅ Stripe customer created:', customer.id);
    return customer;
  } catch (error) {
    console.error('❌ Error creating Stripe customer:', error);
    throw error;
  }
}

async function createCheckoutSession(userId, priceId, successUrl, cancelUrl) {
  try {
    const user = await UserDB.getUserById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if customer already exists
    let customerId = null;
    const existingSubscription = await SubscriptionDB.getUserSubscription(userId);
    
    if (existingSubscription && existingSubscription.stripe_customer_id) {
      customerId = existingSubscription.stripe_customer_id;
    } else {
      // Create new customer
      const customer = await createCustomer(user);
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: userId.toString()
      }
    });

    console.log('✅ Checkout session created:', session.id);
    return session;
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    throw error;
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Authenticate user
    const user = await requireAuth(req);
    const userId = user.id;
    
    const { priceId } = req.body;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    // Get the origin from headers
    const origin = req.headers.origin || req.headers.referer?.replace(/\/$/, '') || 'https://employment.vercel.app';
    
    const session = await createCheckoutSession(
      userId,
      priceId,
      `${origin}/dashboard?payment_success=subscription&session_id={CHECKOUT_SESSION_ID}`,
      `${origin}/subscription/cancel`
    );

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    
    if (error.message === 'Authentication required' || error.message === 'Invalid token') {
      res.status(401).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  }
}; 