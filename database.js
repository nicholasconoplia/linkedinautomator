const { Pool } = require('pg');

// Create PostgreSQL connection pool with Vercel compatibility
const getDatabaseConfig = () => {
  // List all possible database environment variables for debugging
  const dbEnvVars = {
    POSTGRES_URL: process.env.POSTGRES_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_PRISMA_URL: process.env.POSTGRES_PRISMA_URL,
    POSTGRES_URL_NON_POOLING: process.env.POSTGRES_URL_NON_POOLING,
    POSTGRES_HOST: process.env.POSTGRES_HOST,
    POSTGRES_USER: process.env.POSTGRES_USER,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    POSTGRES_DATABASE: process.env.POSTGRES_DATABASE
  };

  console.log('🔧 Available database environment variables:');
  Object.entries(dbEnvVars).forEach(([key, value]) => {
    console.log(`  ${key}: ${value ? '✅ Available' : '❌ Not set'}`);
  });

  // Try different connection string options in order of preference
  const connectionString = 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URL || 
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING;

  if (connectionString) {
    console.log('🔧 Using connection string from environment');
    return {
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
  }

  // Fallback to individual environment variables
  if (process.env.POSTGRES_HOST) {
    console.log('🔧 Using individual PostgreSQL environment variables');
    return {
      host: process.env.POSTGRES_HOST,
      port: process.env.POSTGRES_PORT || 5432,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DATABASE,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
  }

  // Note: Environment variables are now properly configured in Vercel Dashboard

  // Default local development fallback (this will fail in Vercel)
  console.log('⚠️ No database environment variables found, using localhost fallback');
  return {
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'password',
    database: 'linkedin_posts',
    ssl: false
  };
};

const pool = new Pool(getDatabaseConfig());

// Initialize database tables
function initializeDatabase() {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('🔧 Connecting to database...');
      console.log('🔧 Connection string available:', !!process.env.POSTGRES_URL || !!process.env.DATABASE_URL);
      const client = await pool.connect();
      console.log('✅ Database connection established');
      
      try {
        // Users table
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            linkedin_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            profile_url TEXT,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            token_expires_at BIGINT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // User preferences table
        await client.query(`
          CREATE TABLE IF NOT EXISTS user_preferences (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            posts_per_week INTEGER DEFAULT 3,
            posting_days TEXT DEFAULT '1,3,5',
            posting_time TEXT DEFAULT '09:00',
            timezone TEXT DEFAULT 'UTC',
            topics TEXT DEFAULT 'Artificial Intelligence,Technology,Leadership',
            tone TEXT DEFAULT 'professional',
            auto_posting_enabled BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Scheduled posts table
        await client.query(`
          CREATE TABLE IF NOT EXISTS scheduled_posts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            topic TEXT NOT NULL,
            tone TEXT NOT NULL,
            post_content TEXT,
            image_url TEXT,
            article_url TEXT,
            scheduled_for TIMESTAMP NOT NULL,
            status TEXT DEFAULT 'pending',
            posted_at TIMESTAMP,
            linkedin_post_id TEXT,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Subscription plans table
        await client.query(`
          CREATE TABLE IF NOT EXISTS subscription_plans (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            price DECIMAL(10,2) NOT NULL,
            launch_price DECIMAL(10,2),
            posts_limit INTEGER,
            features JSONB DEFAULT '{}',
            stripe_price_id TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Add launch_price column if it doesn't exist (for existing databases)
        try {
          await client.query(`
            ALTER TABLE subscription_plans 
            ADD COLUMN launch_price DECIMAL(10,2)
          `);
          console.log('✅ Added launch_price column to subscription_plans');
        } catch (error) {
          // Column already exists, which is fine
          if (!error.message.includes('already exists')) {
            console.log('ℹ️ launch_price column already exists in subscription_plans');
          }
        }

        // Add updated_at column if it doesn't exist (for existing databases)
        try {
          await client.query(`
            ALTER TABLE subscription_plans 
            ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          `);
          console.log('✅ Added updated_at column to subscription_plans');
        } catch (error) {
          // Column already exists, which is fine
          if (!error.message.includes('already exists')) {
            console.log('ℹ️ updated_at column already exists in subscription_plans');
          }
        }

        // User subscriptions table
        await client.query(`
          CREATE TABLE IF NOT EXISTS user_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL UNIQUE,
            plan_id INTEGER REFERENCES subscription_plans(id),
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due', 'unpaid', 'incomplete')),
            current_period_start TIMESTAMP,
            current_period_end TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Add unique constraint if it doesn't exist (for existing databases)
        try {
          await client.query(`
            ALTER TABLE user_subscriptions 
            ADD CONSTRAINT user_subscriptions_user_id_unique UNIQUE (user_id)
          `);
          console.log('✅ Added unique constraint to user_subscriptions.user_id');
        } catch (error) {
          // Constraint already exists, which is fine
          if (!error.message.includes('already exists')) {
            console.log('ℹ️ Unique constraint on user_subscriptions.user_id already exists');
          }
        }

        // Usage tracking table
        await client.query(`
          CREATE TABLE IF NOT EXISTS usage_tracking (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            action_type TEXT NOT NULL CHECK (action_type IN ('post_generation', 'post_publish', 'image_fetch')),
            cost DECIMAL(10,6) DEFAULT 0,
            tokens_used INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            metadata JSONB DEFAULT '{}',
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Access keys table
        await client.query(`
          CREATE TABLE IF NOT EXISTS access_keys (
            id SERIAL PRIMARY KEY,
            key_code TEXT NOT NULL UNIQUE,
            name TEXT,
            posts_limit INTEGER DEFAULT 10,
            posts_used INTEGER DEFAULT 0,
            valid_until TIMESTAMP,
            created_by TEXT,
            status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'exhausted', 'disabled')),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_used_at TIMESTAMP,
            used_by_users TEXT[] DEFAULT '{}'
          )
        `);

        // User access keys (many-to-many)
        await client.query(`
          CREATE TABLE IF NOT EXISTS user_access_keys (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            access_key_id INTEGER REFERENCES access_keys(id),
            posts_used INTEGER DEFAULT 0,
            activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, access_key_id),
            FOREIGN KEY (user_id) REFERENCES users (id)
          )
        `);

        // Add unique constraint if it doesn't exist (for existing databases)
        try {
          await client.query(`
            ALTER TABLE subscription_plans 
            ADD CONSTRAINT subscription_plans_name_unique UNIQUE (name)
          `);
          console.log('✅ Added unique constraint to subscription_plans.name');
        } catch (error) {
          // Constraint already exists, which is fine
          if (!error.message.includes('already exists')) {
            console.log('ℹ️ Unique constraint on subscription_plans.name already exists');
          }
        }

        // Insert default subscription plans
        await client.query(`
          INSERT INTO subscription_plans (name, price, posts_limit, features, stripe_price_id) VALUES
          ('Free Trial', 0.00, 5, '{"description": "Try PostPilot with 5 free posts", "promotion": "Always Free"}', null),
          ('Starter', 0.49, 30, '{"description": "Perfect for individuals", "features": ["30 posts/month", "Basic templates", "Email support"], "original_price": 0.99, "promotion": "🔥 50% OFF Launch Special"}', null),
          ('Professional', 1.49, 100, '{"description": "For active professionals", "features": ["100 posts/month", "All templates", "Priority support", "Automation"], "original_price": 2.99, "promotion": "🔥 50% OFF Launch Special"}', null),
          ('Business', 2.49, 300, '{"description": "For businesses and teams", "features": ["300 posts/month", "Advanced analytics", "Custom branding", "API access"], "original_price": 4.99, "promotion": "🔥 50% OFF Launch Special"}', null),
          ('Enterprise', 4.99, -1, '{"description": "Unlimited posting", "features": ["Unlimited posts", "White-label", "Dedicated support", "Custom integrations"], "original_price": 9.99, "promotion": "🔥 50% OFF Launch Special"}', null)
          ON CONFLICT (name) DO NOTHING
        `);

        console.log('✅ Database initialized successfully');
        resolve();
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      reject(error);
    }
  });
}

// User operations
const UserDB = {
  // Save or update user from LinkedIn OAuth
  saveUser: async (linkedinProfile, tokens) => {
    const client = await pool.connect();
    try {
      const { id, displayName, emails, photos } = linkedinProfile;
      const email = emails && emails[0] ? emails[0].value : null;
      const profileUrl = photos && photos[0] ? photos[0].value : null;
      
      const query = `
        INSERT INTO users 
        (linkedin_id, name, email, profile_url, access_token, refresh_token, token_expires_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (linkedin_id) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          profile_url = EXCLUDED.profile_url,
          access_token = EXCLUDED.access_token,
          refresh_token = EXCLUDED.refresh_token,
          token_expires_at = EXCLUDED.token_expires_at,
          updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `;
      
      const result = await client.query(query, [
        id,
        displayName,
        email,
        profileUrl,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_at
      ]);
      
      return result.rows[0].id;
    } finally {
      client.release();
    }
  },

  // Get user by LinkedIn ID
  getUserByLinkedInId: async (linkedinId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE linkedin_id = $1',
        [linkedinId]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  },

  // Get user by ID
  getUserById: async (id) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
      );
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  },

  // Update user tokens
  updateTokens: async (userId, tokens) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        UPDATE users 
        SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_at,
        userId
      ]);
      
      return result.rowCount;
    } finally {
      client.release();
    }
  }
};

// User preferences operations
const PreferencesDB = {
  // Get or create user preferences
  getUserPreferences: async (userId) => {
    const client = await pool.connect();
    try {
      let result = await client.query(
        'SELECT * FROM user_preferences WHERE user_id = $1',
        [userId]
      );
      
      if (result.rows.length > 0) {
        return result.rows[0];
      } else {
        // Create default preferences
        const insertResult = await client.query(`
          INSERT INTO user_preferences (user_id)
          VALUES ($1)
          RETURNING *
        `, [userId]);
        
        return insertResult.rows[0];
      }
    } finally {
      client.release();
    }
  },

  // Update user preferences
  updateUserPreferences: async (userId, preferences) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        UPDATE user_preferences 
        SET posts_per_week = $1, posting_days = $2, posting_time = $3, 
            timezone = $4, topics = $5, tone = $6, auto_posting_enabled = $7,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $8
        RETURNING *
      `, [
        preferences.posts_per_week,
        preferences.posting_days,
        preferences.posting_time,
        preferences.timezone,
        preferences.topics,
        preferences.tone,
        preferences.auto_posting_enabled,
        userId
      ]);
      
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Get users who need content generated
  getUsersNeedingContent: async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT u.*, p.*
        FROM users u
        JOIN user_preferences p ON u.id = p.user_id
        WHERE p.auto_posting_enabled = true
        AND u.access_token IS NOT NULL
      `);
      
      return result.rows;
    } finally {
      client.release();
    }
  }
};

// Scheduled posts operations
const PostsDB = {
  // Create a new scheduled post
  createScheduledPost: async (userId, postData) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO scheduled_posts (user_id, topic, tone, post_content, image_url, article_url, scheduled_for)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [
        userId,
        postData.topic,
        postData.tone,
        postData.post_content,
        postData.image_url,
        postData.article_url,
        postData.scheduled_for
      ]);
      
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Get scheduled posts for a user
  getUserScheduledPosts: async (userId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM scheduled_posts WHERE user_id = $1 ORDER BY scheduled_for DESC',
        [userId]
      );
      return result.rows;
    } finally {
      client.release();
    }
  },

  // Get pending posts ready to be published
  getPendingPosts: async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT sp.*, u.access_token, u.name as user_name
        FROM scheduled_posts sp
        JOIN users u ON sp.user_id = u.id
        WHERE sp.status = 'pending' 
        AND sp.scheduled_for <= CURRENT_TIMESTAMP
      `);
      return result.rows;
    } finally {
      client.release();
    }
  },

  // Update post status
  updatePostStatus: async (postId, status, linkedinPostId = null, errorMessage = null) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        UPDATE scheduled_posts 
        SET status = $1, linkedin_post_id = $2, error_message = $3, posted_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
      `, [status, linkedinPostId, errorMessage, postId]);
      
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Delete a scheduled post
  deleteScheduledPost: async (postId, userId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(
        'DELETE FROM scheduled_posts WHERE id = $1 AND user_id = $2',
        [postId, userId]
      );
      return result.rowCount > 0;
    } finally {
      client.release();
    }
  }
};

// Subscription operations
const SubscriptionDB = {
  // Get all subscription plans
  getPlans: async () => {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM subscription_plans ORDER BY price ASC');
      console.log('📋 Database query result:', result.rows?.length, 'plans found');
      return result.rows || [];
    } catch (error) {
      console.error('❌ Error in getPlans database query:', error);
      throw error;
    } finally {
      client.release();
    }
  },

  // Get user's current subscription
  getUserSubscription: async (userId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT us.*, sp.name as plan_name, sp.price, sp.posts_limit, sp.features
        FROM user_subscriptions us
        JOIN subscription_plans sp ON us.plan_id = sp.id
        WHERE us.user_id = $1
      `, [userId]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  },

  // Create or update user subscription
  upsertSubscription: async (userId, subscriptionData) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO user_subscriptions 
        (user_id, plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_start, current_period_end)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
          plan_id = EXCLUDED.plan_id,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          status = EXCLUDED.status,
          current_period_start = EXCLUDED.current_period_start,
          current_period_end = EXCLUDED.current_period_end,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        userId,
        subscriptionData.plan_id,
        subscriptionData.stripe_customer_id,
        subscriptionData.stripe_subscription_id,
        subscriptionData.status,
        subscriptionData.current_period_start,
        subscriptionData.current_period_end
      ]);
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Update subscription status
  updateSubscriptionStatus: async (userId, status) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        UPDATE user_subscriptions 
        SET status = $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
        RETURNING *
      `, [status, userId]);
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Get user subscription by Stripe customer ID
  getUserSubscriptionByCustomer: async (stripeCustomerId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT us.*, sp.name as plan_name, sp.price, sp.posts_limit, sp.features
        FROM user_subscriptions us
        JOIN subscription_plans sp ON us.plan_id = sp.id
        WHERE us.stripe_customer_id = $1
      `, [stripeCustomerId]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  },

  // Create a new subscription plan
  createPlan: async (planData) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO subscription_plans (name, price, launch_price, posts_limit, features, stripe_price_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [
        planData.name,
        planData.price,
        planData.launch_price,
        planData.posts_limit,
        JSON.stringify(planData.features),
        planData.stripe_price_id
      ]);
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Update plan Stripe price ID
  updatePlanStripeId: async (planName, stripePriceId, launchPrice) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        UPDATE subscription_plans 
        SET stripe_price_id = $1, launch_price = $2, updated_at = CURRENT_TIMESTAMP
        WHERE name = $3
        RETURNING *
      `, [stripePriceId, launchPrice, planName]);
      return result.rows[0];
    } finally {
      client.release();
    }
  }
};

// Usage tracking operations
const UsageDB = {
  // Track an action (post generation, publishing, etc.)
  trackUsage: async (userId, actionType, cost = 0, tokensUsed = 0, metadata = {}) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO usage_tracking (user_id, action_type, cost, tokens_used, metadata)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [userId, actionType, cost, tokensUsed, metadata]);
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Get user's usage for current month
  getMonthlyUsage: async (userId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE action_type = 'post_generation') as posts_generated,
          COUNT(*) FILTER (WHERE action_type = 'post_publish') as posts_published,
          SUM(cost) as total_cost,
          SUM(tokens_used) as total_tokens
        FROM usage_tracking 
        WHERE user_id = $1 
        AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
      `, [userId]);
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Check if user has remaining posts in their plan
  checkUsageLimit: async (userId) => {
    const client = await pool.connect();
    try {
      // First check if user has an active subscription
      const result = await client.query(`
        SELECT 
          sp.posts_limit,
          COUNT(ut.id) FILTER (WHERE ut.action_type = 'post_generation' 
                               AND ut.created_at >= date_trunc('month', CURRENT_TIMESTAMP)) as posts_used,
          us.status as subscription_status
        FROM user_subscriptions us
        JOIN subscription_plans sp ON us.plan_id = sp.id
        LEFT JOIN usage_tracking ut ON ut.user_id = us.user_id
        WHERE us.user_id = $1 AND us.status IN ('active', 'incomplete')
        GROUP BY sp.posts_limit, us.status
      `, [userId]);
      
      const usage = result.rows[0];
      if (usage) {
        const postsUsed = parseInt(usage.posts_used) || 0;
        const postsLimit = usage.posts_limit;
        
        if (postsLimit === -1) { // Unlimited plan
          return { hasAccess: true, postsRemaining: -1, postsUsed };
        }

        const postsRemaining = Math.max(0, postsLimit - postsUsed);
        return { 
          hasAccess: postsRemaining > 0, 
          postsRemaining, 
          postsUsed,
          postsLimit 
        };
      }

      // No subscription, check for access keys
      const accessKeyResult = await client.query(`
        SELECT 
          SUM(ak.posts_limit - uak.posts_used) as total_posts_remaining,
          COUNT(ak.id) as active_keys
        FROM user_access_keys uak
        JOIN access_keys ak ON uak.access_key_id = ak.id
        WHERE uak.user_id = $1 
        AND ak.status = 'active'
        AND (ak.valid_until IS NULL OR ak.valid_until > CURRENT_TIMESTAMP)
        AND uak.posts_used < ak.posts_limit
      `, [userId]);

      const accessKeyData = accessKeyResult.rows[0];
      const totalPostsRemaining = parseInt(accessKeyData.total_posts_remaining) || 0;
      const activeKeys = parseInt(accessKeyData.active_keys) || 0;

      if (activeKeys > 0 && totalPostsRemaining > 0) {
        return { 
          hasAccess: true, 
          postsRemaining: totalPostsRemaining, 
          postsUsed: 0,
          accessType: 'access_key',
          activeKeys 
        };
      }

      // No subscription or access keys
      return { hasAccess: false, postsRemaining: 0, reason: 'No active subscription or access keys' };
    } finally {
      client.release();
    }
  }
};

// Access keys operations
const AccessKeysDB = {
  // Create a new access key
  createAccessKey: async (keyData) => {
    const client = await pool.connect();
    try {
      const keyCode = keyData.key_code || `PK-${Date.now()}-${Math.random().toString(36).substring(7).toUpperCase()}`;
      const result = await client.query(`
        INSERT INTO access_keys (key_code, name, posts_limit, valid_until, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
      `, [
        keyCode,
        keyData.name,
        keyData.posts_limit || 10,
        keyData.valid_until,
        keyData.created_by
      ]);
      return result.rows[0];
    } finally {
      client.release();
    }
  },

  // Validate and use an access key
  useAccessKey: async (userId, keyCode) => {
    const client = await pool.connect();
    try {
      // Start transaction
      await client.query('BEGIN');

      // Check if key exists and is valid
      const keyResult = await client.query(`
        SELECT * FROM access_keys 
        WHERE key_code = $1 
        AND status = 'active'
        AND (valid_until IS NULL OR valid_until > CURRENT_TIMESTAMP)
        AND posts_used < posts_limit
      `, [keyCode]);

      if (keyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, error: 'Invalid or expired access key' };
      }

      const accessKey = keyResult.rows[0];

      // Check if user already used this key
      const userKeyResult = await client.query(`
        SELECT * FROM user_access_keys 
        WHERE user_id = $1 AND access_key_id = $2
      `, [userId, accessKey.id]);

      let userAccessKey;
      if (userKeyResult.rows.length === 0) {
        // First time using this key
        const insertResult = await client.query(`
          INSERT INTO user_access_keys (user_id, access_key_id)
          VALUES ($1, $2)
          RETURNING *
        `, [userId, accessKey.id]);
        userAccessKey = insertResult.rows[0];
      } else {
        userAccessKey = userKeyResult.rows[0];
      }

      // Increment usage
      await client.query(`
        UPDATE access_keys 
        SET posts_used = posts_used + 1, last_used_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [accessKey.id]);

      await client.query(`
        UPDATE user_access_keys 
        SET posts_used = posts_used + 1
        WHERE id = $1
      `, [userAccessKey.id]);

      await client.query('COMMIT');
      
      return { 
        success: true, 
        postsRemaining: accessKey.posts_limit - accessKey.posts_used - 1,
        keyName: accessKey.name 
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // Get user's active access keys
  getUserAccessKeys: async (userId) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT ak.*, uak.posts_used as user_posts_used, uak.activated_at
        FROM user_access_keys uak
        JOIN access_keys ak ON uak.access_key_id = ak.id
        WHERE uak.user_id = $1
        AND ak.status = 'active'
        AND (ak.valid_until IS NULL OR ak.valid_until > CURRENT_TIMESTAMP)
        ORDER BY uak.activated_at DESC
      `, [userId]);
      return result.rows;
    } finally {
      client.release();
    }
  },

  // Admin: Get all access keys
  getAllAccessKeys: async () => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT ak.*, 
               COUNT(uak.id) as total_users,
               SUM(uak.posts_used) as total_posts_used
        FROM access_keys ak
        LEFT JOIN user_access_keys uak ON ak.id = uak.access_key_id
        GROUP BY ak.id
        ORDER BY ak.created_at DESC
      `);
      return result.rows;
    } finally {
      client.release();
    }
  },

  // Get access key by code
  getKeyByCode: async (keyCode) => {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT * FROM access_keys 
        WHERE key_code = $1
      `, [keyCode]);
      return result.rows[0] || null;
    } finally {
      client.release();
    }
  },

  // Delete access key
  deleteAccessKey: async (keyId) => {
    const client = await pool.connect();
    try {
      // Start transaction
      await client.query('BEGIN');

      // Delete related user_access_keys records first (foreign key constraint)
      await client.query(`
        DELETE FROM user_access_keys 
        WHERE access_key_id = $1
      `, [keyId]);

      // Delete the access key
      const result = await client.query(`
        DELETE FROM access_keys 
        WHERE id = $1
      `, [keyId]);

      await client.query('COMMIT');
      
      return result.rowCount > 0; // Returns true if a row was deleted
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

module.exports = {
  initializeDatabase,
  UserDB,
  PreferencesDB,
  PostsDB,
  SubscriptionDB,
  UsageDB,
  AccessKeysDB,
  pool
}; 