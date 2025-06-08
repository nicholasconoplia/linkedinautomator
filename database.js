const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Create database connection
const dbPath = path.join(__dirname, 'linkedin_automation.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          linkedin_id TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          email TEXT,
          profile_url TEXT,
          access_token TEXT NOT NULL,
          refresh_token TEXT,
          token_expires_at INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // User preferences table
      db.run(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          posts_per_week INTEGER DEFAULT 3,
          posting_days TEXT DEFAULT '1,3,5',
          posting_time TEXT DEFAULT '09:00',
          timezone TEXT DEFAULT 'UTC',
          topics TEXT DEFAULT 'Artificial Intelligence,Technology,Leadership',
          tone TEXT DEFAULT 'professional',
          auto_posting_enabled BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `);

      // Scheduled posts table
      db.run(`
        CREATE TABLE IF NOT EXISTS scheduled_posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          topic TEXT NOT NULL,
          tone TEXT NOT NULL,
          post_content TEXT,
          image_url TEXT,
          article_url TEXT,
          scheduled_for DATETIME NOT NULL,
          status TEXT DEFAULT 'pending',
          posted_at DATETIME,
          linkedin_post_id TEXT,
          error_message TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('✅ Database initialized successfully');
          resolve();
        }
      });
    });
  });
}

// User operations
const UserDB = {
  // Save or update user from LinkedIn OAuth
  saveUser: (linkedinProfile, tokens) => {
    return new Promise((resolve, reject) => {
      const { id, displayName, emails, photos } = linkedinProfile;
      const email = emails && emails[0] ? emails[0].value : null;
      const profileUrl = photos && photos[0] ? photos[0].value : null;
      
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO users 
        (linkedin_id, name, email, profile_url, access_token, refresh_token, token_expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      
      stmt.run([
        id,
        displayName,
        email,
        profileUrl,
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_at
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
      
      stmt.finalize();
    });
  },

  // Get user by LinkedIn ID
  getUserByLinkedInId: (linkedinId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE linkedin_id = ?',
        [linkedinId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  },

  // Get user by ID
  getUserById: (id) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE id = ?',
        [id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  },

  // Update user tokens
  updateTokens: (userId, tokens) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        UPDATE users 
        SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);
      
      stmt.run([
        tokens.access_token,
        tokens.refresh_token,
        tokens.expires_at,
        userId
      ], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      
      stmt.finalize();
    });
  }
};

// User preferences operations
const PreferencesDB = {
  // Get or create user preferences
  getUserPreferences: (userId) => {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM user_preferences WHERE user_id = ?',
        [userId],
        (err, row) => {
          if (err) {
            reject(err);
          } else if (row) {
            resolve(row);
          } else {
            // Create default preferences
            PreferencesDB.createDefaultPreferences(userId)
              .then(resolve)
              .catch(reject);
          }
        }
      );
    });
  },

  // Create default preferences
  createDefaultPreferences: (userId) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO user_preferences (user_id)
        VALUES (?)
      `);
      
      stmt.run([userId], function(err) {
        if (err) {
          reject(err);
        } else {
          PreferencesDB.getUserPreferences(userId)
            .then(resolve)
            .catch(reject);
        }
      });
      
      stmt.finalize();
    });
  },

  // Update user preferences
  updatePreferences: (userId, preferences) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        UPDATE user_preferences 
        SET posts_per_week = ?, posting_days = ?, posting_time = ?, timezone = ?, 
            topics = ?, tone = ?, auto_posting_enabled = ?, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `);
      
      stmt.run([
        preferences.posts_per_week,
        preferences.posting_days,
        preferences.posting_time,
        preferences.timezone,
        preferences.topics,
        preferences.tone,
        preferences.auto_posting_enabled ? 1 : 0,
        userId
      ], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      
      stmt.finalize();
    });
  }
};

// Scheduled posts operations
const PostsDB = {
  // Schedule a new post
  schedulePost: (userId, postData) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        INSERT INTO scheduled_posts 
        (user_id, topic, tone, post_content, image_url, article_url, scheduled_for)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        userId,
        postData.topic,
        postData.tone,
        postData.post_content,
        postData.image_url,
        postData.article_url,
        postData.scheduled_for
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
      
      stmt.finalize();
    });
  },

  // Get pending posts for posting
  getPendingPosts: () => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT sp.*, u.access_token, u.linkedin_id 
        FROM scheduled_posts sp
        JOIN users u ON sp.user_id = u.id
        WHERE sp.status = 'pending' AND sp.scheduled_for <= CURRENT_TIMESTAMP
        ORDER BY sp.scheduled_for ASC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },

  // Update post status
  updatePostStatus: (postId, status, linkedinPostId = null, errorMessage = null) => {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(`
        UPDATE scheduled_posts 
        SET status = ?, posted_at = CURRENT_TIMESTAMP, linkedin_post_id = ?, error_message = ?
        WHERE id = ?
      `);
      
      stmt.run([status, linkedinPostId, errorMessage, postId], function(err) {
        if (err) reject(err);
        else resolve(this.changes);
      });
      
      stmt.finalize();
    });
  },

  // Get user's scheduled posts
  getUserPosts: (userId, limit = 20) => {
    return new Promise((resolve, reject) => {
      db.all(`
        SELECT * FROM scheduled_posts 
        WHERE user_id = ? 
        ORDER BY scheduled_for DESC 
        LIMIT ?
      `, [userId, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};

module.exports = {
  initializeDatabase,
  UserDB,
  PreferencesDB,
  PostsDB,
  db
}; 