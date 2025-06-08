const { Pool } = require('pg');

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

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

module.exports = {
  initializeDatabase,
  UserDB,
  PreferencesDB,
  PostsDB,
  pool
}; 