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

// Import our modules
const { initializeDatabase, UserDB, PreferencesDB, PostsDB, SubscriptionDB, UsageDB, AccessKeysDB, pool } = require('./database');
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
          headline: user.headline || 'Professional'
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
    
    if (!signature) {
      return res.status(400).json({ error: 'Missing Stripe signature' });
    }

    await stripeService.handleWebhook(req.body, signature);
    res.json({ received: true });
  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    res.status(400).json({ error: 'Webhook processing failed' });
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
    const expectedPassword = process.env.ADMIN_PASSWORD || 'postpilot-admin-2024';
    
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
    const expectedPassword = process.env.ADMIN_PASSWORD || 'postpilot-admin-2024';
    
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
    const expectedPassword = process.env.ADMIN_PASSWORD || 'postpilot-admin-2024';
    
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

// Admin page route - password protected
app.get('/admin', (req, res) => {
  console.log('👑 Admin route hit');
  
  // Simple password protection - check for admin password in query parameter
  const adminPassword = req.query.key;
  const expectedPassword = process.env.ADMIN_PASSWORD || 'postpilot-admin-2024';
  
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
    
    // Check usage limits for authenticated users
    const usageCheck = await UsageDB.checkUsageLimit(userId);
    if (!usageCheck.hasAccess) {
      return res.status(403).json({
        error: 'Usage limit exceeded',
        reason: usageCheck.reason,
        postsRemaining: usageCheck.postsRemaining,
        needsUpgrade: true
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
        result = await generateViralPost(topic, tone, length, mappedFormatId, engagement_options);
        break;
      case 'tweet':
        result = await repurposeTweet(tweet_text || topic, topic, tone, length);
        break;
      case 'manual':
        result = await generateManualPost(custom_content || topic, tone, length, engagement_options);
        break;
      case 'news':
      default:
        result = await generatePost(topic, tone, length, engagement_options);
        break;
    }

    // Track usage for the authenticated user
    await UsageDB.trackUsage(userId, 'post_generation', estimatedCost, estimatedTokens, {
      topic,
      tone,
      length,
      post_type,
      viral_format,
      article_source: result.article?.source,
      timestamp: new Date().toISOString()
    });
    
    console.log(`💰 Tracked usage for user ${userId}: $${estimatedCost} (${post_type})`);

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
    // Step 1: Fetch recent news articles
    const articles = await fetchNewsArticles(topic);
    
    if (!articles || articles.length === 0) {
      throw new Error('No articles found for the given topic');
    }

    // Step 2: Select a good article with randomization
    const selectedArticle = selectBestArticle(articles);
    
    if (!selectedArticle) {
      throw new Error('No suitable article found');
    }

    // Step 3: Generate LinkedIn post with engagement options
    const post = await generateLinkedInPost(selectedArticle, topic, tone, length, engagementOptions);
    
    // Step 4: Fetch relevant image (only if requested)
    const image = engagementOptions.include_image !== false ? await fetchRelevantImage(topic) : null;
    
    return {
      post: post,
      article: {
        title: selectedArticle.title,
        url: cleanUrl(selectedArticle.url) || selectedArticle.url,
        source: selectedArticle.source?.name || 'News Source',
        publishedAt: selectedArticle.publishedAt
      },
      image: image,
      post_type: 'news'
    };
  } catch (error) {
    console.error('❌ Error in generatePost:', error);
    throw error;
  }
}

// Generate viral format posts without news dependency
async function generateViralPost(topic, tone, length, viralFormatId, engagementOptions) {
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
async function generateManualPost(customContent, tone, length, engagementOptions) {
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

  throw new Error('Failed to fetch articles from any news source');
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
      manual_content: 'You are a professional content creator who transforms ideas and raw content into polished, engaging LinkedIn posts.'
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
    
    // Check usage limits
    const usageCheck = await UsageDB.checkUsageLimit(userId);
    if (!usageCheck.hasAccess) {
      return res.status(403).json({
        error: 'Usage limit exceeded',
        reason: usageCheck.reason,
        postsRemaining: usageCheck.postsRemaining,
        needsUpgrade: true
      });
    }

    const result = await repurposeTweet(tweet_text, topic, tone, length);

    // Track usage
    await UsageDB.trackUsage(userId, 'post_generation', 0.00136, 1200, {
      topic,
      tone,
      length,
      post_type: 'repurposed_tweet',
      timestamp: new Date().toISOString()
    });

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

    console.log(`🤖 Generated ${queue.length} posts for automation queue`);
    res.json({ success: true, generated: queue.length, queue });
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
    <title>PostPilot - Database Migration</title>
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
        <h1>🚀 PostPilot Database Migration</h1>
        
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