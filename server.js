require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const passport = require('passport');
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const session = require('express-session');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const http = require('http');
const https = require('https');
const cheerio = require('cheerio');

// Import our modules
const { initializeDatabase, UserDB, PreferencesDB, PostsDB, SubscriptionDB, UsageDB, AccessKeysDB, CreditDB, pool } = require('./database');
const LinkedInService = require('./linkedin-service');
const PostScheduler = require('./scheduler');
const StripeService = require('./stripe-service');
const viralTemplates = require('./utils/viralTemplates');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';
console.log('🔧 JWT_SECRET loaded:', JWT_SECRET.substring(0, 20) + '...');
const JWT_EXPIRES_IN = '7d'; // 7 days

// JWT Utility Functions
function generateJWT(user) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    linkedin_id: user.linkedin_id
  };
  
  return jwt.sign(payload, JWT_SECRET, { 
    expiresIn: JWT_EXPIRES_IN,
    issuer: 'linkedinautomator',
    audience: 'linkedinautomator-users'
  });
}

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

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
      contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://cdn.tailwindcss.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com", "https://fonts.googleapis.com", "https://cdn.tailwindcss.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            connectSrc: ["'self'", "https://api.stripe.com"],
            frameSrc: ["https://js.stripe.com"]
        },
    },
}));

app.use(cors());
app.use(express.json());

// Explicit favicon handling to prevent redirect loops
app.get('/favicon.ico', (req, res) => {
  const faviconPath = path.join(__dirname, 'favicon.ico');
  if (fs.existsSync(faviconPath)) {
    res.sendFile(faviconPath);
  } else {
    res.status(204).send(); // Return empty 204 response if favicon not found
  }
});

// Explicit handling for static JS and CSS files to prevent redirect loops
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.ico')) {
    const filePath = path.join(__dirname, req.path);
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    } else {
      return res.status(404).send('File not found');
    }
  }
  next();
});

// Serve static files from the root directory with cache control
const staticPath = path.join(__dirname);
console.log(`📁 Setting up static files from: ${staticPath}`);
app.use(express.static(staticPath, {
    setHeaders: (res, path) => {
        // Add cache-busting for development
        if (process.env.NODE_ENV !== 'production') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));
if (fs.existsSync(staticPath)) {
    console.log(`✅ Root directory found, serving static files with cache control`);
} else {
    console.log(`❌ Root directory not found at ${staticPath}`);
}

// Session configuration - Vercel compatible
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  },
  // For Vercel serverless functions, we need to handle sessions differently
  // In production, sessions will be stateless (JWT-based would be better)
  name: 'linkedin-session'
}));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());

// Configure LinkedIn OAuth Strategy (only if credentials are available)
if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
  // Create a custom LinkedIn strategy that uses the modern OpenID Connect userinfo endpoint
  const LinkedInOIDCStrategy = function(options, verify) {
    const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
    LinkedInStrategy.call(this, options, verify);
    
    // Use the official OpenID Connect userinfo endpoint per LinkedIn docs
    this.profileUrl = 'https://api.linkedin.com/v2/userinfo';
    this.emailUrl = null; // Email is included in userinfo response
  };
  
  // Inherit from LinkedInStrategy
  require('util').inherits(LinkedInOIDCStrategy, require('passport-linkedin-oauth2').Strategy);
  
  // Override the userProfile method to use the new endpoint
  LinkedInOIDCStrategy.prototype.userProfile = function(accessToken, done) {
    console.log('🔍 ===== LinkedIn userProfile method called =====');
    console.log('🔑 Access token for profile fetch:', !!accessToken);
    console.log('🔑 Access token length:', accessToken?.length);
    console.log('🔑 Access token preview:', accessToken?.substring(0, 30) + '...');
    console.log('🌐 Profile URL being called:', this.profileUrl);
    console.log('🌐 Email URL (should be null):', this.emailUrl);
    console.log('🔧 OAuth2 client configured:', !!this._oauth2);
    
    this._oauth2.setAccessTokenName("oauth2_access_token");
    console.log('🔧 OAuth2 access token name set to: oauth2_access_token');
    console.log('🔧 OAuth2 client details:', {
      clientId: this._oauth2._clientId?.substring(0, 10) + '...',
      callbackURL: this._oauth2._callbackURL,
      authorizeURL: this._oauth2._authorizeURL,
      accessTokenURL: this._oauth2._accessTokenURL
    });
    
    this._oauth2.get(this.profileUrl, accessToken, function (err, body, res) {
      console.log('📡 ===== LinkedIn API Response Received =====');
      console.log('📊 Response status:', res?.statusCode);
      console.log('📊 Response status message:', res?.statusMessage);
      console.log('📄 Response body type:', typeof body);
      console.log('📄 Response body length:', body?.length);
      console.log('📄 Response body is null/undefined:', body === null || body === undefined);
      console.log('📄 Response headers (content-type):', res?.headers?.['content-type']);
      console.log('📄 Response headers (all):', res?.headers);
      console.log('🔍 Full response body (raw):', body);
      console.log('🔍 Response body stringified:', JSON.stringify(body));
      
      if (err) {
        console.error('❌ ===== LinkedIn API Error =====');
        console.error('❌ Error type:', typeof err);
        console.error('❌ Error constructor:', err?.constructor?.name);
        console.error('❌ Error details:', {
          message: err.message,
          statusCode: err.statusCode,
          data: err.data,
          stack: err.stack
        });
        console.error('❌ Full error object:', JSON.stringify(err, null, 2));
        return done(new require('passport-oauth2').InternalOAuthError('failed to fetch user profile', err));
      }

      try {
        console.log('🔍 ===== Attempting to parse LinkedIn response =====');
        console.log('🔍 Body before parsing:', body);
        console.log('🔍 Body type before parsing:', typeof body);
        console.log('🔍 Body length before parsing:', body?.length);
        
        const json = JSON.parse(body);
        console.log('📋 ===== LinkedIn userinfo response parsed successfully =====');
        console.log('📋 Parsed JSON type:', typeof json);
        console.log('📋 Parsed JSON constructor:', json?.constructor?.name);
        console.log('📋 Parsed JSON (full):', JSON.stringify(json, null, 2));
        console.log('🔑 Available fields in response:', Object.keys(json));
        
        // Parse OpenID Connect userinfo format per LinkedIn docs
        const profile = {
          provider: 'linkedin',
          id: json.sub,
          displayName: json.name,
          name: {
            givenName: json.given_name,
            familyName: json.family_name
          },
          emails: json.email ? [{ value: json.email }] : [],
          photos: json.picture ? [{ value: json.picture }] : [],
          _raw: body,
          _json: json
        };
        
        console.log('✅ ===== Profile object created successfully =====');
        console.log('✅ Profile ID (json.sub):', json.sub);
        console.log('✅ Profile name (json.name):', json.name);
        console.log('✅ Profile given_name:', json.given_name);
        console.log('✅ Profile family_name:', json.family_name);
        console.log('✅ Profile email:', json.email);
        console.log('✅ Profile picture:', json.picture);
        console.log('✅ Complete profile object:', {
          id: profile.id,
          displayName: profile.displayName,
          name: profile.name,
          emails: profile.emails,
          photos: profile.photos?.length || 0,
          provider: profile.provider
        });
        
        console.log('🎯 ===== Calling done(null, profile) =====');
        return done(null, profile);
      } catch(e) {
        console.error('❌ ===== Failed to parse LinkedIn response =====');
        console.error('❌ Parse error type:', typeof e);
        console.error('❌ Parse error constructor:', e?.constructor?.name);
        console.error('❌ Parse error message:', e.message);
        console.error('❌ Parse error stack:', e.stack);
        console.error('❌ Raw body that failed to parse:', body);
        console.error('❌ Raw body type:', typeof body);
        console.error('❌ Raw body length:', body?.length);
        return done(new require('passport-oauth2').InternalOAuthError('failed to parse profile response', e));
      }
    });
  };

  passport.use(new LinkedInOIDCStrategy({
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: process.env.LINKEDIN_CALLBACK_URL || "http://localhost:3000/auth/linkedin/callback",
    scope: ['openid', 'profile', 'email', 'w_member_social'], // Added w_member_social for posting
    state: false // Disable state verification for Vercel serverless compatibility
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('🔑 ===== LinkedIn OAuth Strategy Callback Started =====');
      console.log('🔑 Access token received:', !!accessToken);
      console.log('🔑 Access token length:', accessToken?.length);
      console.log('🔑 Access token preview:', accessToken?.substring(0, 20) + '...');
      console.log('🔑 Refresh token received:', !!refreshToken);
      console.log('📋 Profile object type:', typeof profile);
      console.log('📋 Profile is null/undefined:', profile === null || profile === undefined);
      console.log('📋 Profile constructor:', profile?.constructor?.name);
      console.log('📋 Raw profile object (full):', JSON.stringify(profile, null, 2));
      console.log('📋 Profile keys:', profile ? Object.keys(profile) : 'NO PROFILE');
      console.log('📋 Profile data structure:', {
        id: profile?.id,
        displayName: profile?.displayName,
        name: profile?.name,
        emails: profile?.emails,
        photos: profile?.photos,
        provider: profile?.provider,
        _json: profile?._json,
        _raw: profile?._raw ? 'Present' : 'Missing'
      });

      console.log('🔍 ===== Profile Validation =====');
      console.log('🔍 Profile exists:', !!profile);
      console.log('🔍 Profile.id exists:', !!profile?.id);
      console.log('🔍 Profile.id value:', profile?.id);
      console.log('🔍 Profile.id type:', typeof profile?.id);
      
      if (!profile || !profile.id) {
        console.error('❌ ===== PROFILE VALIDATION FAILED =====');
        console.error('❌ Profile object:', profile);
        console.error('❌ Profile ID:', profile?.id);
        console.error('❌ This is where the "no user profile" error originates');
        return done(new Error('No user profile returned from LinkedIn. Check app permissions.'));
      }
      
      console.log('✅ ===== Profile validation passed =====');

      // Check if user already exists
      let user = await UserDB.getUserByLinkedInId(profile.id);
      
      if (user) {
        console.log('👤 Existing user found:', { id: user.id, name: user.name });
        // Update access token for existing user
        const tokens = {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: Date.now() + (60 * 60 * 1000) // 1 hour default
        };
        await UserDB.updateTokens(user.id, tokens);
        return done(null, user);
      }

      // Create new user using saveUser function
      const tokens = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Date.now() + (60 * 60 * 1000) // 1 hour default
      };

      console.log('✨ Creating new user with profile data');
      const userId = await UserDB.saveUser(profile, tokens);
      
      const newUser = await UserDB.getUserById(userId);
      console.log('✅ User created successfully:', { id: newUser.id, name: newUser.name });
      
      // Create free trial subscription for new user
      try {
        const freeTrialPlan = await pool.query("SELECT * FROM subscription_plans WHERE name = 'Free Trial' LIMIT 1");
        if (freeTrialPlan.rows.length > 0) {
          await SubscriptionDB.createUserSubscription(userId, freeTrialPlan.rows[0].id, 'active');
          console.log('✅ Free trial subscription created for new user');
        }
      } catch (freeTrialError) {
        console.error('⚠️ Failed to create free trial subscription:', freeTrialError);
        // Don't fail user creation if free trial fails
      }
      
      return done(null, newUser);
    } catch (error) {
      console.error('❌ Error in LinkedIn OAuth strategy:', error);
      return done(error);
    }
  }));

  console.log('✅ LinkedIn OAuth configured with OpenID Connect');
} else {
  console.log('⚠️  LinkedIn OAuth not configured - missing credentials');
}

passport.serializeUser((user, done) => {
  console.log('📝 Serializing user:', user ? { id: user.id, name: user.name } : 'No user');
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    console.log('🔍 Deserializing user with ID:', id);
    const user = await UserDB.getUserById(id);
    console.log('👤 Deserialized user:', user ? { id: user.id, name: user.name } : 'Not found');
    done(null, user);
  } catch (error) {
    console.error('❌ Deserialization error:', error);
    done(error, null);
  }
});

// Rate limiting
const rateLimiter = new RateLimiterMemory({
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900, // 15 minutes in seconds
});

const rateLimitMiddleware = async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    res.status(429).json({ 
      error: 'Too many requests', 
      retryAfter: Math.round(rejRes.msBeforeNext / 1000) 
    });
  }
};

// JWT Authentication middleware
const requireAuth = async (req, res, next) => {
  const token = extractJWTFromRequest(req);
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required - no token provided' });
  }
  
  const decoded = verifyJWT(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Authentication required - invalid token' });
  }
  
  // Get fresh user data from database
  try {
    const user = await UserDB.getUserById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required - user not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('❌ Error fetching user in auth middleware:', error);
    res.status(401).json({ error: 'Authentication required - database error' });
  }
};

// ====================
// LINKEDIN OAUTH ROUTES
// ====================

// LinkedIn login (only if OAuth is configured)
app.get('/auth/linkedin', (req, res) => {
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    console.log('🚀 Starting LinkedIn OAuth login process');
    console.log('📋 OAuth Configuration:', {
      clientId: !!process.env.LINKEDIN_CLIENT_ID,
      clientSecret: !!process.env.LINKEDIN_CLIENT_SECRET,
      callbackUrl: process.env.LINKEDIN_CALLBACK_URL
    });
    passport.authenticate('linkedin')(req, res);
  } else {
    console.log('❌ LinkedIn OAuth not configured - missing credentials');
    res.status(400).json({ error: 'LinkedIn OAuth not configured' });
  }
});

// LinkedIn callback (only if OAuth is configured)
app.get('/auth/linkedin/callback', (req, res) => {
  console.log('🔗 ===== LinkedIn callback route started =====');
  console.log('🔗 Request URL:', req.url);
  console.log('🔗 Request method:', req.method);
  console.log('🔗 OAuth configured:', !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET));
  
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    console.log('🔗 LinkedIn callback received - OAuth credentials present');
    console.log('📄 Query parameters:', req.query);
    console.log('📄 Query parameter keys:', Object.keys(req.query));
    console.log('📄 Authorization code present:', !!req.query.code);
    console.log('📄 State parameter present:', !!req.query.state);
    console.log('📄 Error parameter present:', !!req.query.error);
    console.log('🍪 Session before auth:', {
      sessionID: req.sessionID,
      keys: Object.keys(req.session || {}),
      passport: req.session?.passport
    });
    
    console.log('🎯 About to call passport.authenticate...');
    
    try {
      // Use custom callback handling for better debugging
      const authenticateResult = passport.authenticate('linkedin', async (err, user, info) => {
        console.log('🔄 ===== Passport authenticate callback invoked =====');
        console.log('❓ Error present:', !!err);
        console.log('❓ User present:', !!user);
        console.log('❓ Info present:', !!info);
        console.log('❓ Full callback parameters:', { err: !!err, user: !!user, info });
        
        if (err) {
          console.error('❌ LinkedIn authentication error:', err);
          console.error('❌ Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name
          });
        
        // Detailed error display for debugging
        const errorDetails = {
          message: err.message,
          oauthError: err.oauthError || null,
          stack: process.env.NODE_ENV === 'development' ? err.stack : null
        };
        
        return res.send(`
          <html>
            <head><title>LinkedIn Auth Error</title></head>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h1>❌ LinkedIn Authentication Error</h1>
              <h2>What happened:</h2>
              <p>LinkedIn successfully redirected back to our app, but we couldn't fetch your profile information.</p>
              
              <h2>Error Details:</h2>
              <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto;">
${JSON.stringify(errorDetails, null, 2)}
              </pre>
              
              <h2>Common Solutions:</h2>
              <ol>
                <li><strong>Check LinkedIn Developer Portal:</strong>
                  <ul>
                    <li>Go to <a href="https://www.linkedin.com/developers/apps" target="_blank">LinkedIn Developer Portal</a></li>
                    <li>Select your app</li>
                    <li>Go to "Products" tab</li>
                    <li>Make sure "Sign In with LinkedIn" is requested and approved</li>
                  </ul>
                </li>
                <li><strong>Verify OAuth Redirect URLs:</strong>
                  <ul>
                    <li>In your LinkedIn app settings, under "Auth"</li>
                    <li>Make sure <code>http://localhost:3000/auth/linkedin/callback</code> is listed</li>
                  </ul>
                </li>
                <li><strong>Check App Permissions:</strong>
                  <ul>
                    <li>Your app needs access to basic profile information</li>
                    <li>Try with minimal scopes first: ['r_liteprofile', 'r_emailaddress']</li>
                  </ul>
                </li>
              </ol>
              
              <p><a href="/" style="background: #0073b1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">← Back to Home</a></p>
            </body>
          </html>
        `);
      }
      
      if (!user) {
        console.warn('⚠️ No user returned from LinkedIn');
        console.warn('⚠️ Info parameter:', info);
        console.warn('⚠️ This suggests the strategy completed but profile fetch failed');
        return res.send(`
          <html>
            <head><title>No User Data</title></head>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h1>⚠️ Authentication Issue</h1>
              <p>LinkedIn OAuth completed but no user profile was returned.</p>
              <p>This usually means the LinkedIn app doesn't have proper permissions.</p>
              <p><a href="/" style="background: #0073b1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">← Back to Home</a></p>
            </body>
          </html>
        `);
      }

      // Success! Generate JWT token and set as cookie
      try {
        const token = generateJWT(user);
        console.log('🔐 JWT token generated successfully');
        console.log('✅ LinkedIn OAuth callback successful');
        console.log('👤 User data:', { id: user.id, name: user.name });
        
        // Set JWT token as httpOnly cookie
        res.cookie('auth_token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          path: '/'
        });
        
        console.log('🍪 JWT token set as cookie');
        
        // Successful authentication - redirect to home with success message
        return res.redirect('/?authenticated=true');
      } catch (jwtError) {
        console.error('❌ JWT generation error:', jwtError);
        return res.send(`
          <html>
            <head><title>Authentication Error</title></head>
            <body style="font-family: Arial, sans-serif; padding: 20px;">
              <h1>❌ Authentication Error</h1>
              <p>User authenticated but token generation failed.</p>
              <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
${JSON.stringify(jwtError, null, 2)}
              </pre>
              <p><a href="/" style="background: #0073b1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">← Back to Home</a></p>
            </body>
          </html>
        `);
      }
    });
    
    console.log('🎯 Calling authenticate function with req, res...');
    authenticateResult(req, res);
    console.log('🎯 Authenticate function called successfully');
    
  } catch (authError) {
    console.error('❌ ===== Error in passport.authenticate call =====');
    console.error('❌ Auth error type:', typeof authError);
    console.error('❌ Auth error message:', authError.message);
    console.error('❌ Auth error stack:', authError.stack);
    console.error('❌ Full auth error:', authError);
    
    return res.send(`
      <html>
        <head><title>Authentication System Error</title></head>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
          <h1>❌ Authentication System Error</h1>
          <p>There was an error in the authentication system itself.</p>
          <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
${JSON.stringify(authError, null, 2)}
          </pre>
          <p><a href="/" style="background: #0073b1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">← Back to Home</a></p>
        </body>
      </html>
    `);
  }
  } else {
    console.log('❌ LinkedIn OAuth not configured - redirecting with error');
    res.redirect('/?error=oauth_not_configured');
  }
});

// Logout - JWT version
app.post('/api/logout', (req, res) => {
  // Clear the JWT cookie
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });
  
  console.log('🚪 User logged out - JWT cookie cleared');
  res.json({ success: true, message: 'Logged out successfully' });
});

// Old session-based logout (keeping for compatibility)
app.post('/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// Get current user
app.get('/api/user', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    linkedin_id: req.user.linkedin_id
  });
});

// Check authentication status (no auth required)
app.get('/api/auth-status', async (req, res) => {
  try {
    const token = extractJWTFromRequest(req);
    
    console.log('🔍 Auth status check:', {
      tokenPresent: !!token,
      tokenPreview: token ? token.substring(0, 20) + '...' : null
    });
    
    if (!token) {
      console.log('🔍 No JWT token found');
      return res.json({
        authenticated: false,
        user: null
      });
    }
    
    const decoded = verifyJWT(token);
    if (!decoded) {
      console.log('🔍 JWT token invalid or expired');
      return res.json({
        authenticated: false,
        user: null
      });
    }
    
    try {
      // Get fresh user data from database
      const user = await UserDB.getUserById(decoded.id);
      if (!user) {
        console.log('🔍 User not found in database');
        return res.json({
          authenticated: false,
          user: null
        });
      }
      
      console.log('🔍 JWT authentication successful:', { id: user.id, name: user.name });
      res.json({
        authenticated: true,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          linkedin_id: user.linkedin_id,
          profilePicture: user.profile_url,
          profile_picture: user.profile_url,
          headline: user.headline || 'Professional',
          credits: user.credits || 0
        }
      });
    } catch (error) {
      console.error('❌ Error fetching user in auth status:', error);
      res.json({
        authenticated: false,
        user: null
      });
    }
  } catch (error) {
    console.error('❌ Critical error in auth-status endpoint:', error);
    res.status(500).json({
      authenticated: false,
      user: null,
      error: 'Internal server error'
    });
  }
});

// Debug endpoint to check session status
app.get('/api/session-debug', (req, res) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    sessionID: req.sessionID,
    user: req.user ? { id: req.user.id, name: req.user.name } : null,
    session: req.session
  });
});

// Debug endpoint to check LinkedIn strategy configuration
app.get('/api/linkedin-debug', (req, res) => {
  const strategy = passport._strategy('linkedin');
  res.json({
    strategyExists: !!strategy,
    strategyName: strategy?.name,
    profileUrl: strategy?.profileUrl,
    emailUrl: strategy?.emailUrl,
    clientID: !!process.env.LINKEDIN_CLIENT_ID,
    clientSecret: !!process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: process.env.LINKEDIN_CALLBACK_URL
  });
});

// Test endpoint to check what happens with a real LinkedIn API call
app.get('/api/test-linkedin-api', async (req, res) => {
  const accessToken = req.query.token;
  if (!accessToken) {
    return res.json({ error: 'Please provide access token in query parameter: ?token=YOUR_TOKEN' });
  }
  
  try {
    console.log('🧪 Testing LinkedIn API call with token:', accessToken.substring(0, 20) + '...');
    
    const https = require('https');
    const url = 'https://api.linkedin.com/v2/userinfo';
    
    const response = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.linkedin.com',
        path: '/v2/userinfo',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'User-Agent': 'LinkedIn-Post-Generator/1.0'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });
      
      req.on('error', reject);
      req.end();
    });
    
    console.log('🧪 LinkedIn API test response:', response);
    
    let parsedBody;
    try {
      parsedBody = JSON.parse(response.body);
    } catch (e) {
      parsedBody = response.body;
    }
    
    res.json({
      statusCode: response.statusCode,
      headers: response.headers,
      bodyRaw: response.body,
      bodyParsed: parsedBody,
      success: response.statusCode === 200
    });
    
  } catch (error) {
    console.error('🧪 LinkedIn API test error:', error);
    res.json({
      error: error.message,
      stack: error.stack
    });
  }
});

// ====================
// USER CONTEXT ROUTES
// ====================

// Save user context
app.post('/api/user/context', requireAuth, async (req, res) => {
  try {
    const { personalBackground, recentActivities, expertiseInterests } = req.body;
    
    const context = await UserDB.updateContext(req.user.id, {
      personalBackground,
      recentActivities,
      expertiseInterests
    });
    
    res.json({ success: true, context });
  } catch (error) {
    console.error('Error saving user context:', error);
    res.status(500).json({ error: 'Failed to save context' });
  }
});

// Get user context
app.get('/api/user/context', requireAuth, async (req, res) => {
  try {
    const context = await UserDB.getContext(req.user.id);
    res.json(context || {});
  } catch (error) {
    console.error('Error loading user context:', error);
    res.status(500).json({ error: 'Failed to load context' });
  }
});

// ====================
// USER PREFERENCES ROUTES
// ====================

// Get user preferences
app.get('/api/preferences', requireAuth, async (req, res) => {
  try {
    const preferences = await PreferencesDB.getUserPreferences(req.user.id);
    res.json(preferences);
  } catch (error) {
    console.error('❌ Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update user preferences
app.post('/api/preferences', requireAuth, async (req, res) => {
  try {
    await PreferencesDB.updateUserPreferences(req.user.id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error updating preferences:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// ====================
// SCHEDULED POSTS ROUTES
// ====================

// Get user's scheduled posts
app.get('/api/scheduled-posts', requireAuth, async (req, res) => {
  try {
    const posts = await PostsDB.getUserScheduledPosts(req.user.id);
    res.json(posts);
  } catch (error) {
    console.error('❌ Error fetching scheduled posts:', error);
    res.status(500).json({ error: 'Failed to fetch scheduled posts' });
  }
});

// Schedule a post manually
app.post('/api/schedule-post', requireAuth, rateLimitMiddleware, async (req, res) => {
  try {
    const { topic, tone, scheduled_for } = req.body;
    
    if (!topic || !tone || !scheduled_for) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Generate the post content
    const postData = await generatePost(topic, tone);
    
    if (!postData.post) {
      return res.status(500).json({ error: 'Failed to generate post content' });
    }

    const post = await PostsDB.createScheduledPost(req.user.id, {
      topic,
      tone,
      post_content: postData.post,
      image_url: postData.image?.url || null,
      article_url: postData.article?.url || null,
      scheduled_for: scheduled_for
    });

    res.json({ success: true, postId: post.id });
  } catch (error) {
    console.error('❌ Error scheduling post:', error);
    res.status(500).json({ error: 'Failed to schedule post' });
  }
});

// Cancel a scheduled post
app.delete('/api/scheduled-posts/:postId', requireAuth, async (req, res) => {
  try {
    const success = await PostScheduler.cancelScheduledPost(req.params.postId, req.user.id);
    res.json({ success });
  } catch (error) {
    console.error('❌ Error cancelling post:', error);
    res.status(500).json({ error: 'Failed to cancel post' });
  }
});

// Post immediately to LinkedIn
app.post('/api/post-now', requireAuth, rateLimitMiddleware, async (req, res) => {
      try {
      const { content, imageUrl, articleUrl, useArticleLink } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Post content is required' });
    }

    const accessToken = await LinkedInService.ensureValidToken(req.user.id);
    const result = await LinkedInService.createPost(accessToken, content, imageUrl, articleUrl, useArticleLink);

    if (result.success) {
      res.json({ success: true, postId: result.postId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('❌ Error posting to LinkedIn:', error);
    res.status(500).json({ error: 'Failed to post to LinkedIn' });
  }
});

// ====================
// SUBSCRIPTION AND PAYMENT ROUTES
// ====================

// Initialize Stripe service
const stripeService = new StripeService();

// ====================
// CREDIT PURCHASE ROUTES
// ====================

// Create credit purchase checkout session
app.post('/api/credits/purchase', requireAuth, async (req, res) => {
  try {
    const { planName, creditAmount, price } = req.body;
    const userId = req.user.id;
    
    if (!planName || !creditAmount || !price) {
      return res.status(400).json({ 
        error: 'Plan name, credit amount, and price are required' 
      });
    }

    console.log('💳 Creating credit purchase checkout session:', { 
      userId, 
      planName, 
      creditAmount, 
      price 
    });

    // Create Stripe checkout session for credit purchase
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${planName} - ${creditAmount} Credits`,
              description: `Purchase ${creditAmount} credits for content generation`,
            },
            unit_amount: Math.round(price * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.headers.origin || 'https://employment.vercel.app'}/pricing?success=true&credits=${creditAmount}`,
      cancel_url: `${req.headers.origin || 'https://employment.vercel.app'}/pricing?canceled=true`,
      metadata: {
        user_id: userId.toString(),
        credit_amount: creditAmount.toString(),
        plan_name: planName
      }
    });

    console.log('✅ Stripe checkout session created:', session.id);

    res.json({ checkoutUrl: session.url });
  } catch (error) {
    console.error('❌ Error creating credit purchase session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Get user's current credits
app.get('/api/credits/balance', requireAuth, async (req, res) => {
  try {
    const credits = await CreditDB.getCredits(req.user.id);
    res.json({ credits });
  } catch (error) {
    console.error('❌ Error fetching credit balance:', error);
    res.status(500).json({ error: 'Failed to fetch credit balance' });
  }
});

// Add credits to user account (manual addition)
app.post('/api/credits/add', requireAuth, async (req, res) => {
  try {
    const { credits, description } = req.body;
    
    if (!credits || credits <= 0) {
      return res.status(400).json({ error: 'Valid credit amount is required' });
    }

    // For security, limit manual additions to reasonable amounts
    if (credits > 500) {
      return res.status(400).json({ error: 'Credit amount too large' });
    }

    const newBalance = await CreditDB.addCredits(
      req.user.id, 
      credits, 
      description || 'Manual addition'
    );
    
    res.json({
      success: true,
      message: `Added ${credits} credits to your account`,
      creditsAdded: credits,
      newBalance: newBalance
    });
    
  } catch (error) {
    console.error('❌ Error adding credits:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get subscription plans
app.get('/api/subscription/plans', async (req, res) => {
  try {
    // Handle activation via plans endpoint - Multiple activation triggers
    const activateParam = req.query.activate;
    console.log('🔧 Plans endpoint - activate parameter:', activateParam);
    
    if (activateParam === 'subscription' || activateParam === 'now' || activateParam === 'force') {
      console.log('🚀 Direct activation requested via plans endpoint');
      
      // Simple SQL-based activation for user_id = 1
      try {
        const client = await pool.connect();
        
        // First check what subscriptions exist
        const checkResult = await client.query(
          'SELECT * FROM user_subscriptions WHERE user_id = $1',
          [1]
        );
        
        console.log('🔍 Found subscriptions for user 1:', checkResult.rows.length);
        if (checkResult.rows.length > 0) {
          console.log('🔍 Current subscription status:', checkResult.rows[0].status);
        }
        
        // Update subscription status directly - try both incomplete and any status
        const updateResult = await client.query(
          'UPDATE user_subscriptions SET status = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *',
          ['active', 1]
        );
        
        client.release();
        
        if (updateResult.rows.length > 0) {
          console.log('✅ Subscription activated directly via SQL!');
          console.log('✅ New status:', updateResult.rows[0].status);
          
          return res.json({
            success: true,
            message: 'Subscription activated successfully!',
            activated: true,
            old_status: checkResult.rows[0]?.status || 'unknown',
            new_status: updateResult.rows[0].status,
            subscription: updateResult.rows[0],
            instruction: 'Now refresh your homepage to see the changes!'
          });
        } else {
          console.log('⚠️ No subscription found to activate');
          
          return res.json({
            success: false,
            message: 'No subscription found for user',
            debug: {
              user_id: 1,
              subscriptions_found: checkResult.rows.length,
              update_affected: updateResult.rowCount
            }
          });
        }
      } catch (activationError) {
        console.error('❌ Direct activation error:', activationError);
        return res.status(500).json({ 
          error: 'Activation failed', 
          details: activationError.message,
          stack: activationError.stack 
        });
      }
    }
    
    // Check for migration parameter
    if (req.query.migrate === 'fix-constraint') {
      console.log('🔄 Running database constraint migration via plans endpoint...');
      
      const client = await pool.connect();
      try {
        let migrationSteps = [];
        
        // Check existing constraint
        const constraintQuery = `
          SELECT constraint_name, check_clause 
          FROM information_schema.check_constraints 
          WHERE constraint_name = 'user_subscriptions_status_check'
        `;
        const constraintResult = await client.query(constraintQuery);
        
        if (constraintResult.rows.length > 0) {
          migrationSteps.push(`Found existing constraint: ${constraintResult.rows[0].check_clause}`);
          
          // Drop existing constraint
          await client.query(`
            ALTER TABLE user_subscriptions 
            DROP CONSTRAINT user_subscriptions_status_check
          `);
          migrationSteps.push('Dropped existing constraint');
        } else {
          migrationSteps.push('No existing constraint found');
        }
        
        // Add new constraint
        await client.query(`
          ALTER TABLE user_subscriptions 
          ADD CONSTRAINT user_subscriptions_status_check 
          CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid', 'incomplete'))
        `);
        migrationSteps.push('Added new constraint with incomplete status');
        
        // Verify new constraint
        const newConstraintResult = await client.query(constraintQuery);
        if (newConstraintResult.rows.length > 0) {
          migrationSteps.push(`New constraint verified: ${newConstraintResult.rows[0].check_clause}`);
        }
        
        return res.json({
          migration_success: true,
          message: 'Status constraint migration completed successfully',
          steps: migrationSteps,
          timestamp: new Date().toISOString(),
          next_step: 'Try creating a subscription now - it should work!'
        });
        
      } finally {
        client.release();
      }
    }

    // Regular plans endpoint
    console.log('📋 Database query: Getting subscription plans...');
    const plans = await SubscriptionDB.getPlans();
    console.log('📋 Database query result:', plans?.length || 0, 'plans found');
    res.json(plans);
  } catch (error) {
    console.error('❌ Error fetching subscription plans:', error);
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

// Update plan Stripe price ID (for setup purposes)
app.post('/api/update-plan-stripe-id', async (req, res) => {
  try {
    const { name, stripe_price_id, launch_price } = req.body;
    
    if (!name || !stripe_price_id) {
      return res.status(400).json({ error: 'Name and stripe_price_id are required' });
    }

    const result = await SubscriptionDB.updatePlanStripeId(name, stripe_price_id, launch_price);
    res.json({ success: true, updated: result });
  } catch (error) {
    console.error('❌ Error updating plan Stripe ID:', error);
    res.status(500).json({ error: 'Failed to update plan Stripe ID' });
  }
});

// Payment Links are now used instead of checkout sessions - see pricing.html

// Create Stripe billing portal session for subscription management
app.post('/api/stripe/billing-portal', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔧 Creating billing portal for user:', userId);
    
    // Get user's subscription to find customer ID
    const subscription = await SubscriptionDB.getUserSubscription(userId);
    console.log('🔧 User subscription:', subscription ? 'Found' : 'Not found');
    console.log('🔧 Customer ID:', subscription?.stripe_customer_id);
    
    if (!subscription || !subscription.stripe_customer_id) {
      console.log('❌ No subscription or customer ID found');
      return res.status(400).json({ 
        error: 'No active subscription found. Please subscribe to a plan first.',
        redirect: '/pricing'
      });
    }
    
    // Create billing portal session
    console.log('🔧 Creating Stripe billing portal session...');
    const session = await stripeService.createBillingPortalSession(
      userId,
      `${process.env.NODE_ENV === 'production' ? 'https://employment.vercel.app' : 'http://localhost:3000'}/manage-subscription`
    );
    
    console.log('✅ Billing portal session created:', session.id);
    res.json({ url: session.url });
    
  } catch (error) {
    console.error('❌ Error creating billing portal session:', error);
    res.status(500).json({ 
      error: 'Failed to create billing portal session: ' + error.message,
      redirect: '/manage-subscription'
    });
  }
});

// Function to create default subscription plans
async function createDefaultPlans() {
  const defaultPlans = [
    {
      name: 'Starter',
      posts_limit: 30,
      price: 0.99,
      launch_price: 0.49,
      stripe_price_id: 'price_1RXelQKkxlEtPdqxvLmom609',
      features: {
        features: [
          'AI-powered content generation',
          'Real-time news integration',
          'Multiple tone options',
          'LinkedIn direct posting'
        ]
      }
    },
    {
      name: 'Professional',
      posts_limit: 100,
      price: 2.99,
      launch_price: 1.49,
      stripe_price_id: 'price_1RXelRKkxlEtPdqxrGxYu3Bp',
      features: {
        features: [
          'AI-powered content generation',
          'Real-time news integration',
          'Multiple tone options',
          'LinkedIn direct posting',
          'Content analytics',
          'Priority support'
        ]
      }
    },
    {
      name: 'Business',
      posts_limit: 300,
      price: 4.99,
      launch_price: 2.49,
      stripe_price_id: 'price_1RXelRKkxlEtPdqxveicYc5e',
      features: {
        features: [
          'AI-powered content generation',
          'Real-time news integration',
          'Multiple tone options',
          'LinkedIn direct posting',
          'Content analytics',
          'Priority support',
          'Bulk scheduling'
        ]
      }
    },
    {
      name: 'Enterprise',
      posts_limit: -1,
      price: 9.99,
      launch_price: 4.99,
      stripe_price_id: 'price_1RXelSKkxlEtPdqxEsphgkdn',
      features: {
        features: [
          'AI-powered content generation',
          'Real-time news integration',
          'Multiple tone options',
          'LinkedIn direct posting',
          'Content analytics',
          'Priority support',
          'Bulk scheduling',
          'Unlimited posts',
          'Custom integrations'
        ]
      }
    }
  ];

  for (const plan of defaultPlans) {
    try {
      await SubscriptionDB.createPlan(plan);
      console.log(`✅ Created plan: ${plan.name}`);
    } catch (error) {
      console.log(`⚠️ Plan ${plan.name} might already exist:`, error.message);
    }
  }
}

// Get user's current subscription and usage
app.get('/api/subscription/status', requireAuth, async (req, res) => {
  try {
    console.log('🎯 STATUS ENDPOINT HIT - DEPLOYMENT TEST v219cbe0 - FORCE REDEPLOY');
    const userId = req.user.id;
    const activateIncomplete = req.query.activate === 'true';
    
    // IMMEDIATE DEPLOYMENT TEST
    if (req.query.test === 'deployment') {
      return res.json({
        deployment_test: true,
        timestamp: new Date().toISOString(),
        message: 'New deployment is working!',
        user_id: userId
      });
    }
    
    const [subscription, usage] = await Promise.all([
      SubscriptionDB.getUserSubscription(userId),
      UsageDB.getMonthlyUsage(userId)
    ]);

    // AUTO-ACTIVATE ALL INCOMPLETE SUBSCRIPTIONS (no parameters needed)
    console.log('🔧 Auto-activation check for user:', userId);
    console.log('🔧 Subscription status:', subscription?.status);
    
    if (subscription && subscription.status === 'incomplete') {
      console.log('🚀 AUTO-ACTIVATING INCOMPLETE SUBSCRIPTION!');
      
      try {
        // Direct SQL update to force activation
        const client = await pool.connect();
        
        const updateResult = await client.query(
          'UPDATE user_subscriptions SET status = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *',
          ['active', userId]
        );
        
        client.release();
        
        if (updateResult.rows.length > 0) {
          console.log('✅ AUTO-ACTIVATION SUCCESSFUL!');
          console.log('✅ Updated status to active');
          
          // Fetch complete updated subscription data
          const updatedSubscription = await SubscriptionDB.getUserSubscription(userId);
          const usageLimit = await UsageDB.checkUsageLimit(userId);
          
          return res.json({
            subscription: updatedSubscription,
            usage,
            usageLimit,
            auto_activated: true,
            message: '🎉 SUBSCRIPTION AUTO-ACTIVATED!',
            old_status: 'incomplete',
            new_status: 'active',
            success: true
          });
        }
      } catch (activationError) {
        console.error('❌ Auto-activation error:', activationError);
        // Continue with original response if activation fails
      }
    }

    // LEGACY: Also check for manual activation parameters
    console.log('🔧 Manual activation check:', { activateIncomplete, hasSubscription: !!subscription, status: subscription?.status });
    
    // FORCE ACTIVATION - if any activation parameter is present, activate regardless of status
    if (activateIncomplete || req.query.force === 'true' || req.query.activate) {
      console.log('🚀 FORCE ACTIVATION TRIGGERED for user:', userId);
      
      if (subscription) {
        try {
          // Direct SQL update to force activation
          const client = await pool.connect();
          
          const updateResult = await client.query(
            'UPDATE user_subscriptions SET status = $1, updated_at = NOW() WHERE user_id = $2 RETURNING *',
            ['active', userId]
          );
          
          client.release();
          
          if (updateResult.rows.length > 0) {
            console.log('✅ FORCE ACTIVATION SUCCESSFUL!');
            console.log('✅ Old status:', subscription.status);
            console.log('✅ New status:', updateResult.rows[0].status);
            
            // Fetch complete updated subscription data
            const updatedSubscription = await SubscriptionDB.getUserSubscription(userId);
            const usageLimit = await UsageDB.checkUsageLimit(userId);
            
            return res.json({
              subscription: updatedSubscription,
              usage,
              usageLimit,
              activated: true,
              message: '🎉 SUBSCRIPTION FORCE ACTIVATED!',
              old_status: subscription.status,
              new_status: 'active',
              success: true
            });
          }
        } catch (activationError) {
          console.error('❌ Force activation error:', activationError);
          // Continue with original response if activation fails
        }
      }
    }

    const usageLimit = await UsageDB.checkUsageLimit(userId);
    
    res.json({
      subscription,
      usage,
      usageLimit
    });
  } catch (error) {
    console.error('❌ Error fetching subscription status:', error);
    res.status(500).json({ error: 'Failed to fetch subscription status' });
  }
});

// Manual endpoint to reset monthly usage (for fixing subscription issues)
app.post('/api/subscription/reset-usage', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔧 Manual usage reset requested for user:', userId);
    
    // Check if user has an active subscription
    const subscription = await SubscriptionDB.getUserSubscription(userId);
    if (!subscription || subscription.status !== 'active') {
      return res.status(400).json({ 
        error: 'No active subscription found',
        details: 'You need an active subscription to reset usage'
      });
    }
    
    // Reset the usage
    await UsageDB.resetMonthlyUsage(userId);
    
    // Get updated usage info
    const usageLimit = await UsageDB.checkUsageLimit(userId);
    
    console.log('✅ Manual usage reset completed for user:', userId);
    
    res.json({
      success: true,
      message: 'Monthly usage has been reset',
      subscription,
      usageLimit,
      postsRemaining: usageLimit.postsRemaining
    });
  } catch (error) {
    console.error('❌ Error resetting usage:', error);
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

// Create customer endpoint (following Stripe guide)
app.post('/api/subscription/create-customer', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    
    // Check if customer already exists
    const existingSubscription = await SubscriptionDB.getUserSubscription(user.id);
    if (existingSubscription && existingSubscription.stripe_customer_id) {
      return res.json({ 
        customerId: existingSubscription.stripe_customer_id 
      });
    }

    const customer = await stripeService.createCustomer(user);
    res.json({ customerId: customer.id });
  } catch (error) {
    console.error('❌ Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

// Create subscription endpoint (following Stripe guide)
app.post('/api/subscription/create-subscription', requireAuth, async (req, res) => {
  try {
    console.log('📋 Creating subscription for user:', req.user.id);
    const { priceId, customerId } = req.body;
    const userId = req.user.id;
    
    console.log('📋 Request data:', { priceId, customerId, userId });
    
    if (!priceId || !customerId) {
      console.log('❌ Missing required fields:', { priceId: !!priceId, customerId: !!customerId });
      return res.status(400).json({ 
        error: 'Price ID and Customer ID are required',
        details: { 
          priceId: priceId || 'missing', 
          customerId: customerId || 'missing' 
        }
      });
    }
    
    // Validate that the price ID is not null (for free plans)
    if (priceId === 'null' || priceId === null) {
      console.log('❌ Invalid price ID for paid plan:', priceId);
      return res.status(400).json({ 
        error: 'Cannot create paid subscription with null price ID',
        details: 'This appears to be a free plan. No payment required.'
      });
    }

    // First verify the price ID exists in our database
    const plans = await SubscriptionDB.getPlans();
    console.log('📋 Available plans:', plans.map(p => ({
      name: p.name,
      price_id: p.stripe_price_id,
      price: p.launch_price || p.price
    })));
    
    const plan = plans.find(p => p.stripe_price_id === priceId);
    
    if (!plan) {
      console.error('❌ Invalid price ID:', priceId);
      console.error('❌ Available price IDs:', plans.map(p => ({
        name: p.name,
        price_id: p.stripe_price_id,
        price: p.launch_price || p.price
      })));
      return res.status(400).json({ 
        error: 'Invalid price ID',
        details: 'The selected subscription plan is not valid.'
      });
    }

    console.log('📋 Creating Stripe subscription...');
    const subscription = await stripeService.createSubscription(customerId, priceId);
    console.log('✅ Stripe subscription created:', subscription.id);
    
    // Store subscription in database
    console.log('📋 Storing subscription in database...');
    await SubscriptionDB.upsertSubscription(userId, {
      plan_id: plan.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      status: 'incomplete',
      current_period_start: new Date(subscription.current_period_start * 1000),
      current_period_end: new Date(subscription.current_period_end * 1000)
    });
    console.log('✅ Subscription stored in database');

    console.log('📋 Subscription response:', {
      subscriptionId: subscription.id,
      hasClientSecret: !!subscription.latest_invoice?.payment_intent?.client_secret
    });

    res.json({
      subscriptionId: subscription.id,
      clientSecret: subscription.latest_invoice.payment_intent.client_secret
    });
  } catch (error) {
    console.error('❌ Error creating subscription:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', {
      message: error.message,
      type: error.type,
      code: error.code,
      statusCode: error.statusCode,
      raw: error.raw // Include raw Stripe error if available
    });
    
    let errorMessage = 'Failed to create subscription';
    let statusCode = 500;
    
    if (error.type === 'StripeInvalidRequestError') {
      errorMessage = 'Invalid payment details';
      statusCode = 400;
    } else if (error.code === 'resource_missing' && error.param === 'price') {
      errorMessage = 'Invalid subscription plan';
      statusCode = 400;
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        type: error.type,
        code: error.code
      } : undefined
    });
  }
});

// Cancel subscription endpoint (following Stripe guide)
app.post('/api/subscription/cancel-subscription', requireAuth, async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const userId = req.user.id;
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }

    // Verify user owns this subscription
    const userSubscription = await SubscriptionDB.getUserSubscription(userId);
    if (!userSubscription || userSubscription.stripe_subscription_id !== subscriptionId) {
      return res.status(403).json({ error: 'Unauthorized to cancel this subscription' });
    }

    const cancelledSubscription = await stripeService.cancelSubscription(subscriptionId);
    res.json(cancelledSubscription);
  } catch (error) {
    console.error('❌ Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// Manual subscription activation endpoint
app.post('/api/subscription/activate-manual', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔄 Manual activation requested for user:', userId);
    
    // Get user's subscription
    const subscription = await SubscriptionDB.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    console.log('📋 Found subscription:', {
      id: subscription.id,
      status: subscription.status,
      stripe_subscription_id: subscription.stripe_subscription_id
    });
    
    // If already active, return current subscription
    if (subscription.status === 'active') {
      console.log('✅ Subscription already active');
      return res.json({ subscription });
    }
    
    // Try to get the latest status from Stripe
    if (subscription.stripe_subscription_id) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id);
        console.log('📋 Stripe subscription status:', stripeSubscription.status);
        
        // Update local status to match Stripe
        let localStatus = 'active';
        if (stripeSubscription.status === 'canceled') localStatus = 'cancelled';
        else if (stripeSubscription.status === 'past_due') localStatus = 'past_due';
        else if (stripeSubscription.status === 'unpaid') localStatus = 'unpaid';
        else if (stripeSubscription.status === 'incomplete') localStatus = 'incomplete';
        
        if (localStatus !== subscription.status) {
          await SubscriptionDB.updateSubscriptionStatus(userId, localStatus);
          console.log('✅ Updated subscription status to:', localStatus);
        }
        
        // If now active, return updated subscription
        if (localStatus === 'active') {
          const updatedSubscription = await SubscriptionDB.getUserSubscription(userId);
          return res.json({ subscription: updatedSubscription });
        }
      } catch (stripeError) {
        console.error('❌ Error fetching from Stripe:', stripeError.message);
      }
    }
    
    // If subscription is incomplete, try to activate it
    if (subscription.status === 'incomplete') {
      try {
        await SubscriptionDB.updateSubscriptionStatus(userId, 'active');
        console.log('✅ Manually activated incomplete subscription');
        
        const updatedSubscription = await SubscriptionDB.getUserSubscription(userId);
        return res.json({ subscription: updatedSubscription });
      } catch (dbError) {
        console.error('❌ Error updating subscription status:', dbError);
        return res.status(500).json({ error: 'Failed to activate subscription' });
      }
    }
    
    return res.status(400).json({ 
      error: `Subscription is in ${subscription.status} status and cannot be activated manually` 
    });
    
  } catch (error) {
    console.error('❌ Error in manual activation:', error);
    res.status(500).json({ error: 'Failed to activate subscription' });
  }
});

// Get payment status endpoint
app.get('/api/subscription/payment-status/:paymentIntentId', requireAuth, async (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    
    // Try to get payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    res.json({
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency
    });
  } catch (error) {
    console.error('❌ Error fetching payment status:', error);
    res.status(500).json({ error: 'Failed to fetch payment status' });
  }
});

// Get session details endpoint for success page
app.get('/api/subscription/session-details/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    console.log('🔍 Fetching session details for:', sessionId);
    
    // Get session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    console.log('📦 Session retrieved:', {
      id: session.id,
      mode: session.mode,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      metadata: session.metadata
    });
    
    res.json({
      id: session.id,
      mode: session.mode,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
      metadata: session.metadata,
      customer_details: session.customer_details,
      subscription: session.subscription
    });
  } catch (error) {
    console.error('❌ Error fetching session details:', error);
    res.status(500).json({ error: 'Failed to fetch session details' });
  }
});

// Manual credit addition for troubleshooting purchases
app.post('/api/credits/manual-add', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { credits, reason, sessionId } = req.body;
    
    console.log(`🔧 Manual credit addition requested:`, {
      userId,
      credits,
      reason,
      sessionId
    });
    
    if (!credits || credits <= 0) {
      return res.status(400).json({ error: 'Invalid credit amount' });
    }
    
    if (credits > 500) {
      return res.status(400).json({ error: 'Credit amount too large (max 500)' });
    }
    
    // Add credits using the proper credit system
    const CreditDB = require('./database').CreditDB;
    const newBalance = await CreditDB.addCredits(
      userId, 
      credits, 
      reason || `Manual addition via success page (Session: ${sessionId || 'unknown'})`
    );
    
    console.log(`✅ Manually added ${credits} credits to user ${userId}. New balance: ${newBalance}`);
    
    res.json({
      success: true,
      message: `Successfully added ${credits} credits to your account`,
      credits_added: credits,
      new_balance: newBalance
    });
  } catch (error) {
    console.error('❌ Error manually adding credits:', error);
    res.status(500).json({ error: 'Failed to add credits' });
  }
});

// Test webhook endpoint to verify webhook configuration
app.get('/api/webhooks/test', async (req, res) => {
  try {
    console.log('🧪 Testing webhook configuration...');
    
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    res.json({
      webhook_secret_configured: !!webhookSecret && webhookSecret !== 'whsec_your_webhook_secret_here',
      webhook_secret_placeholder: webhookSecret === 'whsec_your_webhook_secret_here',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error testing webhook:', error);
    res.status(500).json({ error: 'Failed to test webhook configuration' });
  }
});

// Credit pack price IDs
const CREDIT_PACK_PRICES = {
  25: 'price_1RYKaLKkxlEtPdqxLAKLndhB',    // $0.99 for 25 credits (Small pack)
  75: 'price_1RYKajKkxlEtPdqxaSbA8TSi',    // $2.49 for 75 credits (Medium pack)  
  200: 'price_1RYKbZKkxlEtPdqxjBt0e4xK'   // $5.99 for 200 credits (Large pack)
};

// Create checkout session for credit purchases
app.post('/api/credits/create-checkout', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { credits, pack_name } = req.body;
    
    console.log('💳 Creating credit checkout session:', {
      userId,
      credits,
      pack_name
    });
    
    if (!credits || credits <= 0) {
      return res.status(400).json({ error: 'Invalid credit amount' });
    }
    
    // Get the price ID for this credit amount
    const priceId = CREDIT_PACK_PRICES[credits];
    if (!priceId) {
      return res.status(400).json({ 
        error: `No price ID configured for ${credits} credits. Available: ${Object.keys(CREDIT_PACK_PRICES).join(', ')}` 
      });
    }
    
    if (priceId.includes('REPLACE_WITH')) {
      return res.status(500).json({ 
        error: 'Credit pack price IDs not configured. Please set up price IDs in Stripe dashboard first.' 
      });
    }
    
    // Create checkout session with existing price ID
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price: priceId,  // Use existing price ID instead of dynamic pricing
          quantity: 1,
        },
      ],
      customer_email: req.user.email,
      metadata: {
        user_id: userId.toString(),
        credit_amount: credits.toString(),
        pack_type: pack_name,
        plan_type: 'credit_pack'
      },
      success_url: `${req.headers.origin}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/credits?canceled=true`,
    });
    
    console.log('✅ Credit checkout session created:', session.id);
    
    res.json({ 
      sessionId: session.id,
      credits: credits,
      priceId: priceId
    });
  } catch (error) {
    console.error('❌ Error creating credit checkout:', error);
    res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Quick fix endpoint to activate incomplete subscription (GET and POST)
app.get('/api/subscription/quick-activate', requireAuth, async (req, res) => {
  try {
    console.log('🔧 Quick activation endpoint hit!');
    const userId = req.user.id;
    console.log('🔧 Quick activation requested for user:', userId);
    
    // Get current subscription
    const subscription = await SubscriptionDB.getUserSubscription(userId);
    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }
    
    console.log('📋 Current subscription status:', subscription.status);
    
    if (subscription.status === 'incomplete') {
      // Update status to active
      await SubscriptionDB.updateSubscriptionStatus(userId, 'active');
      console.log('✅ Subscription activated!');
      
      // Get updated subscription
      const updatedSubscription = await SubscriptionDB.getUserSubscription(userId);
      return res.json({ 
        success: true, 
        message: 'Subscription activated successfully!',
        subscription: updatedSubscription
      });
    } else {
      return res.json({ 
        success: true, 
        message: `Subscription is already ${subscription.status}`,
        subscription: subscription
      });
    }
    
  } catch (error) {
    console.error('❌ Error in quick activation:', error);
    res.status(500).json({ error: 'Failed to activate subscription' });
  }
});

// Simple test endpoint without auth
app.get('/api/subscription/test-activate', async (req, res) => {
  console.log('🧪 Test activation endpoint hit!');
  res.json({ 
    success: true, 
    message: 'Test endpoint working!',
    timestamp: new Date().toISOString()
  });
});

// Dedicated activation endpoint - no auth required for now
app.get('/api/activate-nick-subscription', async (req, res) => {
  console.log('🚀 DEDICATED ACTIVATION ENDPOINT HIT!');
  
  try {
    const client = await pool.connect();
    
    // First check current subscription
    const checkResult = await client.query(
      'SELECT * FROM user_subscriptions WHERE user_id = 1'
    );
    
    console.log('📋 Current subscription for user 1:', checkResult.rows[0]);
    
    // Force update to active
    const updateResult = await client.query(
      'UPDATE user_subscriptions SET status = $1, updated_at = NOW() WHERE user_id = 1 RETURNING *',
      ['active']
    );
    
    client.release();
    
    console.log('✅ UPDATE COMPLETED!');
    console.log('✅ Rows affected:', updateResult.rowCount);
    console.log('✅ Updated subscription:', updateResult.rows[0]);
    
    return res.json({
      success: true,
      message: '🎉 SUBSCRIPTION ACTIVATED!',
      before: checkResult.rows[0],
      after: updateResult.rows[0],
      rows_affected: updateResult.rowCount,
      instruction: 'NOW REFRESH YOUR HOMEPAGE!'
    });
    
  } catch (error) {
    console.error('❌ ACTIVATION ERROR:', error);
    return res.status(500).json({
      error: 'Activation failed',
      details: error.message,
      stack: error.stack
    });
  }
});

// Create checkout session (keep existing for backward compatibility)
app.post('/api/subscription/checkout', requireAuth, async (req, res) => {
  try {
    const { priceId } = req.body;
    const userId = req.user.id;
    
    if (!priceId) {
      return res.status(400).json({ error: 'Price ID is required' });
    }

    const session = await stripeService.createCheckoutSession(
      userId,
      priceId,
      `${req.headers.origin}/subscription/success`,
      `${req.headers.origin}/subscription/cancel`
    );

    res.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Create billing portal session
app.post('/api/subscription/billing-portal', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const session = await stripeService.createBillingPortalSession(
      userId,
      `${req.headers.origin}/dashboard`
    );

    res.json({ url: session.url });
  } catch (error) {
    console.error('❌ Error creating billing portal session:', error);
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

// Stripe webhook endpoint
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];
    
    console.log('🔔 Webhook received with signature:', signature ? 'present' : 'missing');
    console.log('🔔 Webhook body size:', req.body?.length || 0);
    
    if (!signature) {
      console.error('❌ Missing Stripe signature in webhook');
      return res.status(400).json({ error: 'Missing Stripe signature' });
    }

    const result = await stripeService.handleWebhook(req.body, signature);
    console.log('✅ Webhook processed successfully');
    res.json({ received: true, result });
  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      type: error.type,
      stack: error.stack
    });
    res.status(400).json({ 
      error: 'Webhook processing failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Debug endpoint for user credit status
app.get('/api/debug/user-status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get user data
    const user = await UserDB.getUserById(userId);
    
    // Get subscription data
    const subscription = await SubscriptionDB.getUserSubscription(userId);
    
    // Get credit balance
    const credits = await CreditDB.getCredits(userId);
    
    // Get recent usage using the proper database connection
    const { Pool } = require('pg');
    const dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    const recentUsage = await dbPool.query(`
      SELECT * FROM usage_tracking 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 10
    `, [userId]);
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        credits: user.credits
      },
      subscription,
      creditBalance: credits,
      recentUsage: recentUsage.rows
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Sync credit balance manually
app.post('/api/debug/sync-credits', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get current credit balance from CreditDB
    const credits = await CreditDB.getCredits(userId);
    
    // Update the users table using the proper database connection
    const { Pool } = require('pg');
    const dbPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    await dbPool.query('UPDATE users SET credits = $1 WHERE id = $2', [credits, userId]);
    
    res.json({
      success: true,
      message: `Credit balance synced: ${credits} credits`,
      credits
    });
  } catch (error) {
    console.error('Credit sync error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ====================
// ACCESS KEY ROUTES
// ====================

// Activate an access key
app.post('/api/access-key/activate', requireAuth, async (req, res) => {
  try {
    const { keyCode } = req.body;
    const userId = req.user.id;
    
    if (!keyCode) {
      return res.status(400).json({ error: 'Access key code is required' });
    }

    const result = await AccessKeysDB.useAccessKey(userId, keyCode);
    
    if (result.success) {
      res.json({
        success: true,
        message: `Access key activated! ${result.postsRemaining} posts remaining.`,
        postsRemaining: result.postsRemaining,
        keyName: result.keyName
      });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error('❌ Error activating access key:', error);
    res.status(500).json({ error: 'Failed to activate access key' });
  }
});

// Get user's access keys
app.get('/api/access-key/list', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const accessKeys = await AccessKeysDB.getUserAccessKeys(userId);
    res.json(accessKeys);
  } catch (error) {
    console.error('❌ Error fetching access keys:', error);
    res.status(500).json({ error: 'Failed to fetch access keys' });
  }
});

// Admin: Create access key (requires admin privileges)
app.post('/api/admin/access-key/create', async (req, res) => {
  try {
    // Admin authentication check
    const adminPassword = req.headers['x-admin-key'] || req.query.key;
    const expectedPassword = process.env.ADMIN_PASSWORD || 'Employment-admin-2024';
    
    if (!adminPassword || adminPassword !== expectedPassword) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }
    
    const { name, key_code, postsLimit, validUntil } = req.body;
    const createdBy = 'admin';
    
    // Validate custom key code if provided
    if (key_code) {
      // Check if key code is valid format (letters, numbers, dashes only)
      if (!/^[A-Za-z0-9-]+$/.test(key_code)) {
        return res.status(400).json({ 
          error: 'Custom key code can only contain letters, numbers, and dashes' 
        });
      }
      
      // Check if key code already exists
      const existingKey = await AccessKeysDB.getKeyByCode(key_code);
      if (existingKey) {
        return res.status(400).json({ 
          error: 'This key code already exists. Please choose a different one.' 
        });
      }
    }
    
    const accessKey = await AccessKeysDB.createAccessKey({
      name,
      key_code: key_code || undefined, // Let createAccessKey generate if not provided
      posts_limit: postsLimit || 10,
      valid_until: validUntil ? new Date(validUntil) : null,
      created_by: createdBy
    });

    res.json({
      success: true,
      accessKey: {
        id: accessKey.id,
        key_code: accessKey.key_code,
        name: accessKey.name,
        posts_limit: accessKey.posts_limit,
        valid_until: accessKey.valid_until
      }
    });
  } catch (error) {
    console.error('❌ Error creating access key:', error);
    if (error.message && error.message.includes('unique constraint')) {
      res.status(400).json({ error: 'This key code already exists. Please choose a different one.' });
    } else {
      res.status(500).json({ error: 'Failed to create access key' });
    }
  }
});

// Admin: Get all access keys
app.get('/api/admin/access-keys', async (req, res) => {
  try {
    // Admin authentication check
    const adminPassword = req.headers['x-admin-key'] || req.query.key;
    const expectedPassword = process.env.ADMIN_PASSWORD || 'Employment-admin-2024';
    
    if (!adminPassword || adminPassword !== expectedPassword) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }
    
    const accessKeys = await AccessKeysDB.getAllAccessKeys();
    
    if (!accessKeys) {
      return res.json([]);
    }
    
    res.json(accessKeys);
  } catch (error) {
    console.error('Error fetching all access keys:', error);
    res.status(500).json({ error: 'Failed to fetch access keys' });
  }
});

// Admin: Delete access key
app.delete('/api/admin/access-key/:keyId', async (req, res) => {
  try {
    // Admin authentication check
    const adminPassword = req.headers['x-admin-key'] || req.query.key;
    const expectedPassword = process.env.ADMIN_PASSWORD || 'Employment-admin-2024';
    
    if (!adminPassword || adminPassword !== expectedPassword) {
      return res.status(401).json({ error: 'Admin authentication required' });
    }
    
    const { keyId } = req.params;
    
    if (!keyId) {
      return res.status(400).json({ error: 'Access key ID is required' });
    }

    const deleted = await AccessKeysDB.deleteAccessKey(keyId);
    
    if (deleted) {
      res.json({ 
        success: true, 
        message: 'Access key deleted successfully' 
      });
    } else {
      res.status(404).json({ 
        error: 'Access key not found' 
      });
    }
  } catch (error) {
    console.error('❌ Error deleting access key:', error);
    res.status(500).json({ error: 'Failed to delete access key' });
  }
});

// ====================
// TESTING/DEVELOPMENT ROUTES
// ====================

// Admin endpoint to reset usage for testing (only in development)
app.post('/admin/reset-usage/:userId', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Admin endpoints only available in development' });
    }

    const { userId } = req.params;
    
    // Reset usage for the user
    const query = `
      DELETE FROM user_usage WHERE user_id = $1
    `;
    await pool.query(query, [userId]);
    
    console.log(`🔧 Admin: Reset usage for user ${userId}`);
    
    res.json({ 
      success: true, 
      message: `Usage reset for user ${userId}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Admin reset usage error:', error);
    res.status(500).json({ error: 'Failed to reset usage' });
  }
});

// Admin endpoint to give unlimited posts for testing
app.post('/admin/unlimited-posts/:userId', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Admin endpoints only available in development' });
    }

    const { userId } = req.params;
    
    // Set a very high post limit for testing
    const query = `
      INSERT INTO user_usage (user_id, month_year, posts_used, posts_limit, cost_used, tokens_used)
      VALUES ($1, $2, 0, 999999, 0, 0)
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET 
        posts_limit = 999999,
        posts_used = 0,
        cost_used = 0,
        tokens_used = 0
    `;
    
    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM format
    await pool.query(query, [userId, currentMonth]);
    
    console.log(`🔧 Admin: Set unlimited posts for user ${userId}`);
    
    res.json({ 
      success: true, 
      message: `Unlimited posts set for user ${userId}`,
      posts_limit: 999999,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Admin unlimited posts error:', error);
    res.status(500).json({ error: 'Failed to set unlimited posts' });
  }
});

// Admin endpoint to create proper subscription for testing
app.post('/admin/activate-subscription/:userId', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Admin endpoints only available in development' });
    }

    const { userId } = req.params;
    
    // First, get the Enterprise plan ID (unlimited posts)
    const planQuery = `SELECT id FROM subscription_plans WHERE name = 'Enterprise'`;
    const planResult = await pool.query(planQuery);
    
    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: 'Enterprise plan not found' });
    }
    
    const planId = planResult.rows[0].id;
    
    // Create or update user subscription
    const subscriptionQuery = `
      INSERT INTO user_subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
      VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 year')
      ON CONFLICT (user_id)
      DO UPDATE SET 
        plan_id = $2,
        status = 'active',
        current_period_start = NOW(),
        current_period_end = NOW() + INTERVAL '1 year',
        updated_at = NOW()
      RETURNING *
    `;
    
    const subscriptionResult = await pool.query(subscriptionQuery, [userId, planId]);
    
    // Also set unlimited usage
    const usageQuery = `
      INSERT INTO user_usage (user_id, month_year, posts_used, posts_limit, cost_used, tokens_used)
      VALUES ($1, $2, 0, 999999, 0, 0)
      ON CONFLICT (user_id, month_year)
      DO UPDATE SET 
        posts_limit = 999999,
        posts_used = 0,
        cost_used = 0,
        tokens_used = 0
    `;
    
    const currentMonth = new Date().toISOString().substring(0, 7);
    await pool.query(usageQuery, [userId, currentMonth]);
    
    console.log(`🔧 Admin: Activated Enterprise subscription for user ${userId}`);
    
    res.json({ 
      success: true, 
      message: `Enterprise subscription activated for user ${userId}`,
      subscription: subscriptionResult.rows[0],
      posts_limit: 999999,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Admin activate subscription error:', error);
    res.status(500).json({ error: 'Failed to activate subscription' });
  }
});

// Admin endpoint to create test login session
app.post('/admin/login/:userId', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Admin endpoints only available in development' });
    }

    const { userId } = req.params;
    
    // Get user from database
    const userQuery = `SELECT * FROM users WHERE id = $1`;
    const userResult = await pool.query(userQuery, [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    
    // Create JWT token
    const token = generateJWT({
      id: user.id,
      linkedin_id: user.linkedin_id,
      name: user.name,
      email: user.email
    });
    
    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // false for local development
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    console.log(`🔧 Admin: Created login session for user ${userId} (${user.name})`);
    
    res.json({
      success: true,
      message: `Login session created for user ${userId}`,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      },
      token_preview: token.substring(0, 20) + '...',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Admin login error:', error);
    res.status(500).json({ error: 'Failed to create login session' });
  }
});

// Browser console helper - get current user ID
app.get('/admin/whoami', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Admin endpoints only available in development' });
    }

    const token = extractJWTFromRequest(req);
    if (!token) {
      return res.json({ error: 'Not authenticated', userId: null });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.json({ error: 'Invalid token', userId: null });
    }

    console.log(`🔧 Admin: Current user ID is ${decoded.id}`);
    
    res.json({ 
      userId: decoded.id,
      name: decoded.name,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Admin whoami error:', error);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// ====================
// HEALTH CHECK AND UTILITY ROUTES
// ====================

// Health check
app.get('/api/health', (req, res) => {
  console.log('🔍 Health check called');
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    apis: {
      openai: !!process.env.OPENAI_API_KEY,
      newsApi: !!(process.env.NEWS_API_KEY || process.env.THENEWSAPI_KEY),
      pexels: !!process.env.PEXELS_API_KEY,
      linkedinOAuth: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)
    },
    features: {
      postGeneration: true,
      copyToClipboard: true,
      linkedinAutomation: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET)
    }
  });
});

// Article extraction API using @extractus/article-extractor (for local testing)
app.get('/api/extract-article', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'Missing URL parameter' });
  }

  try {
    console.log(`🌐 Local article extraction from: ${url}`);
    
    // Import the article extractor
    const { extract } = await import('@extractus/article-extractor');
    
    // First, try to resolve Google News redirects
    let finalUrl = url;
    
    if (url.includes('news.google.com')) {
      console.log(`🔗 Detected Google News URL, attempting to resolve...`);
      
      try {
        // Try to follow redirects to get the actual article URL
        const response = await axios.get(url, {
          maxRedirects: 5,
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        finalUrl = response.request.res.responseUrl || response.config.url || url;
        console.log(`✅ Resolved to: ${finalUrl}`);
        
        // If still a Google URL after redirects, try base64 decoding
        if (finalUrl.includes('google.com') && url.includes('CBM')) {
          console.log(`🧩 Attempting base64 decode...`);
          try {
            const match = url.match(/CBM[a-zA-Z0-9+/=]+/);
            if (match) {
              const base64Part = match[0].substring(3); // Remove 'CBM' prefix
              const decoded = Buffer.from(base64Part, 'base64').toString('utf-8');
              
              // Look for URLs in the decoded content
              const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+/);
              if (urlMatch) {
                finalUrl = urlMatch[0];
                console.log(`🎯 Decoded URL: ${finalUrl}`);
              }
            }
          } catch (decodeError) {
            console.log(`⚠️ Base64 decode failed: ${decodeError.message}`);
          }
        }
        
      } catch (redirectError) {
        console.log(`⚠️ Redirect resolution failed: ${redirectError.message}, using original URL`);
      }
    }

    // Extract article content using @extractus/article-extractor
    console.log(`📄 Extracting content from final URL: ${finalUrl}`);
    
    const articleData = await extract(finalUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!articleData || !articleData.content) {
      console.log(`⚠️ No content extracted from ${finalUrl}`);
      return res.status(400).json({ 
        error: 'Could not extract article content',
        url: finalUrl
      });
    }

    // Clean and validate content
    const cleanContent = articleData.content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    if (cleanContent.length < 100) {
      console.log(`⚠️ Content too short: ${cleanContent.length} characters`);
      return res.status(400).json({ 
        error: 'Article content too short',
        contentLength: cleanContent.length,
        url: finalUrl
      });
    }

    console.log(`✅ Local extraction successful: ${cleanContent.length} characters from ${articleData.title || 'article'}`);
    
    return res.json({
      success: true,
      title: articleData.title || '',
      author: articleData.author || '',
      description: articleData.description || '',
      content: cleanContent.substring(0, 8000), // Limit for performance
      contentLength: cleanContent.length,
      publishedTime: articleData.published || '',
      url: finalUrl,
      originalUrl: url
    });

  } catch (error) {
    console.error(`❌ Local article extraction failed from ${url}:`, error.message);
    
    // Try a fallback extraction method for stubborn URLs
    if (url.includes('google.com')) {
      console.log(`🔄 Trying fallback method for Google News URL...`);
      
      try {
        // Try to fetch the page directly and parse with basic HTML extraction
        const response = await axios.get(url, {
          timeout: 8000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        // Look for redirects in HTML content
        const html = response.data;
        const urlMatch = html.match(/url=([^"&]+)/i) || html.match(/href="([^"]+)"/i);
        
        if (urlMatch && urlMatch[1] && !urlMatch[1].includes('google.com')) {
          const fallbackUrl = decodeURIComponent(urlMatch[1]);
          console.log(`🎯 Found fallback URL: ${fallbackUrl}`);
          
          const { extract } = await import('@extractus/article-extractor');
          const fallbackData = await extract(fallbackUrl);
          if (fallbackData && fallbackData.content && fallbackData.content.length > 100) {
            return res.json({
              success: true,
              title: fallbackData.title || '',
              content: fallbackData.content.substring(0, 8000),
              contentLength: fallbackData.content.length,
              url: fallbackUrl,
              originalUrl: url,
              extractionMethod: 'fallback'
            });
          }
        }
      } catch (fallbackError) {
        console.log(`⚠️ Fallback method also failed: ${fallbackError.message}`);
      }
    }
    
    return res.status(500).json({ 
      error: 'Failed to extract article content',
      details: error.message,
      url: url
    });
  }
});

// Test login endpoint for local development
app.post('/api/test-login', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Test login not available in production' });
  }
  
  try {
    const { linkedin_id, name, email } = req.body;
    
    // Find or create the test user
    const userResult = await pool.query(
      'SELECT * FROM users WHERE linkedin_id = $1',
      [linkedin_id]
    );
    
    let user;
    if (userResult.rows.length === 0) {
      const insertResult = await pool.query(
        'INSERT INTO users (linkedin_id, name, email, access_token) VALUES ($1, $2, $3, $4) RETURNING *',
        [linkedin_id, name, email, 'test-token']
      );
      user = insertResult.rows[0];
    } else {
      user = userResult.rows[0];
    }
    
    // Create JWT token
    const token = generateJWT({
      id: user.id,
      linkedin_id: user.linkedin_id,
      name: user.name,
      email: user.email
    });
    
    // Set cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: false, // false for local development
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });
    
    res.json({
      success: true,
      message: 'Test login successful',
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
    
  } catch (error) {
    console.error('Test login error:', error);
    res.status(500).json({ error: 'Test login failed' });
  }
});

// Enhanced debug endpoint with migration capability
app.get('/debug', async (req, res) => {
  const { migrate } = req.query;
  
  if (migrate === 'status-constraint') {
    // Run the status constraint migration
    try {
      console.log('🔄 Starting status constraint migration via debug endpoint...');
      
      const client = await pool.connect();
      try {
        let migrationSteps = [];
        
        // Check existing constraint
        const constraintQuery = `
          SELECT constraint_name, check_clause 
          FROM information_schema.check_constraints 
          WHERE constraint_name = 'user_subscriptions_status_check'
        `;
        const constraintResult = await client.query(constraintQuery);
        
        if (constraintResult.rows.length > 0) {
          migrationSteps.push(`Found existing constraint: ${constraintResult.rows[0].check_clause}`);
          
          // Drop existing constraint
          await client.query(`
            ALTER TABLE user_subscriptions 
            DROP CONSTRAINT user_subscriptions_status_check
          `);
          migrationSteps.push('Dropped existing constraint');
        } else {
          migrationSteps.push('No existing constraint found');
        }
        
        // Add new constraint
        await client.query(`
          ALTER TABLE user_subscriptions 
          ADD CONSTRAINT user_subscriptions_status_check 
          CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid', 'incomplete'))
        `);
        migrationSteps.push('Added new constraint with incomplete status');
        
        // Verify new constraint
        const newConstraintResult = await client.query(constraintQuery);
        if (newConstraintResult.rows.length > 0) {
          migrationSteps.push(`New constraint verified: ${newConstraintResult.rows[0].check_clause}`);
        }
        
        return res.json({
          success: true,
          message: 'Status constraint migration completed successfully via debug endpoint',
          steps: migrationSteps,
          timestamp: new Date().toISOString()
        });
        
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Migration error via debug endpoint:', error);
      return res.json({
        success: false,
        error: 'Migration failed',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
  
  // Regular debug info
  const debugInfo = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    routes_tested: {
      plans_api: '✅ Working',
      migrate_route: '❌ Not working',
      debug_route: '✅ Working'
    },
    database_status: 'Connected',
    migration_available: 'Use ?migrate=status-constraint',
    server_info: {
      platform: process.platform,
      node_version: process.version,
      memory_usage: process.memoryUsage()
    }
  };
  
  res.json(debugInfo);
});

// Debug routes to diagnose 404 issues
app.get('/test-static', (req, res) => {
  console.log('🔍 Testing static file access...');
  const fs = require('fs');
  const rootIndexPath = path.join(__dirname, 'index.html');
  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  const rootStylesPath = path.join(__dirname, 'styles.css');
  const rootScriptPath = path.join(__dirname, 'script.js');
  
  console.log('📁 __dirname:', __dirname);
  console.log('📁 Checking root index:', rootIndexPath);
  console.log('📁 Checking public index:', publicIndexPath);
  
  try {
    const rootIndexExists = fs.existsSync(rootIndexPath);
    const publicIndexExists = fs.existsSync(publicIndexPath);
    const rootStylesExists = fs.existsSync(rootStylesPath);
    const rootScriptExists = fs.existsSync(rootScriptPath);
    
    console.log('📄 Root index exists:', rootIndexExists);
    console.log('📄 Public index exists:', publicIndexExists);
    console.log('📄 Root styles exists:', rootStylesExists);
    console.log('📄 Root script exists:', rootScriptExists);
    
    // Get file stats for existing files
    const stats = {};
    if (rootIndexExists) {
      stats.rootIndex = fs.statSync(rootIndexPath);
    }
    if (publicIndexExists) {
      stats.publicIndex = fs.statSync(publicIndexPath);
    }
    
    // List directory contents
    const publicDir = path.join(__dirname, 'public');
    const publicDirExists = fs.existsSync(publicDir);
    console.log('📁 Public directory exists:', publicDirExists);
    
    // List root directory contents
    const rootFiles = fs.readdirSync(__dirname);
    console.log('📁 Root directory contents:', rootFiles);
    
    res.json({
      paths: {
        rootIndex: rootIndexPath,
        publicIndex: publicIndexPath,
        rootStyles: rootStylesPath,
        rootScript: rootScriptPath
      },
      filesExist: {
        rootIndex: rootIndexExists,
        publicIndex: publicIndexExists,
        rootStyles: rootStylesExists,
        rootScript: rootScriptExists,
        publicDir: publicDirExists
      },
      publicContents: publicDirExists ? fs.readdirSync(publicDir) : [],
      rootContents: rootFiles,
      stats,
      dirname: __dirname,
      cwd: process.cwd()
    });
  } catch (error) {
    console.error('❌ Error checking files:', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get('/serve-index', (req, res) => {
  console.log('🔍 Attempting to serve index.html directly...');
  const indexPath = path.join(__dirname, 'public', 'index.html');
  
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('❌ Error serving index.html:', err);
      res.status(404).json({ 
        error: 'Could not serve index.html',
        details: err.message,
        path: indexPath
      });
    } else {
      console.log('✅ Successfully served index.html');
    }
  });
});

// Catch-all route for debugging
app.get('/catch-all-debug/*', (req, res) => {
  console.log('🔍 Catch-all route hit:', {
    path: req.path,
    url: req.url,
    method: req.method,
    headers: Object.keys(req.headers)
  });
  
  res.json({
    message: 'This request made it to the Express server',
    path: req.path,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Root route fallback - try multiple locations for index.html
app.get('/', (req, res) => {
  console.log('🏠 Root route hit - checking for static files...');
  
  // Set CSP headers for all pages
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://fonts.googleapis.com https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.tailwindcss.com; " +
    "img-src 'self' data: https: http:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://js.stripe.com https://hooks.stripe.com; " +
    "font-src 'self' https://fonts.gstatic.com;"
  );
  
  // Try root directory first (new approach)
  const rootIndexPath = path.join(__dirname, 'index.html');
  // Then try public directory (original approach)
  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  
  if (fs.existsSync(rootIndexPath)) {
    console.log('✅ Serving index.html from root directory');
    res.sendFile(rootIndexPath);
  } else if (fs.existsSync(publicIndexPath)) {
    console.log('✅ Serving index.html from public directory');
    res.sendFile(publicIndexPath);
  } else {
    console.log('⚠️ index.html not found in root or public, serving inline fallback');
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LinkedIn Post Generator - AI-Powered Content Creation</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .card { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 20px rgba(0,0,0,0.1); margin-bottom: 20px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-weight: 600; }
        input, select, button { width: 100%; padding: 12px; border: 2px solid #e1e5e9; border-radius: 8px; font-size: 16px; }
        button { background: #0077B5; color: white; border: none; cursor: pointer; font-weight: 600; }
        button:hover { background: #005885; }
        .error { color: red; margin-top: 10px; }
        .result { margin-top: 20px; padding: 20px; background: #f8f9fa; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚧 LinkedIn Post Generator</h1>
        <p>Static files not deployed properly. Using fallback version.</p>
        <p><strong>Debug Info:</strong></p>
        <ul style="text-align: left; display: inline-block;">
            <li><a href="/debug">Environment Variables</a></li>
            <li><a href="/api/health">API Health Check</a></li>
            <li><a href="/test-static">File System Debug</a></li>
        </ul>
    </div>
    
    <div class="card">
        <h2>Generate LinkedIn Post</h2>
        <form id="postForm">
            <div class="form-group">
                <label for="topic">Topic:</label>
                <input type="text" id="topic" placeholder="e.g., Artificial Intelligence, Leadership, etc." required>
            </div>
            <div class="form-group">
                <label for="tone">Tone:</label>
                <select id="tone" required>
                    <option value="professional">Professional</option>
                    <option value="thought-leadership">Thought Leadership</option>
                    <option value="conversational">Conversational</option>
                    <option value="analytical">Analytical</option>
                    <option value="motivational">Motivational</option>
                </select>
            </div>
            <button type="submit">Generate Post</button>
        </form>
        <div id="result" class="result" style="display: none;"></div>
        <div id="error" class="error" style="display: none;"></div>
    </div>

    <script>
        document.getElementById('postForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const topic = document.getElementById('topic').value;
            const tone = document.getElementById('tone').value;
            const resultDiv = document.getElementById('result');
            const errorDiv = document.getElementById('error');
            
            resultDiv.style.display = 'none';
            errorDiv.style.display = 'none';
            
            try {
                const response = await fetch('/api/generate-post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic, tone })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    resultDiv.innerHTML = \`
                        <h3>Generated Post:</h3>
                        <p style="white-space: pre-wrap; background: white; padding: 15px; border-radius: 8px;">\${data.post}</p>
                        <h4>Source Article:</h4>
                        <p><a href="\${data.article.url}" target="_blank">\${data.article.title}</a></p>
                        \${data.image ? \`<p>Image: <a href="\${data.image.url}" target="_blank">View Image</a></p>\` : ''}
                    \`;
                    resultDiv.style.display = 'block';
                } else {
                    throw new Error(data.error || 'Unknown error');
                }
            } catch (error) {
                errorDiv.textContent = 'Error: ' + error.message;
                errorDiv.style.display = 'block';
            }
        });
    </script>
</body>
</html>
    `);
  }
});

// Content Generator page route
app.get('/generator', (req, res) => {
  console.log('🎨 Content Generator route hit');
  
  // Set CSP headers for content generator
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://fonts.googleapis.com https://cdn.tailwindcss.com; " +
    "script-src-attr 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.tailwindcss.com; " +
    "img-src 'self' data: https: http:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://js.stripe.com; " +
    "font-src 'self' https://fonts.gstatic.com;"
  );
  
  const generatorPath = path.join(__dirname, 'generator.html');
  
  if (fs.existsSync(generatorPath)) {
    console.log('✅ Serving generator.html');
    res.sendFile(generatorPath);
  } else {
    console.log('⚠️ generator.html not found');
    res.status(404).send('Content Generator page not found');
  }
});

// Automation page route
app.get('/automation', (req, res) => {
  console.log('🤖 Automation route hit');
  
  // Set CSP headers for automation page
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://fonts.googleapis.com https://cdn.tailwindcss.com; " +
    "script-src-attr 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.tailwindcss.com; " +
    "img-src 'self' data: https: http:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://js.stripe.com; " +
    "font-src 'self' https://fonts.gstatic.com;"
  );
  
  const automationPath = path.join(__dirname, 'automation.html');
  
  if (fs.existsSync(automationPath)) {
    console.log('✅ Serving automation.html');
    res.sendFile(automationPath);
  } else {
    console.log('⚠️ automation.html not found');
    res.status(404).send('Automation page not found');
  }
});

// Subscribe page route
app.get('/subscribe', (req, res) => {
  console.log('💳 Subscribe route hit');
  
  // Set CSP headers to allow Stripe
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.tailwindcss.com; " +
    "img-src 'self' data: https: http:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://js.stripe.com https://hooks.stripe.com; " +
    "font-src 'self' https://fonts.gstatic.com;"
  );
  
  const subscribePath = path.join(__dirname, 'subscribe.html');
  
  if (fs.existsSync(subscribePath)) {
    console.log('✅ Serving subscribe.html with dynamic Stripe key');
    
    // Read the HTML file and inject the correct Stripe publishable key
    const html = fs.readFileSync(subscribePath, 'utf8');
    
    // Replace the placeholder with the actual Stripe publishable key
    const updatedHtml = html.replace(
      'STRIPE_PUBLISHABLE_KEY_PLACEHOLDER',
      process.env.STRIPE_PUBLISHABLE_KEY
    );
    
    res.send(updatedHtml);
  } else {
    console.log('⚠️ subscribe.html not found');
    res.status(404).send('Subscribe page not found');
  }
});

// Pricing page route
app.get('/pricing', (req, res) => {
  console.log('💰 Pricing route hit');
  
  // Set CSP headers to allow Stripe
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.tailwindcss.com; " +
    "img-src 'self' data: https: http:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://js.stripe.com https://hooks.stripe.com; " +
    "font-src 'self' https://fonts.gstatic.com;"
  );
  
  const pricingPath = path.join(__dirname, 'pricing.html');
  
  if (fs.existsSync(pricingPath)) {
    console.log('✅ Serving pricing.html with dynamic Stripe key');
    
    // Read the HTML file and inject the correct Stripe publishable key
    const html = fs.readFileSync(pricingPath, 'utf8');
    
    // Replace the placeholder with the actual Stripe publishable key
    const updatedHtml = html.replace(
      'STRIPE_PUBLISHABLE_KEY_PLACEHOLDER',
      process.env.STRIPE_PUBLISHABLE_KEY
    );
    
    res.send(updatedHtml);
  } else {
    console.log('⚠️ pricing.html not found');
    res.status(404).send('Pricing page not found');
  }
});

// Credits purchase page route
app.get('/credits', (req, res) => {
  console.log('💳 Credits route hit');
  
  // Set CSP headers to allow Stripe
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.gstatic.com https://cdn.tailwindcss.com; " +
    "img-src 'self' data: https: http:; " +
    "connect-src 'self' https://api.stripe.com; " +
    "frame-src https://js.stripe.com https://hooks.stripe.com; " +
    "font-src 'self' https://fonts.gstatic.com;"
  );
  
  const creditsPath = path.join(__dirname, 'credits.html');
  
  if (fs.existsSync(creditsPath)) {
    console.log('✅ Serving credits.html');
    res.sendFile(creditsPath);
  } else {
    console.log('⚠️ credits.html not found');
    res.status(404).send('Credits page not found');
  }
});

// Admin page route - password protected
app.get('/admin', (req, res) => {
  console.log('👑 Admin route hit');
  
  // Simple password protection - check for admin password in query parameter
  const adminPassword = req.query.key;
  const expectedPassword = process.env.ADMIN_PASSWORD || 'Employment-admin-2024';
  
  if (!adminPassword || adminPassword !== expectedPassword) {
    console.log('🚫 Unauthorized admin access attempt');
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Access Denied</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 50px; }
          .container { max-width: 400px; margin: 0 auto; }
          h1 { color: #e74c3c; }
          p { color: #666; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔒 Access Denied</h1>
          <p>This page requires administrator access.</p>
          <p>Please contact the site administrator for access.</p>
        </div>
      </body>
      </html>
    `);
  }
  
  const adminPath = path.join(__dirname, 'admin.html');
  
  if (fs.existsSync(adminPath)) {
    console.log('✅ Serving admin.html to authorized user');
    res.sendFile(adminPath);
  } else {
    console.log('⚠️ admin.html not found');
    res.status(404).send('Admin page not found');
  }
});

// Subscription success page route
app.get('/subscription/success', (req, res) => {
  console.log('🎉 Subscription success route hit');
  
  const successPath = path.join(__dirname, 'subscription', 'success.html');
  
  if (fs.existsSync(successPath)) {
    console.log('✅ Serving subscription success.html');
    res.sendFile(successPath);
  } else {
    console.log('⚠️ subscription/success.html not found');
    res.status(404).send('Subscription success page not found');
  }
});

// Dashboard route - serves main page
app.get('/dashboard', (req, res) => {
  console.log('📊 Dashboard route hit - serving main page');
  
  // Try root directory first
  const rootIndexPath = path.join(__dirname, 'index.html');
  // Then try public directory
  const publicIndexPath = path.join(__dirname, 'public', 'index.html');
  
  if (fs.existsSync(rootIndexPath)) {
    console.log('✅ Serving index.html from root directory for dashboard');
    res.sendFile(rootIndexPath);
  } else if (fs.existsSync(publicIndexPath)) {
    console.log('✅ Serving index.html from public directory for dashboard');
    res.sendFile(publicIndexPath);
  } else {
    console.log('⚠️ index.html not found for dashboard route');
    res.status(404).send('Dashboard page not found');
  }
});

// Manage subscription route
app.get('/manage-subscription', (req, res) => {
  console.log('💳 Manage subscription route hit');
  
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
    "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
    "font-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self'"
  );
  
  const manageSubPath = path.join(__dirname, 'manage-subscription.html');
  
  if (fs.existsSync(manageSubPath)) {
    console.log('✅ Serving manage-subscription.html');
    res.sendFile(manageSubPath);
  } else {
    console.log('⚠️ manage-subscription.html not found');
    res.status(404).send('Manage subscription page not found');
  }
});

// ====================
// EXISTING GENERATE POST ROUTE (Updated)
// ====================

// Generate research-based post endpoint (BYOB)
app.post('/api/generate-research-post', requireAuth, rateLimitMiddleware, async (req, res) => {
  try {
    const { topic, tone = 'professional', length = 'medium', engagement_options = {}, required_keywords = '' } = req.body;
    
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }

    console.log('🔬 ===== BYOB Research Generation Started =====');
    console.log(`👤 User: ${req.user.name} (${req.user.email})`);
    console.log(`📝 Topic: "${topic}"`);
    console.log(`🔑 Required keywords: "${required_keywords}"`);
    console.log(`🎯 Tone: ${tone}, Length: ${length}`);
    console.log(`⚙️ Engagement options:`, engagement_options);

    // Check user's credit balance
    const creditCheck = await CreditDB.hasCredits(req.user.id, 1);
    if (!creditCheck.hasEnough) {
      console.log('❌ User has insufficient credits:', creditCheck.currentCredits);
      return res.status(403).json({ 
        error: 'Insufficient credits for research post generation.',
        creditsRemaining: creditCheck.currentCredits,
        needsCredits: true
      });
    }

    // Perform comprehensive web research
    console.log('🔍 Starting comprehensive web research...');
    const researchData = await performWebResearch(topic, 5, required_keywords);
    
    if (!researchData || researchData.length === 0) {
      console.log('⚠️ No research data found, falling back to general post');
      return res.status(400).json({ 
        error: 'Unable to find sufficient research data for this topic. Try using the regular generator.' 
      });
    }

    // Generate RAG post from research
    console.log(`📊 Generating research-based post from ${researchData.length} sources`);
    const result = await generateRAGPost(researchData, topic, tone, length, engagement_options);
    
    // Fetch relevant image
    const image = engagement_options.include_image !== false ? await fetchRelevantImage(topic) : null;
    
    // Deduct 1 credit for research post generation
    const newCreditBalance = await CreditDB.deductCredits(req.user.id, 1, 'Research post generation');
    
    // Track usage (same way as regular generate post endpoint)
    const estimatedCost = 0.00136; // $0.00136 per post as calculated
    const estimatedTokens = 1200; // ~800 input + 400 output tokens
    
    await UsageDB.trackUsage(req.user.id, 'post_generation', estimatedCost, estimatedTokens, {
      topic,
      tone,
      length,
      post_type: 'research_based',
      research_sources_count: researchData.length,
      credits_deducted: 1,
      new_credit_balance: newCreditBalance,
      timestamp: new Date().toISOString()
    });
    
    console.log('✅ BYOB research post generated successfully');
    console.log(`📊 Sources used: ${researchData.length}`);
    console.log(`📄 Post length: ${result.post.length} characters`);
    console.log(`💰 Deducted 1 credit from user ${req.user.id}: $${estimatedCost} (research_based). New balance: ${newCreditBalance}`);

    res.json({
      success: true,
      data: {
        post: result.post,
        image: image,
        post_type: 'research_based',
        topic: topic,
        research_sources: researchData,
        article: {
          title: `Research: ${topic}`,
          url: researchData[0]?.url || '',
          source: `${researchData.length} Web Sources`,
          publishedAt: new Date().toISOString()
        }
      },
      research_stats: {
        sources_found: researchData.length,
        total_characters_analyzed: researchData.reduce((sum, item) => sum + (item.summary?.length || 0), 0)
      }
    });

  } catch (error) {
    console.error('❌ Error in /api/generate-research-post:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error name:', error.name);
    console.error('❌ Request body:', req.body);
    
    // Check for specific error types
    if (error.message.includes('cheerio')) {
      console.error('❌ Cheerio-related error detected');
    }
    if (error.message.includes('Google')) {
      console.error('❌ Google API-related error detected');
    }
    if (error.message.includes('OpenAI')) {
      console.error('❌ OpenAI API-related error detected');
    }
    
    res.status(500).json({ 
      error: 'Failed to generate research-based post', 
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      errorType: error.name
    });
  }
});

app.post('/api/generate-post', rateLimitMiddleware, async (req, res) => {
  try {
    const { 
      topic, 
      tone, 
      length = 'medium',
      post_type = 'news', // 'news' | 'viral' | 'tweet' | 'manual'
      viral_format = null,
      engagement_options = {},
      custom_content = null,
      tweet_text = null
    } = req.body;
    
    if (!topic && !custom_content && !tweet_text) {
      return res.status(400).json({ 
        error: 'Topic, custom content, or tweet text is required' 
      });
    }

    // Check user authentication and usage limits
    const token = extractJWTFromRequest(req);
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        needsAuth: true
      });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({
        error: 'Invalid authentication token',
        needsAuth: true
      });
    }

    const userId = decoded.id;
    
    // Check credit balance for authenticated users
    const creditCheck = await CreditDB.hasCredits(userId, 1); // 1 credit per generation
    if (!creditCheck.hasEnough) {
      return res.status(403).json({
        error: 'Insufficient credits',
        reason: `You need 1 credit to generate content. Current balance: ${creditCheck.currentCredits}`,
        creditsRemaining: creditCheck.currentCredits,
        needsCredits: true
      });
    }

    // Calculate cost before generation
    const estimatedCost = 0.00136; // $0.00136 per post as calculated
    const estimatedTokens = 1200; // ~800 input + 400 output tokens

    let result;

    // Map frontend viral format names to internal IDs
    const viralFormatMapping = {
      'open-loop': 'open_loop',
      'contrarian': 'hot_take',
      'confession': 'confession_story',
      'framework': 'framework_list',
      'experience': 'pattern_interrupt',
      'data-driven': 'before_after'
    };

    // Route to appropriate generation method based on post_type
    switch (post_type) {
      case 'viral':
        const mappedFormatId = viralFormatMapping[viral_format] || viral_format;
        result = await generateViralPost(topic, tone, length, mappedFormatId, engagement_options, userId);
        break;
      case 'tweet':
        result = await repurposeTweet(tweet_text || topic, topic, tone, length);
        break;
      case 'manual':
        result = await generateManualPost(custom_content || topic, tone, length, engagement_options, userId);
        break;
      case 'news':
      default:
        result = await generatePost(topic, tone, length, engagement_options);
        break;
    }

    // Deduct 1 credit for the generation
    const newCreditBalance = await CreditDB.deductCredits(userId, 1, 'Content generation');
    
    // Track usage for the authenticated user
    await UsageDB.trackUsage(userId, 'post_generation', estimatedCost, estimatedTokens, {
      topic,
      tone,
      length,
      post_type,
      viral_format,
      article_source: result.article?.source,
      credits_deducted: 1,
      new_credit_balance: newCreditBalance,
      timestamp: new Date().toISOString()
    });
    
    console.log(`💰 Deducted 1 credit from user ${userId}: $${estimatedCost} (${post_type}). New balance: ${newCreditBalance}`);

    // Add credit info to response
    result.credits = {
      used: 1,
      remaining: newCreditBalance
    };

    res.json(result);
  } catch (error) {
    console.error('❌ Error generating post:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Request body:', req.body);
    res.status(500).json({ 
      error: 'Failed to generate post. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// ====================
// POST GENERATION FUNCTION (Unchanged from previous version)
// ====================

async function generatePost(topic, tone, length = 'medium', engagementOptions = {}) {
  try {
    let selectedArticle = null;
    let post;
    let articleData = null;
    let researchData = null;

    // Step 1: Try to fetch news articles first
    try {
      const articles = await fetchNewsArticles(topic);
      if (articles && articles.length > 0) {
        selectedArticle = selectBestArticle(articles);
      }
    } catch (newsError) {
      console.warn('⚠️ No articles found from any news source:', newsError.message);
    }

    if (selectedArticle) {
      // Step 2a: Generate LinkedIn post with news article
      console.log('📰 Generating content based on article:', selectedArticle.title);
      post = await generateLinkedInPost(selectedArticle, topic, tone, length, engagementOptions);
      
      articleData = {
        title: selectedArticle.title,
        url: cleanUrl(selectedArticle.url) || selectedArticle.url,
        source: selectedArticle.source?.name || 'News Source',
        publishedAt: selectedArticle.publishedAt
      };
    } else {
      // Step 2b: Try BYOB web research for comprehensive content
      try {
        console.log('🔍 Attempting BYOB web research...');
        researchData = await performWebResearch(topic, 5);
        
        if (researchData && researchData.length > 0) {
          console.log(`📊 Generating research-based content from ${researchData.length} sources`);
          const ragResult = await generateRAGPost(researchData, topic, tone, length, engagementOptions);
          post = ragResult.post;
          
          // Use research data for article info
          articleData = {
            title: `Research: ${topic}`,
            url: researchData[0]?.url || '',
            source: `${researchData.length} Web Sources`,
            publishedAt: new Date().toISOString(),
            research_sources: researchData
          };
        }
      } catch (researchError) {
        console.warn('⚠️ BYOB web research failed:', researchError.message);
      }
    }

    if (!post) {
      // Step 3: Fallback to general topic-based content
      console.log('💡 Generating general content for topic:', topic);
      post = await generateGeneralPost(topic, tone, length, engagementOptions);
    }
    
    // Step 4: Fetch relevant image (only if requested)
    const image = engagementOptions.include_image !== false ? await fetchRelevantImage(topic) : null;
    
    // Determine post type
    let postType = 'general';
    if (selectedArticle) postType = 'news';
    else if (researchData && researchData.length > 0) postType = 'research_based';
    
    return {
      post: post,
      article: articleData,
      image: image,
      post_type: postType,
      topic: topic,
      research_sources: researchData || undefined
    };
  } catch (error) {
    console.error('❌ Error in generatePost:', error);
    throw error;
  }
}

// Generate viral format posts without news dependency
async function generateViralPost(topic, tone, length, viralFormatId, engagementOptions, userId = null) {
  try {
    console.log(`🔥 Generating viral post: ${viralFormatId} for topic: ${topic}`);
    
    // Get viral format template
    let viralFormat;
    if (viralFormatId) {
      viralFormat = viralTemplates.viralFormats.find(f => f.id === viralFormatId);
    } else {
      viralFormat = viralTemplates.getRandomViralFormat();
    }
    
    if (!viralFormat) {
      throw new Error('Viral format not found');
    }

    // Build enhanced prompt with engagement options
    let prompt = viralFormat.prompt.replace(/\[topic\]/g, topic);
    
    // Add user context if available
    if (userId) {
      try {
        const userContext = await UserDB.getContext(userId);
        if (userContext && (userContext.personalBackground || userContext.recentActivities || userContext.expertiseInterests)) {
          console.log('👤 Adding user context to viral post generation');
          prompt += `\n\nPersonal Context to incorporate naturally into the post:`;
          
          if (userContext.personalBackground) {
            prompt += `\nBackground: ${userContext.personalBackground}`;
          }
          
          if (userContext.recentActivities) {
            prompt += `\nRecent activities/achievements: ${userContext.recentActivities}`;
          }
          
          if (userContext.expertiseInterests) {
            prompt += `\nExpertise/interests: ${userContext.expertiseInterests}`;
          }
          
          prompt += `\n\nUse this context to make the post more personal and authentic. Draw from these experiences and background to add credibility and relatability to your perspective on ${topic}.`;
        }
      } catch (contextError) {
        console.warn('⚠️ Could not load user context:', contextError.message);
      }
    }
    
    // Add engagement hooks if requested
    if (engagementOptions.curiosity_hook) {
      const hook = viralTemplates.getEngagementHook('curiosity');
      prompt += ` Start with this curiosity hook: "${hook}"`;
    }
    
    if (engagementOptions.strong_opinion) {
      const hook = viralTemplates.getEngagementHook('controversy');
      prompt += ` Include this contrarian element: "${hook}"`;
    }
    
    if (engagementOptions.soft_cta) {
      const cta = viralTemplates.getRandomCTA();
      prompt += ` End with this engagement question: "${cta}"`;
    }

    // Add length specification
    const lengthGuide = {
      short: '50-100 words, punchy and direct',
      medium: '100-200 words, detailed but concise',
      long: '200-300 words, comprehensive with examples'
    };
    
    prompt += ` Length: ${lengthGuide[length] || lengthGuide.medium}.`;
    prompt += ` Tone: ${tone}. Format for LinkedIn with appropriate line breaks.`;

    // Generate the post
    let post = await callOpenAI(prompt, 'viral_content');
    
    // Clean markdown formatting (bold and italic)
    post = post.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove **bold**
    post = post.replace(/\*(.*?)\*/g, '$1'); // Remove *italic*
    post = post.replace(/__(.*?)__/g, '$1'); // Remove __bold__
    post = post.replace(/_(.*?)_/g, '$1'); // Remove _italic_
    
    // Fetch relevant image if requested
    const image = engagementOptions.include_image !== false ? await fetchRelevantImage(topic) : null;
    
    return {
      post: post,
      viral_format: viralFormat,
      engagement_options: engagementOptions,
      image: image,
      post_type: 'viral_format'
    };
  } catch (error) {
    console.error('❌ Error in generateViralPost:', error);
    throw error;
  }
}

// Repurpose tweet into LinkedIn format
async function repurposeTweet(tweetText, topic, tone, length) {
  try {
    console.log(`🔄 Repurposing tweet for topic: ${topic}`);
    
    // If no tweet text provided, get from viral tweet bank
    if (!tweetText || tweetText === topic) {
      const viralTweet = viralTemplates.getViralTweet(topic);
      if (viralTweet) {
        tweetText = viralTweet.text;
        console.log(`📱 Using cached viral tweet: ${tweetText.substring(0, 50)}...`);
      } else {
        throw new Error(`No viral tweets available for topic: ${topic}`);
      }
    }

    // Clean tweet text (remove @mentions, hashtags for processing)
    const cleanTweetText = tweetText.replace(/@\w+/g, '').replace(/#\w+/g, '').trim();

    const lengthGuide = {
      short: '100-150 words',
      medium: '150-250 words', 
      long: '250-350 words'
    };

    const prompt = `Transform this viral tweet into a LinkedIn post:

Original Tweet: "${cleanTweetText}"

Instructions:
- Expand the core insight with professional context and personal experience
- Adapt from casual Twitter tone to professional but approachable LinkedIn tone  
- Add more background context since LinkedIn audience expects more depth
- Use proper LinkedIn formatting with line breaks
- Length: ${lengthGuide[length] || lengthGuide.medium}
- Tone: ${tone}
- End with a LinkedIn-appropriate call to action that encourages engagement
- Don't use hashtags - LinkedIn algorithm doesn't favor them
- Keep the viral element that made the original tweet engaging

Format the response as just the LinkedIn post text, nothing else.`;

    let post = await callOpenAI(prompt, 'tweet_repurpose');
    
    // Clean markdown formatting (bold and italic)
    post = post.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove **bold**
    post = post.replace(/\*(.*?)\*/g, '$1'); // Remove *italic*
    post = post.replace(/__(.*?)__/g, '$1'); // Remove __bold__
    post = post.replace(/_(.*?)_/g, '$1'); // Remove _italic_
    
    // Fetch relevant image
    const image = await fetchRelevantImage(topic);
    
    return {
      post: post,
      original_tweet: tweetText,
      adaptation_rules: viralTemplates.tweetAdaptationRules,
      image: image,
      post_type: 'repurposed_tweet'
    };
  } catch (error) {
    console.error('❌ Error in repurposeTweet:', error);
    throw error;
  }
}

// Generate manual post from custom content
async function generateManualPost(customContent, tone, length, engagementOptions, userId = null) {
  try {
    console.log(`✍️ Generating manual post from custom content`);
    
    const lengthGuide = {
      short: '50-100 words, concise and impactful',
      medium: '100-200 words, balanced detail',
      long: '200-300 words, comprehensive coverage'
    };

    let prompt = `Create a LinkedIn post based on this content or idea:

"${customContent}"

Requirements:
- Length: ${lengthGuide[length] || lengthGuide.medium}
- Tone: ${tone}
- Make it engaging and professional for LinkedIn audience
- Use proper formatting with line breaks
- Focus on providing value to the reader`;

    // Add user context if available
    if (userId) {
      try {
        const userContext = await UserDB.getContext(userId);
        if (userContext && (userContext.personalBackground || userContext.recentActivities || userContext.expertiseInterests)) {
          console.log('👤 Adding user context to manual post generation');
          prompt += `\n\nPersonal Context to naturally weave into the post:`;
          
          if (userContext.personalBackground) {
            prompt += `\nBackground: ${userContext.personalBackground}`;
          }
          
          if (userContext.recentActivities) {
            prompt += `\nRecent activities/achievements: ${userContext.recentActivities}`;
          }
          
          if (userContext.expertiseInterests) {
            prompt += `\nExpertise/interests: ${userContext.expertiseInterests}`;
          }
          
          prompt += `\n\nIncorporate this personal context authentically to add credibility and make the post more relatable.`;
        }
      } catch (contextError) {
        console.warn('⚠️ Could not load user context:', contextError.message);
      }
    }

    // Add engagement enhancements
    if (engagementOptions.curiosity_hook) {
      const hook = viralTemplates.getEngagementHook('curiosity');
      prompt += `\n- Start with an engaging hook like: "${hook}"`;
    }
    
    if (engagementOptions.strong_opinion) {
      prompt += `\n- Include a strong opinion or contrarian viewpoint`;
    }
    
    if (engagementOptions.soft_cta) {
      const cta = viralTemplates.getRandomCTA();
      prompt += `\n- End with this engagement question: "${cta}"`;
    }

    prompt += `\n\nFormat the response as just the LinkedIn post text, nothing else.`;

    let post = await callOpenAI(prompt, 'manual_content');
    
    // Clean markdown formatting (bold and italic)
    post = post.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove **bold**
    post = post.replace(/\*(.*?)\*/g, '$1'); // Remove *italic*
    post = post.replace(/__(.*?)__/g, '$1'); // Remove __bold__
    post = post.replace(/_(.*?)_/g, '$1'); // Remove _italic_
    
    // Fetch relevant image if requested
    const image = engagementOptions.include_image !== false ? await fetchRelevantImage(customContent) : null;
    
    return {
      post: post,
      custom_content: customContent,
      engagement_options: engagementOptions,
      image: image,
      post_type: 'manual'
    };
  } catch (error) {
    console.error('❌ Error in generateManualPost:', error);
    throw error;
  }
}

async function fetchNewsArticles(topic) {
  const newsAPIs = [
    {
      name: 'NewsAPI',
      url: 'https://newsapi.org/v2/everything',
      key: process.env.NEWS_API_KEY,
      params: {
        q: topic,
        sortBy: 'publishedAt',
        language: 'en',
        pageSize: 20,
        from: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    },
         {
       name: 'TheNewsAPI',
       url: 'https://api.thenewsapi.com/v1/news/all',
       key: process.env.THENEWSAPI_KEY,
      params: {
        search: topic,
        language: 'en',
        limit: 20,
        published_after: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
      }
    }
  ];

  for (const api of newsAPIs) {
    if (!api.key) continue;
    
    try {
      console.log(`📰 Fetching news from ${api.name}...`);
      
      const config = {
        method: 'get',
        url: api.url,
        params: api.params,
        headers: api.name === 'NewsAPI' ? 
          { 'X-API-Key': api.key } : 
          { 'Authorization': `Bearer ${api.key}` }
      };

      const response = await axios(config);
      let articles = [];

      if (api.name === 'NewsAPI' && response.data.articles) {
        articles = response.data.articles;
      } else if (api.name === 'TheNewsAPI' && response.data.data) {
        articles = response.data.data.map(article => ({
          title: article.title,
          description: article.snippet,
          url: article.url,
          source: { name: article.source },
          publishedAt: article.published_at,
          content: article.snippet
        }));
      }

      if (articles && articles.length > 0) {
        console.log(`✅ Found ${articles.length} articles from ${api.name}`);
        return articles;
      }
    } catch (error) {
      console.warn(`⚠️ ${api.name} failed:`, error.response?.data?.message || error.message);
      continue;
    }
  }

  // If all APIs fail, try Google News as fallback
  try {
    console.log('📰 Trying Google News as fallback...');
    return await fetchGoogleNews(topic);
  } catch (googleError) {
    console.warn('⚠️ Google News also failed:', googleError.message);
    // Return empty array to trigger general content generation
    throw new Error('No articles found from any source');
  }
}

async function fetchGoogleNews(topic) {
  try {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    
    console.log(`🔧 Google API Key available: ${!!googleApiKey}`);
    console.log(`🔧 Search Engine ID available: ${!!searchEngineId}`);
    
    if (!googleApiKey || !searchEngineId) {
      console.warn('⚠️ Google API credentials not configured');
      throw new Error('Google News search not available - missing credentials');
    }

    console.log(`🔍 Searching Google News for: ${topic}`);
    
    // Try regular Google search first (without searchType: 'news')
    const searchParams = {
      key: googleApiKey,
      cx: searchEngineId,
      q: `${topic} news`,
      sort: 'date',
      num: 10,
      dateRestrict: 'd7' // Last 7 days
    };
    
    console.log(`🔧 Search params:`, { ...searchParams, key: 'HIDDEN' });
    
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: searchParams
    });

    console.log(`🔧 Google API response status: ${response.status}`);
    console.log(`🔧 Items found: ${response.data.items?.length || 0}`);

    if (!response.data.items || response.data.items.length === 0) {
      // Try broader search without date restriction
      console.log('🔍 Trying broader Google search...');
      const broadResponse = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: googleApiKey,
          cx: searchEngineId,
          q: `${topic} news`,
          sort: 'date',
          num: 10
        }
      });

      console.log(`🔧 Broad search items found: ${broadResponse.data.items?.length || 0}`);

      if (!broadResponse.data.items || broadResponse.data.items.length === 0) {
        throw new Error('No Google search results found');
      }

      response.data.items = broadResponse.data.items;
    }

    // Convert Google results to our article format
    const articles = response.data.items.map(item => ({
      title: item.title,
      description: item.snippet,
      url: item.link,
      source: { 
        name: item.displayLink || 'Google Search'
      },
      publishedAt: item.pagemap?.metatags?.[0]?.['article:published_time'] || new Date().toISOString(),
      content: item.snippet
    }));

    console.log(`✅ Found ${articles.length} articles from Google Search`);
    console.log(`🔧 First article: ${articles[0]?.title}`);
    return articles;

  } catch (error) {
    console.error('❌ Google News search failed:', error.message);
    console.error('❌ Error details:', error.response?.data || error);
    throw error;
  }
}

function selectBestArticle(articles) {
  if (!articles || articles.length === 0) return null;

  // Filter for quality articles
  const goodArticles = articles.filter(article => {
    const snippet = article.description || article.content || '';
    return snippet.length > 50 && 
           article.title && 
           article.url &&
           !article.title.toLowerCase().includes('[removed]');
  });

  if (goodArticles.length === 0) return articles[0];

  // Sort by recency
  const sortedArticles = goodArticles.sort((a, b) => 
    new Date(b.publishedAt) - new Date(a.publishedAt)
  );

  // Select randomly from top 3-5 most recent articles
  const topArticles = sortedArticles.slice(0, Math.min(5, sortedArticles.length));
  const randomIndex = Math.floor(Math.random() * topArticles.length);
  
  return topArticles[randomIndex];
}

// Universal OpenAI helper function
async function callOpenAI(prompt, contentType = 'linkedin_post') {
  try {
    const systemPrompts = {
      linkedin_post: 'You are a LinkedIn content creator who writes engaging posts that spark conversation and provide value to a professional audience.',
      viral_content: 'You are a viral content expert who creates LinkedIn posts using psychological hooks and engagement strategies that drive maximum interaction.',
      tweet_repurpose: 'You are a social media strategist who expertly adapts viral Twitter content for LinkedIn\'s professional audience while maintaining engagement.',
      manual_content: 'You are a professional content creator who transforms ideas and raw content into polished, engaging LinkedIn posts.',
      research_helper: 'You are a research assistant who generates optimized search terms for comprehensive web research.',
      research_summarizer: 'You are an expert content analyst who summarizes web content for professional social media use.',
      research_post: 'You are a LinkedIn thought leader who creates insightful posts based on comprehensive research from multiple sources.'
    };

    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompts[contentType] || systemPrompts.linkedin_post
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 350,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('❌ OpenAI API error:', error.response?.data || error.message);
    throw new Error('Failed to generate content');
  }
}

// Generate general topic-based content when no news articles are available
async function generateGeneralPost(topic, tone, length = 'medium', engagementOptions = {}) {
  const lengthGuide = {
    short: '100-150 words',
    medium: '150-220 words',
    long: '220-300 words'
  };

  let prompt = `Create an engaging LinkedIn post about "${topic}".

Requirements:
- Topic focus: ${topic}
- Tone: ${tone}
- Length: ${lengthGuide[length] || lengthGuide.medium}
- Provide valuable insights, trends, or professional commentary about this topic
- Include practical advice or actionable takeaways
- Use maximum 1-2 emojis (not 3-5)
- Write for a professional LinkedIn audience
- Make it conversational and engaging
- Base content on general industry knowledge and best practices`;

  // Add engagement enhancements
  if (engagementOptions.curiosity_hook) {
    const hook = viralTemplates.getEngagementHook('curiosity');
    prompt += `\n- Start with an engaging hook like: "${hook}"`;
  }
  
  if (engagementOptions.strong_opinion) {
    prompt += `\n- Include a strong opinion or perspective on this topic`;
  }
  
  if (engagementOptions.soft_cta) {
    const cta = viralTemplates.getRandomCTA();
    prompt += `\n- End with this engagement question: "${cta}"`;
  }

  prompt += `\n\nFormat the response as just the LinkedIn post text, nothing else.`;

  try {
    let post = await callOpenAI(prompt, 'linkedin_post');
    
    // Clean markdown formatting
    post = post.replace(/\*\*(.*?)\*\*/g, '$1');
    post = post.replace(/\*(.*?)\*/g, '$1');
    post = post.replace(/__(.*?)__/g, '$1');
    post = post.replace(/_(.*?)_/g, '$1');

    return post;
  } catch (error) {
    console.error('❌ Error generating general post:', error);
    throw error;
  }
}

async function generateLinkedInPost(article, topic, tone, length = 'medium', engagementOptions = {}) {
  const lengthGuide = {
    short: '100-150 words',
    medium: '150-220 words',
    long: '220-300 words'
  };

  let prompt = `Create a LinkedIn post about this recent news article:

Title: ${article.title}
Content: ${article.description || article.content || 'No description available'}
URL: ${article.url}

Requirements:
- Topic focus: ${topic}
- Tone: ${tone}
- Length: ${lengthGuide[length] || lengthGuide.medium}
- Include personal insight or commentary about the topic
- Reference specific details from the article
- Add the article URL at the end with "Read more:"
- Use maximum 1-2 emojis (not 3-5)
- Write for a general LinkedIn audience, not just business professionals
- Make it conversational and engaging
- Focus on the implications or lessons from this news`;

  // Add engagement enhancements
  if (engagementOptions.curiosity_hook) {
    const hook = viralTemplates.getEngagementHook('curiosity');
    prompt += `\n- Start with an engaging hook like: "${hook}"`;
  }
  
  if (engagementOptions.strong_opinion) {
    prompt += `\n- Include a strong opinion or perspective on this news`;
  }
  
  if (engagementOptions.soft_cta) {
    const cta = viralTemplates.getRandomCTA();
    prompt += `\n- End with this engagement question: "${cta}"`;
  }

  prompt += `\n\nFormat the response as just the LinkedIn post text, nothing else.`;

  try {
    let post = await callOpenAI(prompt, 'linkedin_post');
    
    // Clean markdown formatting (bold and italic)
    post = post.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove **bold**
    post = post.replace(/\*(.*?)\*/g, '$1'); // Remove *italic*
    post = post.replace(/__(.*?)__/g, '$1'); // Remove __bold__
    post = post.replace(/_(.*?)_/g, '$1'); // Remove _italic_
    
    // Clean and validate the article URL before including it
    const cleanedUrl = cleanUrl(article.url);
    if (cleanedUrl && !post.includes(cleanedUrl)) {
      post += `\n\nRead more: ${cleanedUrl}`;
    }

    return post;
  } catch (error) {
    console.error('❌ Error generating LinkedIn post:', error);
    throw new Error('Failed to generate LinkedIn post');
  }
}

// Clean and validate URL to prevent 404 errors
function cleanUrl(url) {
  if (!url) return null;
  
  // Remove any leading/trailing whitespace
  url = url.trim();
  
  // Ensure the URL has a protocol
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  // Remove any invalid characters that might cause issues
  url = url.replace(/[\s\n\r\t]/g, '');
  
  // Remove trailing slashes and fragments that might cause issues
  url = url.replace(/\/+$/, '').split('#')[0];
  
  // Validate the URL format
  try {
    new URL(url);
    return url;
  } catch (error) {
    console.warn('⚠️ Invalid URL format:', url);
    return null;
  }
}

async function fetchRelevantImage(topic) {
  const imageAPIs = [
    {
      name: 'Pexels',
      key: process.env.PEXELS_API_KEY,
      fetch: async (searchTerm) => {
        const response = await axios.get(`https://api.pexels.com/v1/search`, {
          params: { query: searchTerm, per_page: 20, orientation: 'landscape' },
          headers: { 'Authorization': process.env.PEXELS_API_KEY }
        });
        return response.data.photos;
      }
    }
  ];

  const searchTerms = [topic, ...topic.split(' ').filter(word => word.length > 3)];
  
  for (const api of imageAPIs) {
    if (!api.key) continue;
    
    for (const searchTerm of searchTerms) {
      try {
        console.log(`🖼️ Searching ${api.name} for: ${searchTerm}`);
        const images = await api.fetch(searchTerm);
        
        if (images && images.length > 0) {
          const randomImage = images[Math.floor(Math.random() * Math.min(10, images.length))];
          return {
            url: randomImage.src?.large || randomImage.src?.original,
            photographer: randomImage.photographer,
            source: api.name
          };
        }
      } catch (error) {
        console.warn(`⚠️ Image search failed for ${searchTerm}:`, error.message);
        continue;
      }
    }
  }

  // Fallback professional stock photos
  const fallbackImages = [
    'https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg',
    'https://images.pexels.com/photos/3182773/pexels-photo-3182773.jpeg',
    'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg'
  ];
  
  return {
    url: fallbackImages[Math.floor(Math.random() * fallbackImages.length)],
    photographer: 'Pexels',
    source: 'Pexels'
  };
}

// Dashboard and Analytics API endpoints
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get posts this month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const postsResult = await pool.query(
            'SELECT COUNT(*) as count FROM scheduled_posts WHERE user_id = $1 AND created_at >= $2',
            [userId, startOfMonth]
        );
        
        // Get scheduled posts count
        const scheduledResult = await pool.query(
            'SELECT COUNT(*) as count FROM scheduled_posts WHERE user_id = $1 AND status = $2',
            [userId, 'scheduled']
        );
        
        const stats = {
            postsThisMonth: parseInt(postsResult.rows[0].count),
            avgEngagement: postsResult.rows[0].count > 0 ? '4.2%' : '0%',
            scheduledCount: parseInt(scheduledResult.rows[0].count)
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Error getting dashboard stats:', error);
        res.status(500).json({ error: 'Failed to load dashboard stats' });
    }
});

app.get('/api/analytics/performance', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Get recent posts for analytics calculation
        const result = await pool.query(
            'SELECT COUNT(*) as count FROM scheduled_posts WHERE user_id = $1 AND created_at >= $2',
            [userId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] // Last 30 days
        );
        
        const recentPostsCount = parseInt(result.rows[0].count);
        
        const analytics = {
            engagementRate: recentPostsCount > 0 ? '3.8%' : '0%',
            audienceGrowth: recentPostsCount > 5 ? '+12%' : '0%',
            contentPerformance: Math.min(recentPostsCount, 10) + '/10'
        };
        
        res.json(analytics);
    } catch (error) {
        console.error('Error getting analytics:', error);
        res.status(500).json({ error: 'Failed to load analytics' });
    }
});

app.get('/api/posts/recent', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        
        const result = await pool.query(
            `SELECT topic, content, status, created_at 
             FROM scheduled_posts 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT 10`,
            [userId]
        );
        
        res.json({ posts: result.rows });
    } catch (error) {
        console.error('Error getting recent posts:', error);
        res.status(500).json({ error: 'Failed to load recent posts' });
    }
});

// Refresh image endpoint
app.post('/api/refresh-image', requireAuth, async (req, res) => {
  try {
    const { topic } = req.body;
    
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }
    
    console.log('🔄 Refreshing image for topic:', topic);
    const image = await fetchRelevantImage(topic);
    
    if (image) {
      res.json({ 
        success: true, 
        image: {
          url: image.url,
          photographer: image.photographer,
          source: image.source
        }
      });
    } else {
      res.status(500).json({ error: 'Failed to fetch new image' });
    }
  } catch (error) {
    console.error('❌ Error refreshing image:', error);
    res.status(500).json({ error: 'Failed to refresh image' });
    }
});

// Legacy automation endpoint - keeping for compatibility
app.post('/api/automation/settings-legacy', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { frequency, time, contentType, tone, days } = req.body;
        
        // Ensure days is an array before joining
        const daysArray = Array.isArray(days) ? days : [];
        
        // Update user preferences with automation settings
        await pool.query(
            `UPDATE user_preferences 
             SET posting_frequency = $1, posting_time = $2, auto_content_type = $3, 
                 auto_tone = $4, posting_days = $5, auto_posting_enabled = true, 
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $6`,
            [frequency, time, contentType, tone, daysArray.join(','), userId]
        );
        
        res.json({ success: true, message: 'Automation settings saved successfully' });
    } catch (error) {
        console.error('Error saving automation settings:', error);
        res.status(500).json({ error: 'Failed to save automation settings' });
    }
});

// New API endpoints for viral content features
app.get('/api/viral-formats', (req, res) => {
  try {
    res.json({
      formats: viralTemplates.viralFormats,
      engagement_hooks: Object.keys(viralTemplates.engagementHooks),
      soft_ctas: viralTemplates.softCTAs.slice(0, 5) // Return first 5 as examples
    });
  } catch (error) {
    console.error('❌ Error fetching viral formats:', error);
    res.status(500).json({ error: 'Failed to fetch viral formats' });
  }
});

app.get('/api/viral-tweets/:topic', (req, res) => {
  try {
    const { topic } = req.params;
    const tweets = viralTemplates.viralTweetBank[topic] || [];
    
    res.json({
      topic,
      available_tweets: tweets.length,
      tweets: tweets
    });
  } catch (error) {
    console.error('❌ Error fetching viral tweets:', error);
    res.status(500).json({ error: 'Failed to fetch viral tweets' });
  }
});

app.get('/api/topics-with-tweets', (req, res) => {
  try {
    console.log('📋 Topics endpoint called');
    console.log('📋 viralTemplates module exists:', !!viralTemplates);
    console.log('📋 viralTweetBank exists:', !!viralTemplates.viralTweetBank);
    console.log('📋 viralTweetBank keys:', Object.keys(viralTemplates.viralTweetBank || {}));
    console.log('📋 viralTweetBank type:', typeof viralTemplates.viralTweetBank);
    
    if (!viralTemplates || !viralTemplates.viralTweetBank) {
      console.error('❌ viralTemplates or viralTweetBank not available');
      return res.status(500).json({ error: 'Viral templates not loaded' });
    }
    
    const topicsWithTweets = Object.keys(viralTemplates.viralTweetBank).map(topic => ({
      topic,
      count: viralTemplates.viralTweetBank[topic].length
    }));
    
    console.log('📋 Returning topics:', topicsWithTweets);
    res.json(topicsWithTweets);
  } catch (error) {
    console.error('❌ Error fetching topics with tweets:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to fetch topics' });
  }
});

// Repurpose tweet endpoint
app.post('/api/repurpose-tweet', rateLimitMiddleware, async (req, res) => {
  try {
    const { tweet_text, topic, tone = 'professional', length = 'medium' } = req.body;
    
    if (!tweet_text && !topic) {
      return res.status(400).json({ 
        error: 'Either tweet text or topic is required' 
      });
    }

    // Check authentication
    const token = extractJWTFromRequest(req);
    if (!token) {
      return res.status(401).json({
        error: 'Authentication required',
        needsAuth: true
      });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.status(401).json({
        error: 'Invalid authentication token',
        needsAuth: true
      });
    }

    const userId = decoded.id;
    
    // Check credit balance
    const creditCheck = await CreditDB.hasCredits(userId, 1);
    if (!creditCheck.hasEnough) {
      return res.status(403).json({
        error: 'Insufficient credits',
        reason: `You need 1 credit to repurpose content. Current balance: ${creditCheck.currentCredits}`,
        creditsRemaining: creditCheck.currentCredits,
        needsCredits: true
      });
    }

    const result = await repurposeTweet(tweet_text, topic, tone, length);

    // Deduct 1 credit for tweet repurposing
    const newCreditBalance = await CreditDB.deductCredits(userId, 1, 'Tweet repurposing');
    
    // Track usage
    await UsageDB.trackUsage(userId, 'post_generation', 0.00136, 1200, {
      topic,
      tone,
      length,
      post_type: 'repurposed_tweet',
      credits_deducted: 1,
      new_credit_balance: newCreditBalance,
      timestamp: new Date().toISOString()
    });

    // Add credit info to response
    result.credits = {
      used: 1,
      remaining: newCreditBalance
    };

    res.json(result);
  } catch (error) {
    console.error('❌ Error repurposing tweet:', error);
    res.status(500).json({ 
      error: 'Failed to repurpose tweet. Please try again.' 
    });
  }
});

// ====================
// AUTOMATION ENDPOINTS
// ====================

// Get automation settings
app.get('/api/automation/settings', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      'SELECT * FROM automation_settings WHERE user_id = $1',
      [userId]
    );
    
    if (result.rows.length === 0) {
      // Return default settings
      res.json({
        enabled: false,
        frequency: 'weekly',
        posting_times: 'afternoon',
        content_mix: 'balanced',
        default_tone: 'professional',
        topic_pool: ['Artificial Intelligence', 'Leadership', 'Digital Marketing'],
        posting_days: ['monday', 'wednesday', 'friday'],
        auto_approve: false
      });
    } else {
      const settings = result.rows[0];
      res.json({
        enabled: settings.enabled,
        frequency: settings.frequency,
        posting_times: settings.posting_times,
        content_mix: settings.content_mix,
        default_tone: settings.default_tone,
        topic_pool: settings.topic_pool,
        posting_days: settings.posting_days,
        auto_approve: settings.auto_approve
      });
    }
  } catch (error) {
    console.error('❌ Error fetching automation settings:', error);
    res.status(500).json({ error: 'Failed to fetch automation settings' });
  }
});

// Save automation settings
app.post('/api/automation/settings', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      enabled,
      frequency,
      posting_times,
      content_mix,
      default_tone,
      topic_pool,
      posting_days,
      auto_approve
    } = req.body;

    console.log('🤖 Saving automation settings for user:', userId);
    console.log('📝 Request body:', req.body);

    // Validate required arrays
    const validatedTopicPool = Array.isArray(topic_pool) ? topic_pool : [];
    const validatedPostingDays = Array.isArray(posting_days) ? posting_days : [];

    console.log('✅ Validated data:', {
      enabled,
      frequency,
      posting_times,
      content_mix,
      default_tone,
      topic_pool: validatedTopicPool,
      posting_days: validatedPostingDays,
      auto_approve
    });

    // Upsert automation settings
    const result = await pool.query(`
      INSERT INTO automation_settings 
      (user_id, enabled, frequency, posting_times, content_mix, default_tone, topic_pool, posting_days, auto_approve, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        enabled = EXCLUDED.enabled,
        frequency = EXCLUDED.frequency,
        posting_times = EXCLUDED.posting_times,
        content_mix = EXCLUDED.content_mix,
        default_tone = EXCLUDED.default_tone,
        topic_pool = EXCLUDED.topic_pool,
        posting_days = EXCLUDED.posting_days,
        auto_approve = EXCLUDED.auto_approve,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [userId, enabled, frequency, posting_times, content_mix, default_tone, JSON.stringify(validatedTopicPool), JSON.stringify(validatedPostingDays), auto_approve]);

    console.log('🤖 Automation settings saved successfully for user:', userId);
    res.json({ success: true, settings: result.rows[0] });
  } catch (error) {
    console.error('❌ Error saving automation settings:', error);
    console.error('❌ Error details:', error.message);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to save automation settings' });
  }
});

// Toggle automation on/off
app.post('/api/automation/toggle', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { enabled } = req.body;

    await pool.query(`
      INSERT INTO automation_settings (user_id, enabled, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        enabled = EXCLUDED.enabled,
        updated_at = CURRENT_TIMESTAMP
    `, [userId, enabled]);

    console.log(`🤖 Automation ${enabled ? 'enabled' : 'disabled'} for user:`, userId);
    res.json({ success: true, enabled });
  } catch (error) {
    console.error('❌ Error toggling automation:', error);
    res.status(500).json({ error: 'Failed to toggle automation' });
  }
});

// Generate automation queue
app.post('/api/automation/generate-queue', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { weeks = 4 } = req.body;

    // Check credit balance - automation queue generation costs 1 credit
    const creditCheck = await CreditDB.hasCredits(userId, 1);
    if (!creditCheck.hasEnough) {
      return res.status(403).json({
        error: 'Insufficient credits',
        reason: `You need 1 credit to generate automation queue. Current balance: ${creditCheck.currentCredits}`,
        creditsRemaining: creditCheck.currentCredits,
        needsCredits: true
      });
    }

    // Get automation settings
    const settingsResult = await pool.query(
      'SELECT * FROM automation_settings WHERE user_id = $1',
      [userId]
    );

    if (settingsResult.rows.length === 0) {
      return res.status(400).json({ error: 'Please configure automation settings first' });
    }

    const settings = settingsResult.rows[0];
    const topicPool = settings.topic_pool;
    const postingDays = settings.posting_days;
    const postsPerWeek = getPostsPerWeek(settings.frequency);

    // Generate schedule for next N weeks
    const queue = [];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() + 1); // Start tomorrow

    for (let week = 0; week < weeks; week++) {
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() + (week * 7));

      let postsThisWeek = 0;
      const shuffledTopics = [...topicPool].sort(() => Math.random() - 0.5);
      const shuffledDays = [...postingDays].sort(() => Math.random() - 0.5);

      for (const day of shuffledDays) {
        if (postsThisWeek >= postsPerWeek) break;

        const dayIndex = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(day);
        const postDate = new Date(weekStart);
        postDate.setDate(postDate.getDate() + (dayIndex - weekStart.getDay()));
        
        // Set posting time
        const postTime = getPostingTime(settings.posting_times);
        postDate.setHours(postTime.hour, postTime.minute, 0, 0);

        // Skip if date is in the past
        if (postDate < new Date()) continue;

        const topic = shuffledTopics[postsThisWeek % shuffledTopics.length];
        const contentType = getContentType(settings.content_mix);
        const viralFormat = contentType === 'viral' ? getRandomViralFormat() : null;

        queue.push({
          user_id: userId,
          automation_settings_id: settings.id,
          topic,
          content_type: contentType,
          viral_format: viralFormat,
          tone: settings.default_tone,
          scheduled_for: postDate,
          status: 'pending'
        });

        postsThisWeek++;
      }
    }

    // Clear existing queue and insert new one
    await pool.query('DELETE FROM automation_queue WHERE user_id = $1 AND status = $2', [userId, 'pending']);
    
    for (const item of queue) {
      await pool.query(`
        INSERT INTO automation_queue 
        (user_id, automation_settings_id, topic, content_type, viral_format, tone, scheduled_for, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [item.user_id, item.automation_settings_id, item.topic, item.content_type, item.viral_format, item.tone, item.scheduled_for, item.status]);
    }

    // Deduct 1 credit for automation queue generation
    const newCreditBalance = await CreditDB.deductCredits(userId, 1, 'Automation queue generation');
    
    console.log(`🤖 Generated ${queue.length} posts for automation queue`);
    console.log(`💰 Deducted 1 credit from user ${userId} for automation queue. New balance: ${newCreditBalance}`);

    res.json({ 
      success: true, 
      generated: queue.length, 
      queue,
      credits: {
        used: 1,
        remaining: newCreditBalance
      }
    });
  } catch (error) {
    console.error('❌ Error generating automation queue:', error);
    res.status(500).json({ error: 'Failed to generate automation queue' });
  }
});

// Get automation queue
app.get('/api/automation/queue', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    const result = await pool.query(`
      SELECT * FROM automation_queue 
      WHERE user_id = $1 
      ORDER BY scheduled_for ASC 
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM automation_queue WHERE user_id = $1',
      [userId]
    );

    res.json({
      queue: result.rows,
      total: parseInt(countResult.rows[0].total),
      hasMore: (parseInt(offset) + result.rows.length) < parseInt(countResult.rows[0].total)
    });
  } catch (error) {
    console.error('❌ Error fetching automation queue:', error);
    res.status(500).json({ error: 'Failed to fetch automation queue' });
  }
});

// Get single queue item
app.get('/api/automation/queue/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const queueId = req.params.id;

    const result = await pool.query(`
      SELECT * FROM automation_queue 
      WHERE id = $1 AND user_id = $2
    `, [queueId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Error fetching queue item:', error);
    res.status(500).json({ error: 'Failed to fetch queue item' });
  }
});

// Update queue item
app.put('/api/automation/queue/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const queueId = req.params.id;
    const { topic, tone, scheduled_for, status, content_type } = req.body;

    const result = await pool.query(`
      UPDATE automation_queue 
      SET topic = $1, tone = $2, scheduled_for = $3, status = $4, content_type = $5, updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 AND user_id = $7
      RETURNING *
    `, [topic, tone, scheduled_for, status, content_type, queueId, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    console.log(`✏️ Updated queue item ${queueId} for user ${userId}`);
    res.json({ success: true, item: result.rows[0] });
  } catch (error) {
    console.error('❌ Error updating queue item:', error);
    res.status(500).json({ error: 'Failed to update queue item' });
  }
});

// Delete queue item
app.delete('/api/automation/queue/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const queueId = req.params.id;

    const result = await pool.query(
      'DELETE FROM automation_queue WHERE id = $1 AND user_id = $2 RETURNING *',
      [queueId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Queue item not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting queue item:', error);
    res.status(500).json({ error: 'Failed to delete queue item' });
  }
});

// Process automation queue items into actual posts (VERCEL SERVERLESS COMPATIBLE)
app.post('/api/automation/process-queue', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`🔄 Processing automation queue for user ${userId}...`);

    // Get pending automation queue items that are ready to be processed
    const result = await pool.query(`
      SELECT * FROM automation_queue 
      WHERE user_id = $1 AND status = 'pending' AND scheduled_for <= CURRENT_TIMESTAMP + INTERVAL '5 minutes'
      ORDER BY scheduled_for ASC
      LIMIT 10
    `, [userId]);

    if (result.rows.length === 0) {
      return res.json({ success: true, processed: 0, message: 'No items ready for processing' });
    }

    let processed = 0;
    const results = [];

    for (const queueItem of result.rows) {
      try {
        console.log(`📝 Processing queue item: ${queueItem.topic} scheduled for ${queueItem.scheduled_for}`);

        // Generate post content
        const postData = await generatePost(queueItem.topic, queueItem.tone);
        
        if (postData && postData.post) {
          // Create scheduled post entry
          const scheduledPost = await PostsDB.createScheduledPost(userId, {
            topic: queueItem.topic,
            tone: queueItem.tone,
            post_content: postData.post,
            image_url: postData.image?.url || null,
            article_url: postData.article?.url || null,
            scheduled_for: queueItem.scheduled_for
          });

          // Update queue item status to ready (processed and ready for posting)
          await pool.query(
            'UPDATE automation_queue SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['ready', queueItem.id]
          );

          // If the scheduled time is now or in the past, post immediately
          const scheduleTime = new Date(queueItem.scheduled_for);
          const now = new Date();
          
          // Post immediately if scheduled time is within 5 minutes (past or future)
          const timeDifference = Math.abs(scheduleTime.getTime() - now.getTime());
          const fiveMinutesMs = 5 * 60 * 1000;
          
          if (timeDifference <= fiveMinutesMs) {
            console.log(`🚀 Posting immediately (scheduled time has passed): ${queueItem.topic}`);
            
            try {
              const accessToken = await LinkedInService.ensureValidToken(userId);
              const postResult = await LinkedInService.createPost(
                accessToken,
                postData.post,
                postData.image?.url
              );

              if (postResult.success) {
                await PostsDB.updatePostStatus(scheduledPost.id, 'posted', postResult.postId);
                console.log(`✅ Posted successfully: ${postResult.postId}`);
                results.push({
                  success: true,
                  topic: queueItem.topic,
                  scheduled_for: queueItem.scheduled_for,
                  action: 'posted_immediately',
                  linkedin_post_id: postResult.postId
                });
              } else {
                await PostsDB.updatePostStatus(scheduledPost.id, 'failed', null, postResult.error);
                console.error(`❌ Failed to post: ${postResult.error}`);
                results.push({
                  success: false,
                  topic: queueItem.topic,
                  scheduled_for: queueItem.scheduled_for,
                  action: 'post_failed',
                  error: postResult.error
                });
              }
            } catch (postError) {
              console.error(`❌ Error posting: ${postError.message}`);
              await PostsDB.updatePostStatus(scheduledPost.id, 'failed', null, postError.message);
              results.push({
                success: false,
                topic: queueItem.topic,
                scheduled_for: queueItem.scheduled_for,
                action: 'post_error',
                error: postError.message
              });
            }
          } else {
            console.log(`⏰ Scheduled for later: ${scheduleTime.toISOString()}`);
            results.push({
              success: true,
              topic: queueItem.topic,
              scheduled_for: queueItem.scheduled_for,
              action: 'scheduled_for_later',
              will_post_at: scheduleTime.toISOString()
            });
          }

          processed++;

        } else {
          console.error(`❌ Failed to generate content for: ${queueItem.topic}`);
          await pool.query(
            'UPDATE automation_queue SET status = $1, error_message = $2 WHERE id = $3',
            ['failed', 'Failed to generate content', queueItem.id]
          );
          results.push({
            success: false,
            topic: queueItem.topic,
            scheduled_for: queueItem.scheduled_for,
            action: 'content_generation_failed',
            error: 'Failed to generate content'
          });
        }

      } catch (itemError) {
        console.error(`❌ Error processing queue item ${queueItem.id}:`, itemError);
        await pool.query(
          'UPDATE automation_queue SET status = $1, error_message = $2 WHERE id = $3',
          ['failed', itemError.message, queueItem.id]
        );
        results.push({
          success: false,
          topic: queueItem.topic,
          scheduled_for: queueItem.scheduled_for,
          action: 'processing_error',
          error: itemError.message
        });
      }
    }

    console.log(`✅ Processed ${processed} automation queue items`);
    res.json({ 
      success: true, 
      processed, 
      total_found: result.rows.length,
      results 
    });

  } catch (error) {
    console.error('❌ Error processing automation queue:', error);
    res.status(500).json({ error: 'Failed to process automation queue' });
  }
});

// Public cron endpoint - bypasses Vercel authentication
app.all('/cron-trigger', async (req, res) => {
  try {
    console.log('🔄 Public cron trigger received for automation processing');
    
    // Simple security check with multiple methods
    const secret = req.headers['x-cron-secret'] || req.query.secret || req.body?.secret;
    const expectedSecret = process.env.CRON_SECRET || 'secretwebhook12345';
    
    if (secret !== expectedSecret) {
      console.warn('⚠️ Invalid cron secret');
      return res.status(401).json({ error: 'Invalid secret' });
    }
    
    // Get all users who might have pending queue items
    console.log('🔍 Debug: Checking for pending queue items...');
    console.log('🕐 Current server time:', new Date().toISOString());
    console.log('🕐 Checking items scheduled up to:', new Date(Date.now() + 10 * 60 * 1000).toISOString());
    
    // First, let's see ALL pending items for debugging
    const allQueueResult = await pool.query(`
      SELECT user_id, topic, scheduled_for, status, created_at 
      FROM automation_queue 
      WHERE status = 'pending'
      ORDER BY scheduled_for ASC 
      LIMIT 10
    `);
    console.log('🔍 All queue items (latest 5):', allQueueResult.rows);
    
    const usersResult = await pool.query(`
      SELECT DISTINCT user_id FROM automation_queue 
      WHERE status = 'pending' AND scheduled_for <= CURRENT_TIMESTAMP + INTERVAL '10 minutes'
    `);

    let totalProcessed = 0;
    const userResults = [];

    for (const user of usersResult.rows) {
      try {
        // Process queue for this user
        const processResult = await processUserQueue(user.user_id);
        totalProcessed += processResult.processed;
        userResults.push({
          user_id: user.user_id,
          processed: processResult.processed,
          results: processResult.results
        });
      } catch (userError) {
        console.error(`❌ Error processing queue for user ${user.user_id}:`, userError);
        userResults.push({
          user_id: user.user_id,
          processed: 0,
          error: userError.message
        });
      }
    }

    console.log(`🎯 Webhook processed: ${totalProcessed} posts across ${usersResult.rows.length} users`);
    res.json({
      success: true,
      total_processed: totalProcessed,
      users_processed: usersResult.rows.length,
      user_results: userResults,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in webhook processing:', error);
    res.status(500).json({ error: 'Webhook processing failed', details: error.message });
  }
});

// Trigger queue processing (can be called externally or via webhook)
app.post('/api/automation/trigger-processing', async (req, res) => {
  try {
    console.log('🔄 Manual trigger for queue processing received');
    
    // Get all users who might have pending queue items
    const usersResult = await pool.query(`
      SELECT DISTINCT user_id FROM automation_queue 
      WHERE status = 'pending' AND scheduled_for <= CURRENT_TIMESTAMP + INTERVAL '5 minutes'
    `);

    let totalProcessed = 0;
    const userResults = [];

    for (const user of usersResult.rows) {
      try {
        // Process queue for this user
        const processResult = await processUserQueue(user.user_id);
        totalProcessed += processResult.processed;
        userResults.push({
          user_id: user.user_id,
          processed: processResult.processed,
          results: processResult.results
        });
      } catch (userError) {
        console.error(`❌ Error processing queue for user ${user.user_id}:`, userError);
        userResults.push({
          user_id: user.user_id,
          processed: 0,
          error: userError.message
        });
      }
    }

    console.log(`🎯 Total processed across all users: ${totalProcessed}`);
    res.json({
      success: true,
      total_processed: totalProcessed,
      users_processed: usersResult.rows.length,
      user_results: userResults
    });

  } catch (error) {
    console.error('❌ Error in trigger processing:', error);
    res.status(500).json({ error: 'Failed to trigger processing' });
  }
});

// Helper function to process queue for a specific user
async function processUserQueue(userId) {
  const result = await pool.query(`
    SELECT * FROM automation_queue 
    WHERE user_id = $1 AND status = 'pending' AND scheduled_for <= CURRENT_TIMESTAMP + INTERVAL '5 minutes'
    ORDER BY scheduled_for ASC
    LIMIT 10
  `, [userId]);

  let processed = 0;
  const results = [];

  for (const queueItem of result.rows) {
    try {
      const postData = await generatePost(queueItem.topic, queueItem.tone);
      
      if (postData && postData.post) {
        const scheduledPost = await PostsDB.createScheduledPost(userId, {
          topic: queueItem.topic,
          tone: queueItem.tone,
          post_content: postData.post,
          image_url: postData.image?.url || null,
          article_url: postData.article?.url || null,
          scheduled_for: queueItem.scheduled_for
        });

        await pool.query(
          'UPDATE automation_queue SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
          ['ready', queueItem.id]
        );

        const scheduleTime = new Date(queueItem.scheduled_for);
        const now = new Date();
        
        // Post immediately if scheduled time is within 5 minutes (past or future)
        const timeDifference = Math.abs(scheduleTime.getTime() - now.getTime());
        const fiveMinutesMs = 5 * 60 * 1000;
        
        if (timeDifference <= fiveMinutesMs) {
          try {
            const accessToken = await LinkedInService.ensureValidToken(userId);
            const postResult = await LinkedInService.createPost(
              accessToken,
              postData.post,
              postData.image?.url
            );

            if (postResult.success) {
              await PostsDB.updatePostStatus(scheduledPost.id, 'posted', postResult.postId);
              results.push({ success: true, action: 'posted', linkedin_post_id: postResult.postId });
            } else {
              await PostsDB.updatePostStatus(scheduledPost.id, 'failed', null, postResult.error);
              results.push({ success: false, action: 'post_failed', error: postResult.error });
            }
          } catch (postError) {
            await PostsDB.updatePostStatus(scheduledPost.id, 'failed', null, postError.message);
            results.push({ success: false, action: 'post_error', error: postError.message });
          }
        } else {
          results.push({ success: true, action: 'scheduled_for_later' });
        }

        processed++;
      }
    } catch (itemError) {
      await pool.query(
        'UPDATE automation_queue SET status = $1, error_message = $2 WHERE id = $3',
        ['failed', itemError.message, queueItem.id]
      );
      results.push({ success: false, action: 'processing_error', error: itemError.message });
    }
  }

  return { processed, results };
}

// Get automation status for debugging and monitoring
app.get('/api/automation/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get queue status
    const queueResult = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(scheduled_for) as next_scheduled
      FROM automation_queue 
      WHERE user_id = $1 
      GROUP BY status
    `, [userId]);

    // Get scheduled posts status  
    const scheduledResult = await pool.query(`
      SELECT 
        status,
        COUNT(*) as count,
        MIN(scheduled_for) as next_scheduled
      FROM scheduled_posts 
      WHERE user_id = $1 
      GROUP BY status
    `, [userId]);

    // Get recent activity
    const recentResult = await pool.query(`
      SELECT * FROM scheduled_posts 
      WHERE user_id = $1 
      ORDER BY created_at DESC 
      LIMIT 5
    `, [userId]);

    res.json({
      user_id: userId,
      automation_queue: queueResult.rows,
      scheduled_posts: scheduledResult.rows,
      recent_activity: recentResult.rows,
      last_check: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting automation status:', error);
    res.status(500).json({ error: 'Failed to get automation status' });
  }
});

// Get automation analytics
app.get('/api/automation/analytics', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '7d' } = req.query;

    const startDate = new Date();
    if (period === '7d') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    }

    // Posts this period
    const postsResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM automation_queue 
      WHERE user_id = $1 AND status = 'posted' AND posted_at >= $2
    `, [userId, startDate]);

    // Next scheduled post
    const nextPostResult = await pool.query(`
      SELECT scheduled_for 
      FROM automation_queue 
      WHERE user_id = $1 AND status IN ('pending', 'ready') 
      ORDER BY scheduled_for ASC 
      LIMIT 1
    `, [userId]);

    // Queue length
    const queueResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM automation_queue 
      WHERE user_id = $1 AND status IN ('pending', 'ready')
    `, [userId]);

    res.json({
      postsThisPeriod: parseInt(postsResult.rows[0].count),
      nextPost: nextPostResult.rows[0]?.scheduled_for || null,
      queueLength: parseInt(queueResult.rows[0].count)
    });
  } catch (error) {
    console.error('❌ Error fetching automation analytics:', error);
    res.status(500).json({ error: 'Failed to fetch automation analytics' });
  }
});

// Helper functions for automation
function getPostsPerWeek(frequency) {
  switch (frequency) {
    case 'daily': return 7;
    case 'weekly': return 3;
    case 'biweekly': return 2;
    default: return 3;
  }
}

function getPostingTime(timeSlot) {
  switch (timeSlot) {
    case 'morning': return { hour: 9, minute: 0 };
    case 'afternoon': return { hour: 13, minute: 0 };
    case 'evening': return { hour: 17, minute: 0 };
    case 'mixed': 
      const times = [
        { hour: 9, minute: 0 },
        { hour: 13, minute: 0 },
        { hour: 17, minute: 0 }
      ];
      return times[Math.floor(Math.random() * times.length)];
    default: return { hour: 13, minute: 0 };
  }
}

function getContentType(contentMix) {
  const random = Math.random();
  switch (contentMix) {
    case 'news_heavy':
      return random < 0.7 ? 'news' : (random < 0.85 ? 'viral' : 'manual');
    case 'balanced':
      return random < 0.5 ? 'news' : (random < 0.75 ? 'viral' : 'manual');
    case 'viral_heavy':
      return random < 0.7 ? 'viral' : (random < 0.85 ? 'news' : 'manual');
    case 'professional':
      return random < 0.8 ? 'news' : 'manual';
    default:
      return 'news';
  }
}

function getRandomViralFormat() {
  const formats = ['open-loop', 'contrarian', 'confession', 'framework', 'experience', 'data-driven'];
  return formats[Math.floor(Math.random() * formats.length)];
}

// ====================
// SERVER INITIALIZATION
// ====================

async function startServer() {
  try {
    console.log('🔧 Starting server initialization...');
    console.log('🔧 Environment:', process.env.NODE_ENV);
    
    // Debug environment variables
    console.log('🔧 Environment variables check:');
    console.log('  NODE_ENV:', process.env.NODE_ENV);
    console.log('  VERCEL:', !!process.env.VERCEL);
    console.log('  POSTGRES_URL:', !!process.env.POSTGRES_URL);
    console.log('  DATABASE_URL:', !!process.env.DATABASE_URL);
    console.log('  POSTGRES_PRISMA_URL:', !!process.env.POSTGRES_PRISMA_URL);
    console.log('  POSTGRES_URL_NON_POOLING:', !!process.env.POSTGRES_URL_NON_POOLING);
    console.log('  LINKEDIN_CLIENT_ID:', !!process.env.LINKEDIN_CLIENT_ID);
    console.log('  OPENAI_API_KEY:', !!process.env.OPENAI_API_KEY);
    
    // Initialize database
    console.log('🔧 Initializing database...');
    await initializeDatabase();
    console.log('✅ Database initialized');
    
    // Initialize scheduler with post generation function (only if OAuth configured)
    if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
      console.log('🔧 Initializing scheduler...');
      PostScheduler.initialize(generatePost);
      console.log('✅ Scheduler initialized');
    }
    
    console.log('📊 Features enabled:');
    console.log('  ✅ AI Post Generation');
    console.log('  ✅ Real-time News Integration');
    console.log('  ✅ Copy to Clipboard');
    
    if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
      console.log('  ✅ LinkedIn OAuth Authentication');
      console.log('  ✅ Automated Post Scheduling');
      console.log('  ✅ Direct LinkedIn Posting');
      console.log('  ✅ User Preferences Management');
    } else {
      console.log('  ⚠️  LinkedIn automation disabled (OAuth not configured)');
    }
    
    console.log('  ✅ Rate Limiting & Security');
    console.log('🔧 Server initialization complete, returning Express app');
    
    return app;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    throw error;
  }
}

// For local development
if (require.main === module) {
  startServer().then(app => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  }).catch(error => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
}

// For Vercel serverless deployment
let serverInitialized = false;
let serverApp = null;

module.exports = async (req, res) => {
  console.log('🔍 Vercel function called:', {
    method: req.method,
    url: req.url,
    path: req.path || 'undefined',
    originalUrl: req.originalUrl || 'undefined',
    query: req.query,
    headers: Object.keys(req.headers),
    initialized: serverInitialized,
    timestamp: new Date().toISOString()
  });

  // Special debug logging for root requests
  if (req.url === '/' || req.path === '/') {
    console.log('🚨 ROOT REQUEST DETECTED:', {
      url: req.url,
      path: req.path,
      originalUrl: req.originalUrl,
      userAgent: req.headers['user-agent']
    });
  }

  if (!serverInitialized) {
    try {
      console.log('🚀 Initializing server for Vercel...');
      serverApp = await startServer();
      serverInitialized = true;
      console.log('✅ Server initialized successfully for Vercel');
    } catch (error) {
      console.error('❌ Failed to initialize server:', error);
      console.error('❌ Error stack:', error.stack);
      return res.status(500).json({ 
        error: 'Server initialization failed',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  }
  
  try {
    console.log('📡 Passing request to Express app...', {
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    });
    return serverApp(req, res);
  } catch (error) {
    console.error('❌ Error in Express app:', error);
    console.error('❌ Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'Request handling failed',
      message: error.message,
      stack: error.stack
    });
  }
}; 

// Admin endpoint to migrate status constraint
app.post('/api/admin/migrate-status-constraint', async (req, res) => {
  try {
    console.log('🔄 Starting status constraint migration...');
    
    const client = await pool.connect();
    try {
      // First, check if the constraint exists
      console.log('🔍 Checking existing constraint...');
      const constraintQuery = `
        SELECT constraint_name, check_clause 
        FROM information_schema.check_constraints 
        WHERE constraint_name = 'user_subscriptions_status_check'
      `;
      const constraintResult = await client.query(constraintQuery);
      
      let migrationSteps = [];
      
      if (constraintResult.rows.length > 0) {
        console.log('📋 Current constraint:', constraintResult.rows[0]);
        migrationSteps.push(`Current constraint: ${constraintResult.rows[0].check_clause}`);
        
        // Drop the existing constraint
        console.log('🗑️ Dropping existing constraint...');
        await client.query(`
          ALTER TABLE user_subscriptions 
          DROP CONSTRAINT user_subscriptions_status_check
        `);
        console.log('✅ Existing constraint dropped');
        migrationSteps.push('Dropped existing constraint');
      } else {
        console.log('ℹ️ No existing constraint found');
        migrationSteps.push('No existing constraint found');
      }
      
      // Add the new constraint with all required statuses
      console.log('➕ Adding new constraint...');
      await client.query(`
        ALTER TABLE user_subscriptions 
        ADD CONSTRAINT user_subscriptions_status_check 
        CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid', 'incomplete'))
      `);
      console.log('✅ New constraint added with incomplete status');
      migrationSteps.push('Added new constraint with incomplete status');
      
      // Verify the new constraint
      const newConstraintResult = await client.query(constraintQuery);
      if (newConstraintResult.rows.length > 0) {
        console.log('✅ New constraint verified:', newConstraintResult.rows[0]);
        migrationSteps.push(`New constraint verified: ${newConstraintResult.rows[0].check_clause}`);
      }
      
      console.log('🎉 Status constraint migration completed successfully!');
      
      res.json({
        success: true,
        message: 'Status constraint migration completed successfully',
        steps: migrationSteps
      });
      
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('❌ Migration error:', error);
    res.status(500).json({
      success: false,
      error: 'Migration failed',
      details: error.message
    });
  }
});

// Migration page route
app.get('/migrate', (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Employment - Database Migration</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            text-align: center;
        }
        .migration-box {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            padding: 20px;
            margin: 20px 0;
        }
        .button {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
            margin: 10px 0;
        }
        .button:hover {
            background: #0056b3;
        }
        .button:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        .result {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
            display: none;
        }
        .error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
        }
        .log {
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            padding: 15px;
            margin: 15px 0;
            font-family: monospace;
            white-space: pre-wrap;
            max-height: 400px;
            overflow-y: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Employment Database Migration</h1>
        
        <div class="migration-box">
            <h3>Fix Subscription Status Constraint</h3>
            <p>This migration will fix the database constraint that's preventing subscription creation with "incomplete" status.</p>
            
            <p><strong>What it does:</strong></p>
            <ul>
                <li>Drops the existing status constraint on user_subscriptions table</li>
                <li>Recreates it with support for "incomplete" status</li>
                <li>Verifies the new constraint is working</li>
            </ul>
            
            <button id="runMigration" class="button">Run Migration</button>
            
            <div id="result" class="result">
                <h4>Migration Result:</h4>
                <div id="resultContent"></div>
            </div>
            
            <div id="log" class="log" style="display: none;">
                <h4>Migration Log:</h4>
                <div id="logContent"></div>
            </div>
        </div>
        
        <div class="migration-box">
            <h3>Migration Status</h3>
            <p>Current subscription creation issue: <strong>Database constraint violation for "incomplete" status</strong></p>
            <p>After migration: <strong>Subscription creation should work normally</strong></p>
        </div>
    </div>

    <script>
        document.getElementById('runMigration').addEventListener('click', async function() {
            const button = this;
            const result = document.getElementById('result');
            const log = document.getElementById('log');
            const resultContent = document.getElementById('resultContent');
            const logContent = document.getElementById('logContent');
            
            button.disabled = true;
            button.textContent = 'Running Migration...';
            result.style.display = 'none';
            log.style.display = 'block';
            logContent.textContent = 'Starting migration...\\n';
            
            try {
                const response = await fetch('/api/admin/migrate-status-constraint', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                
                const data = await response.json();
                
                if (data.success) {
                    result.className = 'result';
                    resultContent.innerHTML = \`
                        <p><strong>✅ Migration completed successfully!</strong></p>
                        <p>\${data.message}</p>
                        <ul>
                            \${data.steps.map(step => \`<li>\${step}</li>\`).join('')}
                        </ul>
                    \`;
                    logContent.textContent += 'Migration completed successfully!\\n';
                    logContent.textContent += 'You can now try creating subscriptions again.\\n';
                } else {
                    result.className = 'result error';
                    resultContent.innerHTML = \`
                        <p><strong>❌ Migration failed</strong></p>
                        <p>Error: \${data.error}</p>
                        <p>Details: \${data.details}</p>
                    \`;
                    logContent.textContent += \`Migration failed: \${data.error}\\n\`;
                    logContent.textContent += \`Details: \${data.details}\\n\`;
                }
                
                result.style.display = 'block';
                
            } catch (error) {
                result.className = 'result error';
                result.style.display = 'block';
                resultContent.innerHTML = \`
                    <p><strong>❌ Migration failed</strong></p>
                    <p>Network or server error: \${error.message}</p>
                \`;
                logContent.textContent += \`Network error: \${error.message}\\n\`;
            }
            
            button.disabled = false;
            button.textContent = 'Run Migration';
        });
    </script>
</body>
</html>`;
  
  res.send(html);
});

// Test route for debugging
app.get('/test-migrate', (req, res) => {
  res.json({ 
    message: 'Migration endpoint test successful',
    timestamp: new Date().toISOString(),
    routes_working: true
  });
});

// BYOB (Bring Your Own Browser) Web Research Functions
async function performWebResearch(topic, searchDepth = 5, requiredKeywords = '') {
  try {
    console.log(`🔍 🚀 PERFORMING WEB RESEARCH v3.0 - VERCEL DEPLOYMENT for: ${topic}`);
    console.log(`🔑 Required keywords: "${requiredKeywords}"`);
    console.log('✅ Using 50+ premium RSS feeds (no API keys required)');
    
    // Step 1: Use our comprehensive RSS system
    console.log('📰 🚀 Starting comprehensive RSS v3.0 search...');
    const newsResults = await searchGoogleNewsFree(topic, searchDepth, requiredKeywords);
    
    if (!newsResults || newsResults.length === 0) {
      console.log('❌ No news articles found');
      return [];
    }
    
    console.log(`📊 Found ${newsResults.length} news articles`);
    
    // Step 2: Extract full content from news articles
    console.log('📄 Extracting article content...');
    const researchData = await processNewsArticles(newsResults, topic, Math.min(searchDepth, 5));
    
    console.log(`✅ BYOB research complete: ${researchData.length} articles processed`);
    return researchData;
    
  } catch (error) {
    console.error('❌ BYOB web research failed:', error);
    console.error('❌ Research error stack:', error.stack);
    throw error;
  }
}

// Free News Search Function using direct RSS feeds (bypasses Google News redirect issues)
async function searchGoogleNewsFree(topic, maxResults = 5, requiredKeywords = '') {
  try {
    console.log(`📰 🚀 COMPREHENSIVE RSS v3.0 VERCEL DEPLOYMENT - USING 50+ PREMIUM SOURCES for: "${topic}"`);
    console.log(`🔑 Required keywords filter: "${requiredKeywords}"`);
    
    // Parse required keywords
    const keywordsList = requiredKeywords ? requiredKeywords.toLowerCase().split(',').map(k => k.trim()).filter(k => k) : [];
    console.log(`🔍 Parsed keywords:`, keywordsList);
    
    // COMPREHENSIVE RSS FEED SYSTEM - Covers ALL possible topics
    const allRSSFeeds = [
      // 🏦 BUSINESS & FINANCE
      { 
        name: 'Bloomberg Markets', 
        url: 'https://www.bloomberg.com/feed/podcast/etf-report.xml',
        categories: ['business', 'finance', 'economy', 'market', 'company', 'stocks', 'investment', 'bloomberg'],
        isUniversal: false
      },
      { 
        name: 'CNBC Top News', 
        url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
        categories: ['business', 'finance', 'economy', 'market', 'cnbc', 'financial', 'trading'],
        isUniversal: false
      },
      { 
        name: 'Financial Times', 
        url: 'https://www.ft.com/rss/home/us',
        categories: ['business', 'finance', 'economy', 'market', 'ft', 'financial', 'global'],
        isUniversal: false
      },
      { 
        name: 'Investopedia', 
        url: 'https://www.investopedia.com/feedbuilder/feed/getfeed/?feedName=rss_headline',
        categories: ['business', 'finance', 'investment', 'trading', 'education', 'financial'],
        isUniversal: false
      },
      { 
        name: 'Yahoo Finance', 
        url: 'https://finance.yahoo.com/news/rssindex',
        categories: ['business', 'finance', 'stocks', 'market', 'yahoo', 'earnings'],
        isUniversal: false
      },

      // 💻 TECHNOLOGY & STARTUPS
      { 
        name: 'TechCrunch', 
        url: 'https://techcrunch.com/feed/',
        categories: ['technology', 'tech', 'startup', 'ai', 'artificial intelligence', 'artificial', 'intelligence', 'software', 'innovation', 'venture'],
        isUniversal: false
      },
      { 
        name: 'The Verge', 
        url: 'https://www.theverge.com/rss/index.xml',
        categories: ['technology', 'tech', 'gadgets', 'software', 'hardware', 'review'],
        isUniversal: false
      },
      { 
        name: 'Wired Technology', 
        url: 'https://www.wired.com/feed/category/technology/latest/rss',
        categories: ['technology', 'tech', 'innovation', 'science', 'future', 'digital'],
        isUniversal: false
      },
      { 
        name: 'Ars Technica', 
        url: 'http://feeds.arstechnica.com/arstechnica/index',
        categories: ['technology', 'tech', 'science', 'research', 'innovation', 'computing'],
        isUniversal: false
      },
      { 
        name: 'Product Hunt', 
        url: 'https://www.producthunt.com/feed',
        categories: ['technology', 'startup', 'product', 'innovation', 'launch', 'app'],
        isUniversal: false
      },

      // 🔬 SCIENCE & HEALTH
      { 
        name: 'Nature News', 
        url: 'https://www.nature.com/subjects/news.rss',
        categories: ['science', 'research', 'study', 'discovery', 'nature', 'breakthrough'],
        isUniversal: false
      },
      { 
        name: 'Live Science', 
        url: 'https://www.livescience.com/home/feed/site.xml',
        categories: ['science', 'research', 'discovery', 'biology', 'physics', 'space'],
        isUniversal: false
      },
      { 
        name: 'Medical News Today', 
        url: 'https://www.medicalnewstoday.com/rss',
        categories: ['health', 'medical', 'medicine', 'treatment', 'disease', 'healthcare'],
        isUniversal: false
      },
      { 
        name: 'ScienceDaily', 
        url: 'https://www.sciencedaily.com/rss/top/science.xml',
        categories: ['science', 'research', 'study', 'discovery', 'breakthrough', 'academic'],
        isUniversal: false
      },
      { 
        name: 'Scientific American', 
        url: 'https://www.scientificamerican.com/feed/rss/',
        categories: ['science', 'research', 'discovery', 'innovation', 'technology', 'nature'],
        isUniversal: false
      },

      // 🌱 ENVIRONMENT & ENERGY
      { 
        name: 'Inside Climate News', 
        url: 'https://insideclimatenews.org/feed/',
        categories: ['environment', 'climate', 'energy', 'renewable', 'sustainability', 'green'],
        isUniversal: false
      },
      { 
        name: 'Grist', 
        url: 'https://grist.org/feed/',
        categories: ['environment', 'climate', 'sustainability', 'green', 'renewable', 'energy'],
        isUniversal: false
      },
      { 
        name: 'Yale Environment 360', 
        url: 'https://e360.yale.edu/rss',
        categories: ['environment', 'climate', 'sustainability', 'conservation', 'ecology'],
        isUniversal: false
      },
      { 
        name: 'Energy.gov', 
        url: 'https://www.energy.gov/rss/news.xml',
        categories: ['energy', 'renewable', 'government', 'policy', 'power', 'electricity'],
        isUniversal: false
      },

      // 🌍 WORLD NEWS / INTERNATIONAL (UNIVERSAL) - Vercel-Optimized
      { 
        name: 'Reuters World News', 
        url: 'https://feeds.reuters.com/Reuters/worldNews',
        categories: ['news', 'world', 'global', 'international', 'breaking'],
        isUniversal: true
      },
      { 
        name: 'BBC World News', 
        url: 'https://feeds.bbci.co.uk/news/world/rss.xml',
        categories: ['news', 'world', 'global', 'international', 'breaking'],
        isUniversal: true
      },
      { 
        name: 'Associated Press', 
        url: 'https://apnews.com/rss',
        categories: ['news', 'breaking', 'latest', 'update', 'ap'],
        isUniversal: true
      },
      { 
        name: 'Al Jazeera', 
        url: 'https://www.aljazeera.com/xml/rss/all.xml',
        categories: ['news', 'world', 'global', 'international', 'middle east'],
        isUniversal: true
      },
      { 
        name: 'NPR World', 
        url: 'https://www.npr.org/rss/rss.php?id=1004',
        categories: ['news', 'world', 'international', 'npr', 'radio'],
        isUniversal: true
      },

      // 🇺🇸 US NEWS / POLITICS
      { 
        name: 'Politico', 
        url: 'https://www.politico.com/rss/politics08.xml',
        categories: ['politics', 'government', 'policy', 'election', 'washington', 'congress'],
        isUniversal: false
      },
      { 
        name: 'NPR Politics', 
        url: 'https://www.npr.org/rss/rss.php?id=1014',
        categories: ['politics', 'government', 'policy', 'npr', 'election'],
        isUniversal: false
      },
      { 
        name: 'The Hill', 
        url: 'https://thehill.com/rss/syndicator/19110',
        categories: ['politics', 'government', 'congress', 'washington', 'policy'],
        isUniversal: false
      },
      { 
        name: 'Axios', 
        url: 'https://www.axios.com/feeds/news.xml',
        categories: ['politics', 'government', 'news', 'policy', 'analysis'],
        isUniversal: false
      },

      // 🏛️ GOVERNMENT & POLICY
      { 
        name: 'White House Briefings', 
        url: 'https://www.whitehouse.gov/briefing-room/feed/',
        categories: ['government', 'policy', 'white house', 'administration', 'official'],
        isUniversal: false
      },
      { 
        name: 'GovTech', 
        url: 'https://www.govtech.com/rss',
        categories: ['government', 'technology', 'policy', 'digital', 'public sector'],
        isUniversal: false
      },

      // 🎭 ENTERTAINMENT & CULTURE
      { 
        name: 'Rolling Stone', 
        url: 'https://www.rollingstone.com/feed/',
        categories: ['entertainment', 'music', 'culture', 'celebrity', 'arts'],
        isUniversal: false
      },
      { 
        name: 'Variety', 
        url: 'https://variety.com/v/film/news/feed/',
        categories: ['entertainment', 'film', 'movie', 'hollywood', 'celebrity'],
        isUniversal: false
      },
      { 
        name: 'The Guardian Culture', 
        url: 'https://www.theguardian.com/culture/rss',
        categories: ['culture', 'arts', 'entertainment', 'books', 'theater'],
        isUniversal: false
      },
      { 
        name: 'Vulture', 
        url: 'https://www.vulture.com/rss/index.xml',
        categories: ['entertainment', 'culture', 'tv', 'movie', 'celebrity', 'review'],
        isUniversal: false
      },

      // ⚽ SPORTS
      { 
        name: 'ESPN', 
        url: 'https://www.espn.com/espn/rss/news',
        categories: ['sports', 'athletics', 'espn', 'football', 'basketball', 'baseball'],
        isUniversal: false
      },
      { 
        name: 'Bleacher Report', 
        url: 'https://bleacherreport.com/articles/feed',
        categories: ['sports', 'athletics', 'football', 'basketball', 'baseball'],
        isUniversal: false
      },
      { 
        name: 'BBC Sport', 
        url: 'http://feeds.bbci.co.uk/sport/rss.xml?edition=uk',
        categories: ['sports', 'athletics', 'football', 'soccer', 'rugby'],
        isUniversal: false
      },

      // 📱 SOCIAL MEDIA & VIRAL
      { 
        name: 'BuzzFeed News', 
        url: 'https://www.buzzfeed.com/world.xml',
        categories: ['viral', 'social media', 'trending', 'buzzfeed', 'popular'],
        isUniversal: false
      },
      { 
        name: 'Mashable Social Media', 
        url: 'https://mashable.com/feeds/rss/social-media',
        categories: ['social media', 'viral', 'trending', 'digital', 'internet'],
        isUniversal: false
      },

      // 🧘‍♀️ LIFESTYLE & WELLNESS
      { 
        name: 'MindBodyGreen', 
        url: 'https://www.mindbodygreen.com/rss',
        categories: ['wellness', 'health', 'lifestyle', 'mental health', 'mindfulness'],
        isUniversal: false
      },
      { 
        name: 'Healthline', 
        url: 'https://www.healthline.com/rss',
        categories: ['health', 'wellness', 'medical', 'lifestyle', 'fitness'],
        isUniversal: false
      },
      { 
        name: 'Lifehacker', 
        url: 'https://lifehacker.com/rss',
        categories: ['lifestyle', 'productivity', 'tips', 'technology', 'life'],
        isUniversal: false
      },

      // 🧑‍🏫 EDUCATION & CAREERS
      { 
        name: 'EdTech Magazine', 
        url: 'https://edtechmagazine.com/higher/rss.xml',
        categories: ['education', 'technology', 'learning', 'university', 'college'],
        isUniversal: false
      },
      { 
        name: 'Chronicle of Higher Education', 
        url: 'https://www.chronicle.com/section/Home/5',
        categories: ['education', 'university', 'college', 'academic', 'higher education'],
        isUniversal: false
      },
      { 
        name: 'Inside Higher Ed', 
        url: 'https://www.insidehighered.com/rss/news',
        categories: ['education', 'university', 'college', 'academic', 'higher education'],
        isUniversal: false
      },
      { 
        name: 'Harvard Business Review', 
        url: 'https://hbr.org/rss',
        categories: ['business', 'careers', 'management', 'leadership', 'harvard'],
        isUniversal: false
      },

      // 🚀 FUTURE / INNOVATION / AI
      { 
        name: 'MIT Technology Review', 
        url: 'https://www.technologyreview.com/feed/',
        categories: ['technology', 'ai', 'innovation', 'future', 'research', 'mit'],
        isUniversal: false
      },
      { 
        name: 'Futurism', 
        url: 'https://futurism.com/feed',
        categories: ['future', 'innovation', 'ai', 'technology', 'science', 'breakthrough'],
        isUniversal: false
      },
      { 
        name: 'Singularity Hub', 
        url: 'https://singularityhub.com/feed/',
        categories: ['ai', 'technology', 'future', 'innovation', 'science', 'robotics'],
        isUniversal: false
      },
      { 
        name: 'VentureBeat AI', 
        url: 'https://venturebeat.com/category/ai/feed/',
        categories: ['ai', 'technology', 'artificial intelligence', 'artificial', 'intelligence', 'machine learning', 'innovation'],
        isUniversal: false
      }
    ];
    
    // ENHANCED SMART FEED SELECTION - Works for any topic worldwide
    const topicLower = topic.toLowerCase();
    const searchTerms = topic.toLowerCase().split(' ');
    
    // COMPREHENSIVE TOPIC MAPPING for universal coverage
    const topicMapping = {
      // Business & Finance
      business: ['business', 'finance', 'financial', 'economy', 'market', 'stock', 'trading', 'investment', 'company', 'corporate', 'revenue', 'profit', 'earnings', 'bloomberg', 'cnbc', 'asx', 'nasdaq', 'dow', 'ftse', 'nikkei', 'ceo', 'ipo', 'acquisition', 'merger'],
      
      // Technology & Innovation  
      technology: ['technology', 'tech', 'ai', 'artificial intelligence', 'artificial', 'intelligence', 'machine learning', 'deep learning', 'neural network', 'software', 'hardware', 'digital', 'innovation', 'startup', 'silicon valley', 'app', 'platform', 'coding', 'programming', 'computer', 'internet', 'web', 'mobile', 'robot', 'automation', 'data', 'cloud', 'cryptocurrency', 'blockchain', 'algorithm', 'chatgpt', 'openai', 'claude', 'llm'],
      
      // Science & Health
      science: ['science', 'scientific', 'research', 'study', 'discovery', 'breakthrough', 'medicine', 'medical', 'health', 'treatment', 'disease', 'biology', 'physics', 'chemistry', 'laboratory', 'experiment', 'academic', 'university', 'nature', 'space', 'nasa', 'vaccine', 'clinical', 'genome', 'dna'],
      
      // Environment & Climate
      environment: ['environment', 'climate', 'green', 'sustainability', 'renewable', 'energy', 'solar', 'wind', 'carbon', 'emissions', 'pollution', 'conservation', 'ecology', 'earth', 'global warming', 'clean', 'electric', 'battery', 'fossil fuel', 'greenhouse'],
      
      // Politics & Government
      politics: ['politics', 'political', 'government', 'policy', 'election', 'voting', 'congress', 'senate', 'president', 'administration', 'white house', 'washington', 'legislation', 'law', 'regulation', 'democracy', 'campaign', 'diplomat', 'international', 'treaty'],
      
      // Entertainment & Culture
      entertainment: ['entertainment', 'movie', 'film', 'music', 'celebrity', 'culture', 'arts', 'theater', 'television', 'tv', 'show', 'hollywood', 'streaming', 'netflix', 'disney', 'concert', 'album', 'book', 'author', 'festival'],
      
      // Sports & Athletics
      sports: ['sports', 'sport', 'athletics', 'football', 'basketball', 'baseball', 'soccer', 'rugby', 'tennis', 'golf', 'olympics', 'championship', 'team', 'player', 'game', 'match', 'tournament', 'league', 'coach', 'athlete'],
      
      // Education & Learning
      education: ['education', 'school', 'university', 'college', 'learning', 'student', 'teacher', 'academic', 'curriculum', 'degree', 'scholarship', 'online learning', 'mooc', 'graduation'],
      
      // Lifestyle & Wellness
      lifestyle: ['lifestyle', 'wellness', 'fitness', 'nutrition', 'mental health', 'mindfulness', 'productivity', 'self-improvement', 'tips', 'diet', 'exercise', 'meditation', 'work-life balance'],
      
      // Social Media & Viral
      viral: ['viral', 'social media', 'trending', 'meme', 'twitter', 'facebook', 'instagram', 'tiktok', 'youtube', 'influencer', 'hashtag', 'content creator']
    };
    
    // Detect which main categories the topic belongs to
    let detectedCategories = [];
    for (const [mainCategory, relatedTerms] of Object.entries(topicMapping)) {
      const hasMatch = relatedTerms.some(term => 
        topicLower.includes(term) || searchTerms.some(keyword => keyword.includes(term) || term.includes(keyword))
      );
      if (hasMatch) {
        detectedCategories.push(mainCategory);
      }
    }
    
    console.log(`🔍 Topic "${topic}" detected categories:`, detectedCategories);
    
    // Select relevant feeds based on detected categories
    let categoryMatches = [];
    let universalFeeds = allRSSFeeds.filter(feed => feed.isUniversal);
    
    // Get feeds that match detected categories
    for (const feed of allRSSFeeds) {
      if (feed.isUniversal) continue;
      
      // Check if feed matches any detected category
      const feedMatches = detectedCategories.some(category => {
        const categoryTerms = topicMapping[category];
        return feed.categories.some(feedCat => 
          categoryTerms.some(term => feedCat.includes(term) || term.includes(feedCat))
        );
      });
      
      // Also check direct keyword matches
      const directMatch = feed.categories.some(category => 
        searchTerms.some(keyword => 
          keyword.includes(category) || category.includes(keyword)
        )
      );
      
      if (feedMatches || directMatch) {
        categoryMatches.push(feed);
      }
    }
    
    // Build final feed selection
    let selectedFeeds = [];
    
    if (categoryMatches.length > 0) {
      // Use 2-3 category-specific feeds + 2-3 universal feeds for breadth
      selectedFeeds = [...categoryMatches.slice(0, 3), ...universalFeeds.slice(0, 2)];
      console.log(`📊 Found ${categoryMatches.length} category-specific feeds:`, categoryMatches.map(f => f.name));
    } else {
      // No specific matches - use universal feeds plus some random category feeds for variety
      const randomCategoryFeeds = allRSSFeeds.filter(f => !f.isUniversal).slice(0, 2);
      selectedFeeds = [...universalFeeds, ...randomCategoryFeeds];
      console.log(`📰 No category matches - using universal feeds + random variety`);
    }
    
    // Randomize selection for variety on each search
    const seed = Date.now() % 1000000;
    const finalSelectedFeeds = selectedFeeds
      .sort((a, b) => (a.name.charCodeAt(0) * seed) - (b.name.charCodeAt(0) * seed))
      .slice(0, 5); // Use 5 feeds for better coverage
    
    console.log(`🎯 Topic analysis:`, { topic, topicLower, searchTerms, detectedCategories });
    console.log(`📊 Category-specific feeds found:`, categoryMatches.length);
    console.log(`🌍 Universal feeds available:`, universalFeeds.map(f => f.name));
    console.log(`🎲 Final selected RSS feeds for this search (${finalSelectedFeeds.length}):`, finalSelectedFeeds.map(f => f.name));
    
    let allNewsResults = [];
    
    console.log(`🚀 [VERCEL] STARTING RSS FEED PROCESSING WITH ${finalSelectedFeeds.length} SELECTED FEEDS:`);
    finalSelectedFeeds.forEach((feed, i) => console.log(`  ${i+1}. ${feed.name} (${feed.isUniversal ? 'UNIVERSAL' : 'CATEGORY-SPECIFIC'})`));
    
    // Vercel-specific: Process feeds in parallel with shorter timeouts
    const isVercel = process.env.VERCEL === '1';
    console.log(`🔧 [VERCEL] Environment: ${isVercel ? 'Vercel Serverless' : 'Local/Other'}`);
    
    if (isVercel) {
      console.log(`⚡ [VERCEL] Using optimized parallel processing for serverless environment`);
      
      // Process feeds in parallel for faster Vercel execution
      const feedPromises = finalSelectedFeeds.map(async (feed) => {
        try {
          console.log(`📡 [VERCEL-PARALLEL] Trying ${feed.name}: ${feed.url}`);
          
          const response = await axios.get(feed.url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
              'Accept': 'application/rss+xml, application/xml, text/xml, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cache-Control': 'no-cache'
            },
            timeout: 6000, // Shorter timeout for parallel requests
            maxRedirects: 3
          });
          
          const xml2js = require('xml2js');
          const parsed = await xml2js.parseStringPromise(response.data, { 
            trim: true, 
            explicitArray: false 
          });
          
          const items = parsed.rss?.channel?.item || [];
          const articles = Array.isArray(items) ? items : [items];
          
          // Process articles for this feed
          const relevantArticles = articles.filter(item => {
            const title = (item.title || '').toLowerCase();
            const description = (item.description || '').toLowerCase();
            const content = title + ' ' + description;
            
            // User keywords check
            if (keywordsList.length > 0) {
              const hasUserKeyword = keywordsList.some(keyword => content.includes(keyword));
              if (!hasUserKeyword) return false;
            }
            
            // Basic relevance check
            const topicMatches = searchTerms.some(term => term.length > 2 && content.includes(term));
            const categoryMatches = feed.categories ? feed.categories.some(category => content.includes(category)) : false;
            const isUniversalFeed = feed.isUniversal;
            
            const relevanceScore = isUniversalFeed ? 
              (topicMatches ? 1.0 : 0.4) : 
              (topicMatches || categoryMatches ? 1.0 : 0.1);
              
            return Math.random() < relevanceScore || topicMatches;
          }).slice(0, 3);
          
          const feedResults = relevantArticles.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.description || item.title?.substring(0, 150) + '...',
            source: feed.name,
            date: item.pubDate || new Date().toISOString(),
            thumbnail: null
          }));
          
          console.log(`✅ [VERCEL-PARALLEL] ${feed.name} found ${feedResults.length} articles`);
          return feedResults;
          
        } catch (error) {
          console.log(`❌ [VERCEL-PARALLEL] ${feed.name} failed: ${error.message}`);
          return [];
        }
      });
      
      // Wait for all feeds to complete (or timeout)
      const feedResults = await Promise.allSettled(feedPromises);
      
      // Combine all successful results
      feedResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value.length > 0) {
          allNewsResults = allNewsResults.concat(result.value);
          console.log(`✅ [VERCEL-PARALLEL] ${finalSelectedFeeds[index].name}: ${result.value.length} articles added`);
        }
      });
      
    } else {
      // Original sequential processing for local development
      for (const feed of finalSelectedFeeds) {
      try {
        console.log(`📡 [VERCEL] Trying ${feed.name}: ${feed.url}`);
        console.log(`⏰ [VERCEL] Request start time: ${new Date().toISOString()}`);
        
        const response = await axios.get(feed.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          },
          timeout: 8000, // Reduced for Vercel
          maxRedirects: 5,
          validateStatus: (status) => status < 500 // Accept 4xx but not 5xx
        });
        
        console.log(`✅ [VERCEL] ${feed.name} responded with status: ${response.status}`);
        
        const xml2js = require('xml2js');
        const parsed = await xml2js.parseStringPromise(response.data, { 
          trim: true, 
          explicitArray: false 
        });
        
        const items = parsed.rss?.channel?.item || [];
        const articles = Array.isArray(items) ? items : [items];
        
        // Universal filtering logic that works for any topic
        const relevantArticles = articles.filter(item => {
          const title = (item.title || '').toLowerCase();
          const description = (item.description || '').toLowerCase();
          const content = title + ' ' + description;
          
          // First check: If user specified required keywords, those must be present
          if (keywordsList.length > 0) {
            const hasUserKeyword = keywordsList.some(keyword => content.includes(keyword));
            if (!hasUserKeyword) {
              console.log(`❌ Article rejected (missing user keywords): "${title}"`);
              return false;
            }
          }
          
          // Second check: Exclude clearly spam/unrelated content
          const excludeTerms = ['advertisement', 'sponsored', 'premium subscription', 'paywall'];
          const isSpam = excludeTerms.some(term => content.includes(term));
          if (isSpam) {
            console.log(`❌ Article rejected (spam/promotional): "${title}"`);
            return false;
          }
          
          // Third check: Must match topic search terms or feed categories
          const topicMatches = searchTerms.some(term => term.length > 2 && content.includes(term));
          const categoryMatches = feed.categories ? feed.categories.some(category => content.includes(category)) : false;
          const isUniversalFeed = feed.isUniversal;
          
          // For universal feeds, be more lenient with topic matching
          const relevanceScore = isUniversalFeed ? 
            (topicMatches ? 1.0 : 0.3) : // Universal feeds: accept if topic matches, otherwise 30% chance
            (topicMatches || categoryMatches ? 1.0 : 0.1); // Category feeds: must match topic or category
          
          const isRelevant = Math.random() < relevanceScore || topicMatches;
          
          if (isRelevant) {
            console.log(`✅ Article accepted: "${title}" (${feed.isUniversal ? 'universal' : 'category'} feed)`);
          }
          return isRelevant;
        }).slice(0, 3); // Max 3 articles per feed for better variety
        
        const feedResults = relevantArticles.map(item => ({
          title: item.title,
          link: item.link,
          snippet: item.description || item.title?.substring(0, 150) + '...',
          source: feed.name,
          date: item.pubDate || new Date().toISOString(),
          thumbnail: null
        }));
        
        allNewsResults = allNewsResults.concat(feedResults);
        console.log(`📊 ${feed.name} found ${feedResults.length} relevant articles`);
        
        feedResults.forEach((article, i) => {
          console.log(`📄 - ${article.title}`);
        });
        
              } catch (feedError) {
          console.log(`❌ [VERCEL] ${feed.name} RSS failed: ${feedError.message}`);
          console.log(`❌ [VERCEL] Error code: ${feedError.code || 'Unknown'}`);
          console.log(`❌ [VERCEL] Status: ${feedError.response?.status || 'No response'}`);
          console.log(`❌ [VERCEL] URL: ${feed.url}`);
          continue;
        }
      }
    } // End of Vercel vs local processing
    
    // Only use Google News if we have ZERO articles from premium sources
    if (allNewsResults.length === 0) {
      console.log(`📰 No articles from premium RSS feeds, trying Google News RSS as final fallback...`);
      try {
        const googleResults = await searchGoogleNewsRSS(topic, Math.min(maxResults, 3));
        allNewsResults = allNewsResults.concat(googleResults);
        console.log(`📊 Google News fallback found ${googleResults.length} articles`);
      } catch (googleError) {
        console.log(`⚠️ Google News fallback failed: ${googleError.message}`);
      }
    } else {
      console.log(`✅ Successfully found ${allNewsResults.length} articles from premium RSS sources - no fallback needed!`);
    }
    
    // Remove duplicates and limit results
    const uniqueResults = allNewsResults.filter((article, index, self) => 
      index === self.findIndex(a => a.link === article.link)
    ).slice(0, maxResults);
    
    console.log(`📊 Total found ${uniqueResults.length} news articles from direct RSS feeds`);
    uniqueResults.forEach((article, i) => {
      console.log(`📄 ${i+1}. ${article.title} - ${article.source}`);
    });
    
    return uniqueResults;
    
  } catch (error) {
    console.error('❌ Direct RSS search failed:', error.message);
    
    // Final fallback to original Google News method
    try {
      console.log('🔄 Trying Google News RSS as final fallback...');
      return await searchGoogleNewsRSS(topic, maxResults);
    } catch (rssError) {
      console.error('❌ Final RSS fallback also failed:', rssError.message);
      return [];
    }
  }
}

// Helper function to extract domain from URL
function extractDomainFromUrl(url) {
  try {
    const domain = new URL(url).hostname;
    return domain.replace('www.', '');
  } catch {
    return 'Unknown Source';
  }
}

// US RSS Fallback for Google News
async function searchGoogleNewsRSS(topic, maxResults = 5) {
  try {
    console.log(`📡 Searching US Google News RSS for: "${topic}"`);
    
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en&gl=us&ceid=US:en`;
    
    const response = await axios.get(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml'
      },
      timeout: 10000
    });
    
    const xml2js = require('xml2js');
    const parsed = await xml2js.parseStringPromise(response.data, { 
      trim: true, 
      explicitArray: false 
    });
    
    const items = parsed.rss?.channel?.item || [];
    const articles = Array.isArray(items) ? items : [items];
    
    const newsResults = articles.slice(0, maxResults).map(item => {
      // Extract clean URL (Google News sometimes wraps URLs)
      let cleanUrl = item.link;
      if (cleanUrl && cleanUrl.includes('news.google.com/articles/')) {
        // Try to extract original URL from Google News redirect
        try {
          const urlParams = new URLSearchParams(cleanUrl.split('?')[1]);
          const originalUrl = urlParams.get('url');
          if (originalUrl) {
            cleanUrl = decodeURIComponent(originalUrl);
          }
        } catch (e) {
          // Keep original URL if extraction fails
        }
      }
      
      // Extract source from item.source or fallback to domain
      const source = item.source?._ || item.source || extractDomainFromUrl(cleanUrl);
      
      // Clean up title (remove source prefix if present)
      let cleanTitle = item.title;
      if (typeof cleanTitle === 'string' && source) {
        const sourcePrefix = source.split('.')[0];
        if (cleanTitle.startsWith(`${sourcePrefix} - `)) {
          cleanTitle = cleanTitle.replace(`${sourcePrefix} - `, '');
        }
      }
      
      return {
        title: cleanTitle,
        link: cleanUrl,
        snippet: item.description || cleanTitle.substring(0, 150) + '...',
        source: source,
        date: item.pubDate || new Date().toISOString(),
        thumbnail: null
      };
    }).filter(article => article.title && article.link);
    
    console.log(`📡 US RSS found ${newsResults.length} news articles`);
    return newsResults;
    
  } catch (error) {
    console.error('❌ US RSS search failed:', error.message);
    return [];
  }
}

// Process news articles using Mercury Parser
async function processNewsArticles(newsResults, originalTopic, maxSources = 5) {
  const researchData = [];
  const processedUrls = new Set();
  
  console.log(`📄 Processing ${Math.min(newsResults.length, maxSources)} news articles`);
  
  for (let i = 0; i < Math.min(newsResults.length, maxSources); i++) {
    const article = newsResults[i];
    
    if (!article.link || processedUrls.has(article.link)) {
      continue;
    }
    
    try {
      console.log(`📄 Processing: ${article.title}`);
      console.log(`📄 URL: ${article.link}`);
      console.log(`📄 Source: ${article.source}`);
      processedUrls.add(article.link);
      
      // Extract full article content using Mercury Parser
      const fullContent = await extractArticleContent(article.link);
      if (!fullContent || fullContent.length < 50) {
        console.log(`⏭️ Skipping - no readable content (${fullContent?.length || 0} chars)`);
        continue;
      }
      
      // Validate that content is actually relevant to the topic before summarizing
      const contentLower = fullContent.toLowerCase();
      const topicLower = originalTopic.toLowerCase();
      const topicTerms = topicLower.split(' ').filter(term => term.length > 2);
      
      // Check if article content actually relates to the topic
      const relevanceScore = topicTerms.filter(term => contentLower.includes(term)).length / topicTerms.length;
      
      // For very specific topics like "ASX IPO listings", be more flexible with relevance
      const isSpecificTopic = topicLower.includes('ipo') || topicLower.includes('listing') || topicLower.includes('asx');
      const minRelevance = isSpecificTopic ? 0.15 : 0.3; // Lower threshold for specific topics
      
      if (relevanceScore < minRelevance) {
        console.log(`⏭️ Skipping - content not relevant to topic (${Math.round(relevanceScore * 100)}% match, need ${Math.round(minRelevance * 100)}%)`);
        continue;
      }
      
      console.log(`✅ Content relevance: ${Math.round(relevanceScore * 100)}% (threshold: ${Math.round(minRelevance * 100)}%)`);
      
      // Additional check for financial topics
      if (topicLower.includes('ipo') || topicLower.includes('asx') || topicLower.includes('listing')) {
        const hasFinancialContent = ['ipo', 'asx', 'listing', 'stock', 'shares', 'market', 'flotation', 'public offering'].some(term => contentLower.includes(term));
        if (!hasFinancialContent) {
          console.log(`⏭️ Skipping - no financial content detected in article`);
          continue;
        }
      }

      // Summarize content relevant to original topic
      const summary = await summarizeWebContent(fullContent, originalTopic);
      if (!summary || summary.length < 10) {
        console.log(`⏭️ Skipping - no meaningful summary`);
        continue;
      }
      
      researchData.push({
        title: article.title,
        url: article.link,
        snippet: article.snippet,
        summary: summary,
        source: article.source,
        publishedAt: article.date || new Date().toISOString(),
        contentLength: fullContent.length,
        thumbnail: article.thumbnail
      });
      
      console.log(`✅ Successfully processed: ${article.title} (${fullContent.length} chars, ${summary.length} char summary)`);
      
    } catch (error) {
      console.warn(`⚠️ Failed to process ${article.link}:`, error.message);
      continue;
    }
  }
  
  console.log(`🎯 Final research data: ${researchData.length} high-quality articles processed`);
  
  // If no specific matches found, try broader search for very specific topics
  if (researchData.length === 0) {
    console.log('⚠️ No specific research data found, trying broader search...');
    
    // Try again with broader terms for very specific topics
    const broaderTerms = originalTopic.toLowerCase().includes('ipo') ? 
      ['asx', 'stock market', 'australian companies', 'shares', 'investment'] :
      originalTopic.toLowerCase().split(' ').filter(term => term.length > 3).slice(0, 3);
      
    console.log(`🔍 Searching with broader terms: ${broaderTerms.join(', ')}`);
    
    // Retry with lower relevance threshold for broader search  
    for (const article of newsResults.slice(0, 3)) { // Try top 3 articles again
      try {
        const fullContent = await extractArticleContent(article.link || article.url);
        if (!fullContent || fullContent.length < 100) continue;
        
        // Lower relevance threshold for broader search (20% instead of 30%)
        const contentLower = fullContent.toLowerCase();
        const relevanceScore = broaderTerms.filter(term => contentLower.includes(term)).length / broaderTerms.length;
        
        if (relevanceScore >= 0.2) { // 20% match for broader search
          console.log(`📰 Including broader content (${Math.round(relevanceScore * 100)}% match): ${article.title}`);
          
          // Summarize content with broader context
          const summary = await summarizeWebContent(fullContent, `ASX market and ${originalTopic}`);
          if (summary && summary.length > 10) {
            researchData.push({
              url: article.link || article.url,
              title: article.title,
              summary: summary,
              publishedAt: article.publishedAt || article.pubDate || new Date().toISOString(),
              source: article.source || extractDomainFromUrl(article.link || article.url),
              contentLength: fullContent.length,
              searchType: 'broader_match'
            });
            
            console.log(`✅ Successfully processed broader match: ${article.title} (${fullContent.length} chars, ${summary.length} char summary)`);
            
            // Stop after finding 1-2 broader matches to avoid irrelevant content
            if (researchData.length >= 2) break;
          }
        }
      } catch (error) {
        console.warn(`⚠️ Error processing broader search for ${article.title}:`, error.message);
        continue;
      }
    }
    
    if (researchData.length > 0) {
      console.log(`✅ Found ${researchData.length} articles with broader search`);
    } else {
      console.log('⚠️ No research data found even with broader search');
    }
  }
  
  return researchData;
}

// Smart Google News URL resolver with base64 decoding + Puppeteer fallback
async function resolveFinalUrl(googleUrl) {
  try {
    console.log(`🔗 Resolving redirect URL: ${googleUrl.substring(0, 100)}...`);
    
    // For Google News RSS URLs, try to decode the base64 encoded URL first
    if (googleUrl.includes('news.google.com/rss/articles/')) {
      try {
        // Extract the base64 encoded part from the URL
        const urlMatch = googleUrl.match(/articles\/([^?]+)/);
        if (urlMatch && urlMatch[1]) {
          const encodedPart = urlMatch[1];
          console.log(`🧩 Attempting to decode base64 URL: ${encodedPart.substring(0, 50)}...`);
          
          try {
            // Try to decode as base64
            const decoded = Buffer.from(encodedPart, 'base64').toString('utf-8');
            console.log(`🔍 Decoded content: ${decoded.substring(0, 100)}...`);
            
            // Look for URL patterns in the decoded content
            const urlPattern = /https?:\/\/[^\s"]+/g;
            const urls = decoded.match(urlPattern);
            
            if (urls && urls.length > 0) {
              const realUrl = urls.find(url => 
                !url.includes('google.com') && 
                !url.includes('youtube.com') &&
                (url.includes('.com') || url.includes('.au') || url.includes('.org'))
              );
              
              if (realUrl) {
                console.log(`✅ Decoded real URL: ${realUrl}`);
                return realUrl;
              }
            }
          } catch (decodeError) {
            console.log(`⚠️ Base64 decode failed: ${decodeError.message}`);
          }
        }
        
        // If base64 decoding fails, try the traditional redirect approach
        console.log(`🔄 Trying redirect resolution...`);
        let currentUrl = googleUrl;
        let attempts = 0;
        const maxAttempts = 5; // Reduced attempts
        
        while (attempts < maxAttempts && currentUrl.includes('news.google.com')) {
          attempts++;
          console.log(`🔄 Redirect attempt ${attempts}: ${currentUrl.substring(0, 80)}...`);
          
          const response = await axios.get(currentUrl, {
            maxRedirects: 3,
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          
          const finalUrl = response.request?.res?.responseUrl || response.config.url;
          if (!finalUrl.includes('news.google.com')) {
            console.log(`✅ Resolved via redirect: ${finalUrl}`);
            return finalUrl;
          }
          
          break; // Don't loop if we're still on Google
        }
        
        console.log(`⚠️ Could not resolve Google News URL, will use Puppeteer fallback`);
        return googleUrl; // Return original URL for Puppeteer extraction
        
      } catch (error) {
        console.warn(`⚠️ Failed to resolve Google redirect: ${error.message}`);
        return googleUrl;
      }
    }
    
    return googleUrl; // Return as-is if not a Google News URL
    
  } catch (error) {
    console.warn(`⚠️ URL resolution failed: ${error.message}`);
    return googleUrl;
  }
}

// Extract article content using Mercury Parser + Puppeteer fallback
async function extractArticleContent(url) {
  try {
    // First resolve the actual URL if it's a Google News redirect
    const resolvedUrl = await resolveFinalUrl(url);
    console.log(`🌐 Extracting content from: ${resolvedUrl}`);
    
    // Use our improved article extraction API for all URLs
    console.log(`🌐 Local article extraction from: ${resolvedUrl}`);
    try {
      const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
      const apiUrl = `${baseUrl}/api/extract-article?url=${encodeURIComponent(resolvedUrl)}`;
      
      const response = await axios.get(apiUrl, { timeout: 20000 });
      
      if (response.data.success && response.data.content) {
        console.log(`✅ Local extraction successful: ${response.data.contentLength} characters from ${response.data.title || 'article'}`);
        return response.data.content;
      } else {
        console.log(`⚠️ Local extraction failed: ${response.data.error}`);
        // Continue to Mercury Parser fallback
      }
    } catch (extractionError) {
      console.warn(`⚠️ Local extraction API failed: ${extractionError.message}`);
      // Continue to Mercury Parser fallback
    }
    
    // For regular URLs, use Mercury Parser first
    try {
      // First fetch the HTML manually for better control
      const response = await axios.get(resolvedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Cache-Control': 'no-cache'
        },
        timeout: 15000
      });
      
      // Use JSDOM for better Mercury compatibility
      const { JSDOM } = require('jsdom');
      const dom = new JSDOM(response.data, { url: resolvedUrl });
      
      // Import Mercury Parser (now @postlight/parser)
      const Mercury = require('@postlight/parser');
      
      const result = await Mercury.parse(resolvedUrl, {
        html: dom.serialize()
      });
      
      if (result && result.content && result.content.length > 100) {
        // Clean HTML and extract text
        const cheerio = require('cheerio');
        const $ = cheerio.load(result.content);
        
        // Remove unwanted elements
        $('script, style, nav, header, footer, aside, .advertisement, .ads, .paywall, .subscribe').remove();
        
        const textContent = $.text()
          .replace(/\s+/g, ' ')
          .replace(/\n\s*\n/g, '\n')
          .trim();
        
        if (textContent.length > 200) {
          console.log(`✅ Mercury extracted ${textContent.length} characters from ${resolvedUrl}`);
          return textContent;
        }
      }
      
      console.log(`⚠️ Mercury Parser returned insufficient content, trying Puppeteer...`);
      
      // Mercury failed, fallback handled by main extraction above - skip duplicate API call
      
      // Final fallback: direct HTML parsing with common selectors
      console.log(`⚠️ Trying direct HTML parsing fallback...`);
      const cheerio = require('cheerio');
      const $ = cheerio.load(response.data);
      
      // Remove unwanted elements first
      $('script, style, nav, header, footer, aside, .advertisement, .ads, .paywall, .subscribe, .social-share').remove();
      
      // Try to extract main content using common selectors
      const contentSelectors = [
        'article .article-content',
        'article .content',
        'article .entry-content', 
        'article .post-content',
        'article',
        '.article-body',
        '.story-content',
        '.story-body',
        '.content-body',
        '.post-body',
        'main article',
        'main .content',
        '.main-content',
        '#article-content',
        '#story-content'
      ];
      
      let content = '';
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length) {
          const text = element.text().trim();
          if (text.length > 200 && text.length > content.length) {
            content = text;
          }
        }
      }
      
      if (content.length > 200) {
        const cleanContent = content
          .replace(/\s+/g, ' ')
          .replace(/\n\s*\n/g, '\n')
          .trim()
          .substring(0, 3000); // Limit to 3000 chars for fallback
          
        console.log(`✅ HTML fallback extracted ${cleanContent.length} characters from ${resolvedUrl}`);
        return cleanContent;
      }
      
      console.log(`⚠️ No sufficient content found for ${resolvedUrl}`);
      return null;
      
    } catch (error) {
      console.warn(`⚠️ Failed to extract content from ${url}:`, error.message);
      return null;
    }
    
  } catch (error) {
    console.warn(`⚠️ Failed to extract content from ${url}:`, error.message);
    return null;
  }
}

async function generateSearchTerms(topic) {
  try {
    const prompt = `Generate 4 specific search terms for finding recent news articles about: "${topic}"

Requirements:
- Include specific company names, terms, and keywords from the topic
- Add news source keywords: "AFR", "Reuters", "Forbes", "news", "article"
- Consider different angles: listings, IPOs, announcements, analysis, reports
- Include Australian financial sources for ASX topics
- Focus on recent developments and make terms very specific
- Separate each term with a comma

Examples:
Input: "ASX IPO listings"
Output: Virgin Australia IPO AFR news 2024, ASX IPO listings Reuters article, upcoming Australian IPO Forbes, ASX stock market flotation news

Input: "AI in healthcare"
Output: AI healthcare breakthrough news article, medical AI technology Reuters 2024, healthcare artificial intelligence Forbes, AI medical startup funding news

Generate search terms for: "${topic}"`;

    const response = await callOpenAI(prompt, 'research_helper');
    const searchTerms = response.split(',').map(term => term.trim()).filter(term => term.length > 0);
    
    // Enhanced search terms with news source targeting
    const newsSourceTerms = [
      `"${topic}" site:afr.com OR site:reuters.com OR site:forbes.com.au`,
      `${topic} news 2024 OR 2025`,
      `${topic} article announcement`,
      `${topic} latest development report`
    ];
    
    // Combine AI-generated terms with news source specific terms
    const allTerms = [...searchTerms.slice(0, 2), ...newsSourceTerms.slice(0, 2)];
    
    return allTerms.slice(0, 4); // Limit to 4 terms to avoid rate limits
  } catch (error) {
    console.warn('⚠️ Failed to generate search terms, using fallback terms');
    return [
      `"${topic}" site:afr.com OR site:reuters.com OR site:forbes.com.au`,
      `${topic} news 2024`,
      `${topic} article announcement`, 
      `${topic} latest development`
    ];
  }
}

async function performGoogleSearch(searchTerm, depth = 5) {
  try {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
    
    if (!googleApiKey || !searchEngineId) {
      throw new Error('Google API credentials not configured');
    }

    console.log(`🔍 Searching Google for: "${searchTerm}"`);
    
    // Enhanced search parameters targeting news content
    const searchParams = {
      key: googleApiKey,
      cx: searchEngineId,
      q: searchTerm, // Clean search term
      sort: 'date',
      num: Math.min(depth, 10), // Google API limit is 10
      dateRestrict: 'd180', // Last 6 months for more content
      safe: 'off', // Don't filter results
      cr: 'countryAU', // Focus on Australian content for ASX
      lr: 'lang_en', // English language
      gl: 'au' // Australian search results
    };
    
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: searchParams
    });

    let items = response.data.items || [];
    
    // Very minimal filtering - only exclude obvious junk
    items = items.filter(item => {
      const url = item.link.toLowerCase();
      
      // Only exclude very obvious non-articles
      const excludePatterns = [
        'news.google.com/home',
        'google.com/search',
        'youtube.com/watch'
      ];
      
      const isJunk = excludePatterns.some(pattern => url.includes(pattern));
      
      // Accept almost everything - very permissive
      return !isJunk && item.link && item.title && item.snippet;
    });

    console.log(`📊 Filtered ${items.length} relevant results from ${response.data.items?.length || 0} total results`);

    if (items.length === 0) {
      // Try broader search with less restrictive filtering
      console.log('🔄 Trying broader search with relaxed filters...');
      searchParams.q = `${searchTerm} article news`;
      searchParams.dateRestrict = 'd90'; // Expand to 90 days
      
      const broadResponse = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: searchParams
      });
      
      if (broadResponse.data.items) {
        items = broadResponse.data.items.filter(item => {
          const url = item.link.toLowerCase();
          return !url.includes('news.google.com') && !url.includes('/home');
        });
      }
    }

    return items;
  } catch (error) {
    console.error(`❌ Google search failed for "${searchTerm}":`, error.message);
    return [];
  }
}

async function processWebContent(searchResults, originalTopic, maxSources = 5) {
  const researchData = [];
  const processedUrls = new Set(); // Avoid duplicates
  
  // Minimal filtering - accept almost everything
  const filteredResults = searchResults.filter(item => {
    if (!item.link || processedUrls.has(item.link)) return false;
    
    const url = item.link.toLowerCase();
    
    // Only skip obvious non-content
    const skipPatterns = [
      'news.google.com/home',
      'google.com/search', 
      'youtube.com/watch'
    ];
    
    const shouldSkip = skipPatterns.some(pattern => url.includes(pattern));
    if (shouldSkip) {
      console.log(`⏭️ Skipping non-article: ${item.title}`);
      return false;
    }
    
    // Accept basically everything else
    return item.title && item.link;
  });
  
  console.log(`📊 Filtered to ${filteredResults.length} quality sources from ${searchResults.length} total results`);
  
  // Sort by relevance/recency and take top results
  const topResults = filteredResults.slice(0, maxSources);
  
  for (const item of topResults) {
    try {
      console.log(`📄 Processing: ${item.title}`);
      console.log(`📄 URL: ${item.link}`);
      console.log(`📄 Source: ${item.displayLink || 'Unknown'}`);
      processedUrls.add(item.link);
      
      // Scrape webpage content
      const webContent = await scrapeWebContent(item.link);
      if (!webContent || webContent.length < 50) {
        console.log(`⏭️ Skipping - no readable content (${webContent?.length || 0} chars)`);
        continue;
      }
      
      // Summarize content relevant to original topic
      const summary = await summarizeWebContent(webContent, originalTopic);
      if (!summary || summary.length < 10) {
        console.log(`⏭️ Skipping - no meaningful summary`);
        continue;
      }
      
      // Extract publish date more intelligently
      let publishedAt = new Date().toISOString();
      if (item.pagemap?.metatags?.[0]) {
        const meta = item.pagemap.metatags[0];
        publishedAt = meta['article:published_time'] || 
                     meta['article:published'] ||
                     meta['datePublished'] ||
                     meta['publishedDate'] ||
                     publishedAt;
      }
      
      researchData.push({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        summary: summary,
        source: item.displayLink || new URL(item.link).hostname,
        publishedAt: publishedAt,
        contentLength: webContent.length
      });
      
      console.log(`✅ Successfully processed: ${item.title} (${webContent.length} chars, ${summary.length} char summary)`);
      
    } catch (error) {
      console.warn(`⚠️ Failed to process ${item.link}:`, error.message);
      continue;
    }
  }
  
  console.log(`🎯 Final research data: ${researchData.length} high-quality sources processed`);
  return researchData;
}

async function scrapeWebContent(url, maxTokens = 50000) {
  try {
    console.log(`🌐 Scraping content from: ${url}`);
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    
    const response = await axios.get(url, { 
      headers,
      timeout: 10000,
      maxRedirects: 5
    });
    
    // Parse HTML content
    const $ = cheerio.load(response.data);
    
    // Remove scripts, styles, and other non-content elements
    $('script, style, nav, header, footer, aside, .advertisement, .ads, .sidebar').remove();
    
    // Extract main content - try common content selectors
    let content = '';
    const contentSelectors = [
      'article',
      '[role="main"]',
      '.content',
      '.post-content', 
      '.entry-content',
      '.article-content',
      'main',
      '.main-content'
    ];
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        content = element.text();
        break;
      }
    }
    
    // Fallback to body if no specific content found
    if (!content || content.length < 100) {
      content = $('body').text();
    }
    
    // Clean and truncate content
    content = content
      .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
      .replace(/\n\s*\n/g, '\n') // Remove empty lines
      .trim();
    
    // Truncate to token limit (approximate)
    const characters = maxTokens * 4;
    if (content.length > characters) {
      content = content.substring(0, characters) + '...';
    }
    
    console.log(`✅ Scraped ${content.length} characters from ${url}`);
    return content;
    
  } catch (error) {
    console.warn(`⚠️ Failed to scrape ${url}:`, error.message);
    return null;
  }
}

async function summarizeWebContent(content, originalTopic, characterLimit = 800) {
  try {
    const prompt = `You are an AI research assistant. Analyze the following web content and determine if it has business/financial relevance to "${originalTopic}".

For specific topics like "ASX IPO listings 2025", be flexible and accept related business content about:
- ASX stock market news and analysis
- Australian business/corporate developments  
- Investment and trading topics
- Financial market insights
- Company announcements and business news

ONLY respond with "IRRELEVANT CONTENT" if the content is completely unrelated to business/finance (e.g., sports, entertainment, unrelated politics).

If the content has ANY business/financial relevance, provide a summary with these requirements:
- Focus on insights, data, trends, and key points that could relate to "${originalTopic}"
- Maximum ${characterLimit} characters
- Use clear, professional language suitable for LinkedIn content
- Include specific facts, statistics, or quotes if available
- Ignore irrelevant content like navigation, ads, or unrelated topics

Web Content:
${content}

Response:`;

    const response = await callOpenAI(prompt, 'research_summarizer');
    
    // Check if content was deemed irrelevant
    if (response.trim() === "IRRELEVANT CONTENT") {
      console.log(`⏭️ AI determined content is irrelevant to topic`);
      return null;
    }
    
    // Ensure we don't exceed character limit
    const summary = response.length > characterLimit ? 
      response.substring(0, characterLimit - 3) + '...' : response;
    
    return summary;
    
  } catch (error) {
    console.error('❌ Content summarization failed:', error);
    return null;
  }
}

async function generateRAGPost(researchData, topic, tone, length = 'medium', engagementOptions = {}) {
  try {
    console.log(`🎯 Generating RAG post from ${researchData.length} research sources`);
    
    // Prepare research context with quotes for better authenticity
    const researchContext = researchData.map((item, index) => {
      // Extract potential quotes from the summary (look for sentences with specific data/insights)
      const sentences = item.summary.split('.').filter(s => s.trim().length > 20);
      const bestQuote = sentences.find(s => 
        s.includes('$') || s.includes('%') || s.includes('million') || s.includes('billion') ||
        s.toLowerCase().includes('according to') || s.toLowerCase().includes('report') ||
        s.toLowerCase().includes('data') || s.toLowerCase().includes('analysis')
      ) || sentences[0];
      
      return `Source ${index + 1}: ${item.title}
Summary: ${item.summary}
Key Quote: "${bestQuote.trim()}."
Source: ${item.source}
URL: ${item.url}`;
    }).join('\n\n');
    
    const lengthGuide = {
      short: '50-100 words, punchy and direct',
      medium: '100-200 words, balanced with insights',
      long: '200-300 words, comprehensive analysis'
    };
    
    let prompt = `Create a LinkedIn post about "${topic}" based on the following research data:

${researchContext}

Instructions:
- Synthesize insights from multiple sources into one cohesive post
- Include 1-2 specific quotes from the sources in italics using *text* format
- Include specific data points, trends, or insights from the research
- Write in ${tone} tone
- Length: ${lengthGuide[length] || lengthGuide.medium}
- Format for LinkedIn with appropriate line breaks
- Don't use hashtags (LinkedIn algorithm doesn't favor them)
- Make it engaging and valuable for a professional audience
- Use italics (*text*) for direct quotes to add credibility`;

    // Add engagement options
    if (engagementOptions.curiosity_hook) {
      prompt += `\n- Start with an attention-grabbing hook or surprising insight`;
    }
    
    if (engagementOptions.strong_opinion) {
      prompt += `\n- Include a thought-provoking perspective or contrarian view`;
    }
    
    if (engagementOptions.soft_cta) {
      prompt += `\n- End with a question to encourage engagement`;
    }

    prompt += `\n\nGenerate the LinkedIn post:`;

    let post = await callOpenAI(prompt, 'research_post');
    
    // Clean markdown formatting
    post = post.replace(/\*\*(.*?)\*\*/g, '$1');
    post = post.replace(/\*(.*?)\*/g, '$1');
    post = post.replace(/__(.*?)__/g, '$1');
    post = post.replace(/_(.*?)_/g, '$1');
    
    return {
      post: post,
      research_sources: researchData,
      post_type: 'research_based',
      topic: topic
    };
    
  } catch (error) {
    console.error('❌ RAG post generation failed:', error);
    throw error;
  }
}

// Get authentication status
app.get('/api/auth/status', async (req, res) => {
  try {
    const token = extractJWTFromRequest(req);
    
    if (!token) {
      return res.json({ authenticated: false });
    }

    const decoded = verifyJWT(token);
    if (!decoded) {
      return res.json({ authenticated: false });
    }

    // Get user data including credits
    const user = await UserDB.getUserById(decoded.id);
    if (!user) {
      return res.json({ authenticated: false });
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        profile_picture: user.profile_url,
        credits: user.credits || 0
      }
    });
  } catch (error) {
    console.error('❌ Error checking auth status:', error);
    res.json({ authenticated: false });
  }
});