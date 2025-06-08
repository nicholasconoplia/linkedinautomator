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

// Import our modules
const { initializeDatabase, UserDB, PreferencesDB, PostsDB } = require('./database');
const LinkedInService = require('./linkedin-service');
const PostScheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'"]
    },
  },
}));

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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
    
    // Override the profile URL to use the modern OpenID Connect userinfo endpoint
    this.profileUrl = 'https://api.linkedin.com/v2/userinfo';
    this.emailUrl = null; // Email is included in userinfo response
  };
  
  // Inherit from LinkedInStrategy
  require('util').inherits(LinkedInOIDCStrategy, require('passport-linkedin-oauth2').Strategy);
  
  // Override the userProfile method to use the new endpoint
  LinkedInOIDCStrategy.prototype.userProfile = function(accessToken, done) {
    this._oauth2.setAccessTokenName("oauth2_access_token");
    
    this._oauth2.get(this.profileUrl, accessToken, function (err, body, res) {
      if (err) {
        console.error('❌ LinkedIn API Error:', {
          message: err.message,
          statusCode: err.statusCode,
          data: err.data
        });
        return done(new require('passport-oauth2').InternalOAuthError('failed to fetch user profile', err));
      }

      try {
        const json = JSON.parse(body);
        console.log('📋 LinkedIn userinfo response:', json);
        
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
        
        return done(null, profile);
      } catch(e) {
        console.error('❌ Failed to parse LinkedIn response:', e);
        return done(new require('passport-oauth2').InternalOAuthError('failed to parse profile response', e));
      }
    });
  };

  passport.use(new LinkedInOIDCStrategy({
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: process.env.LINKEDIN_CALLBACK_URL || "http://localhost:3000/auth/linkedin/callback",
    scope: ['openid', 'profile', 'email'], // Updated to use OpenID Connect scopes
    state: true
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('🔑 LinkedIn OAuth Strategy - Processing user profile');
      console.log('📋 Profile data received:', {
        id: profile.id,
        displayName: profile.displayName,
        name: profile.name,
        emails: profile.emails,
        photos: profile.photos
      });

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

// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Authentication required' });
};

// ====================
// LINKEDIN OAUTH ROUTES
// ====================

// LinkedIn login (only if OAuth is configured)
app.get('/auth/linkedin', (req, res) => {
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    passport.authenticate('linkedin')(req, res);
  } else {
    res.status(400).json({ error: 'LinkedIn OAuth not configured' });
  }
});

// LinkedIn callback (only if OAuth is configured)
app.get('/auth/linkedin/callback', (req, res) => {
  if (process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET) {
    console.log('🔗 LinkedIn callback received with query:', req.query);
    
    // Use custom callback handling for better debugging
    passport.authenticate('linkedin', async (err, user, info) => {
      if (err) {
        console.error('❌ LinkedIn authentication error:', err);
        
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

      // Success! Log the user in
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          console.error('❌ Login error:', loginErr);
          return res.send(`
            <html>
              <head><title>Login Error</title></head>
              <body style="font-family: Arial, sans-serif; padding: 20px;">
                <h1>❌ Login Error</h1>
                <p>User profile retrieved but couldn't establish session.</p>
                <pre style="background: #f5f5f5; padding: 15px; border-radius: 5px;">
${JSON.stringify(loginErr, null, 2)}
                </pre>
                <p><a href="/" style="background: #0073b1; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">← Back to Home</a></p>
              </body>
            </html>
          `);
        }

        console.log('✅ LinkedIn OAuth callback successful');
        console.log('🔍 User authenticated:', req.isAuthenticated());
        console.log('👤 User data:', { id: user.id, name: user.name });
        console.log('🍪 Session after login:', {
          sessionID: req.sessionID,
          passport: req.session.passport,
          cookie: req.session.cookie
        });
        
        // Successful authentication - redirect to home with success message
        return res.redirect('/?authenticated=true');
      });
    })(req, res);
  } else {
    res.redirect('/?error=oauth_not_configured');
  }
});

// Logout
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
app.get('/api/auth-status', (req, res) => {
  console.log('🔍 Auth status check:', {
    sessionID: req.sessionID,
    isAuthenticated: req.isAuthenticated(),
    userExists: !!req.user,
    user: req.user ? { id: req.user.id, name: req.user.name } : null,
    sessionData: Object.keys(req.session || {})
  });
  
  if (req.isAuthenticated() && req.user) {
    res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        linkedin_id: req.user.linkedin_id
      }
    });
  } else {
    res.json({
      authenticated: false,
      user: null
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
    const { content, imageUrl } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Post content is required' });
    }

    const accessToken = await LinkedInService.ensureValidToken(req.user.id);
    const result = await LinkedInService.createPost(accessToken, content, imageUrl);

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

// Debug endpoint for Vercel
app.get('/debug', (req, res) => {
  console.log('🔍 Debug endpoint called');
  const envCheck = {
    status: 'debug',
    environment: process.env.NODE_ENV,
    vercel: !!process.env.VERCEL,
    serverInitialized: serverInitialized || 'N/A (local mode)',
    databaseEnvVars: {
      POSTGRES_URL: !!process.env.POSTGRES_URL,
      DATABASE_URL: !!process.env.DATABASE_URL,
      POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
      POSTGRES_URL_NON_POOLING: !!process.env.POSTGRES_URL_NON_POOLING,
      POSTGRES_HOST: !!process.env.POSTGRES_HOST,
      POSTGRES_USER: !!process.env.POSTGRES_USER,
      POSTGRES_PASSWORD: !!process.env.POSTGRES_PASSWORD,
      POSTGRES_DATABASE: !!process.env.POSTGRES_DATABASE
    },
    apis: {
      openai: !!process.env.OPENAI_API_KEY,
      newsApi: !!process.env.NEWS_API_KEY,
      theNewsApi: !!process.env.THENEWSAPI_KEY,
      pexels: !!process.env.PEXELS_API_KEY,
      linkedinOAuth: {
        clientId: !!process.env.LINKEDIN_CLIENT_ID,
        clientSecret: !!process.env.LINKEDIN_CLIENT_SECRET,
        callbackUrl: !!process.env.LINKEDIN_CALLBACK_URL
      }
    },
    timestamp: new Date().toISOString()
  };
  
  console.log('🔍 Environment check result:', envCheck);
  res.json(envCheck);
});

// Note: Root route (/) is handled by vercel.json routing to public/index.html
// Vercel routes "/" directly to "public/index.html" without going through Express

// ====================
// EXISTING GENERATE POST ROUTE (Updated)
// ====================

app.post('/api/generate-post', rateLimitMiddleware, async (req, res) => {
  try {
    const { topic, tone } = req.body;
    
    if (!topic || !tone) {
      return res.status(400).json({ 
        error: 'Both topic and tone are required' 
      });
    }

    const result = await generatePost(topic, tone);
    res.json(result);
  } catch (error) {
    console.error('❌ Error generating post:', error);
    res.status(500).json({ 
      error: 'Failed to generate post. Please try again.' 
    });
  }
});

// ====================
// POST GENERATION FUNCTION (Unchanged from previous version)
// ====================

async function generatePost(topic, tone) {
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

    // Step 3: Generate LinkedIn post
    const post = await generateLinkedInPost(selectedArticle, topic, tone);
    
    // Step 4: Fetch relevant image
    const image = await fetchRelevantImage(topic);
    
    return {
      post: post,
      article: {
        title: selectedArticle.title,
        url: selectedArticle.url,
        source: selectedArticle.source?.name || 'News Source',
        publishedAt: selectedArticle.publishedAt
      },
      image: image
    };
  } catch (error) {
    console.error('❌ Error in generatePost:', error);
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

async function generateLinkedInPost(article, topic, tone) {
  const prompt = `Create a LinkedIn post about this recent news article:

Title: ${article.title}
Content: ${article.description || article.content || 'No description available'}
URL: ${article.url}

Requirements:
- Topic focus: ${topic}
- Tone: ${tone}
- Length: 150-220 words
- Include personal insight or commentary about the topic
- Reference specific details from the article
- Add the article URL at the end with "Read more:"
- Use maximum 1-2 emojis (not 3-5)
- Write for a general LinkedIn audience, not just business professionals
- Make it conversational and engaging
- Focus on the implications or lessons from this news

Format the response as just the LinkedIn post text, nothing else.`;

  try {
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a LinkedIn content creator who writes engaging posts that spark conversation and provide value to a general professional audience.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 300,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let post = response.data.choices[0].message.content.trim();
    
    // Ensure the article URL is included
    if (!post.includes(article.url)) {
      post += `\n\nRead more: ${article.url}`;
    }

    return post;
  } catch (error) {
    console.error('❌ OpenAI API error:', error.response?.data || error.message);
    throw new Error('Failed to generate LinkedIn post');
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
    headers: Object.keys(req.headers),
    initialized: serverInitialized
  });

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
    console.log('📡 Passing request to Express app...');
    return serverApp(req, res);
  } catch (error) {
    console.error('❌ Error in Express app:', error);
    return res.status(500).json({ 
      error: 'Request handling failed',
      message: error.message 
    });
  }
}; 