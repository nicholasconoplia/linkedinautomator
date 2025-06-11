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

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Authenticate user
    const user = await requireAuth(req);
    const userId = user.id;
    
    // Get user subscription
    const subscription = await SubscriptionDB.getUserSubscription(userId);
    
    if (!subscription || subscription.status !== 'active') {
      return res.json({
        hasActiveSubscription: false,
        subscription: null
      });
    }

    // Return subscription details
    res.json({
      hasActiveSubscription: true,
      subscription: {
        planName: subscription.plan_name,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
        stripePriceId: subscription.stripe_price_id,
        features: subscription.features
      }
    });
  } catch (error) {
    console.error('❌ Error checking subscription status:', error);
    
    if (error.message === 'Authentication required' || error.message === 'Invalid token') {
      res.status(401).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Failed to check subscription status' });
    }
  }
}; 