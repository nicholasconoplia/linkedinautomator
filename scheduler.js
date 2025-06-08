const cron = require('node-cron');
const { PostsDB, PreferencesDB, UserDB } = require('./database');
const LinkedInService = require('./linkedin-service');

class PostScheduler {
  constructor() {
    this.jobs = new Map();
    this.isInitialized = false;
    this.postProcessor = null;
  }

  // Initialize the scheduler
  initialize(generatePostFunction) {
    if (this.isInitialized) return;

    this.postProcessor = generatePostFunction;
    
    // Run every minute to check for posts to publish
    cron.schedule('* * * * *', async () => {
      await this.processScheduledPosts();
    });

    // Run every hour to generate new scheduled posts for users
    cron.schedule('0 * * * *', async () => {
      await this.generateScheduledPosts();
    });

    this.isInitialized = true;
    console.log('📅 Scheduler initialized successfully');
  }

  // Process posts that are ready to be published
  async processScheduledPosts() {
    try {
      const pendingPosts = await PostsDB.getPendingPosts();
      
      if (pendingPosts.length === 0) return;

      console.log(`📤 Processing ${pendingPosts.length} scheduled posts...`);

      for (const post of pendingPosts) {
        try {
          // Ensure we have a valid access token
          const accessToken = await LinkedInService.ensureValidToken(post.user_id);
          
          // Post to LinkedIn
          const result = await LinkedInService.createPost(
            accessToken,
            post.post_content,
            post.image_url
          );

          if (result.success) {
            await PostsDB.updatePostStatus(post.id, 'posted', result.postId);
            console.log(`✅ Posted successfully for user ${post.user_id}: ${result.postId}`);
          } else {
            await PostsDB.updatePostStatus(post.id, 'failed', null, result.error);
            console.error(`❌ Failed to post for user ${post.user_id}:`, result.error);
          }

        } catch (error) {
          await PostsDB.updatePostStatus(post.id, 'failed', null, error.message);
          console.error(`❌ Error processing post ${post.id}:`, error.message);
        }
      }

    } catch (error) {
      console.error('❌ Error in processScheduledPosts:', error.message);
    }
  }

  // Generate new scheduled posts for users who need them
  async generateScheduledPosts() {
    try {
      // This is a simplified version - in practice you'd want more sophisticated scheduling
      console.log('🤖 Checking for users who need new posts generated...');
      
      // Get all users with auto-posting enabled
      const users = await this.getUsersNeedingPosts();
      
      for (const user of users) {
        await this.generatePostsForUser(user);
      }

    } catch (error) {
      console.error('❌ Error in generateScheduledPosts:', error.message);
    }
  }

  // Get users who need new posts generated (updated for PostgreSQL)
  async getUsersNeedingPosts() {
    try {
      // Get users who need content generated using the new PostgreSQL database
      const users = await PreferencesDB.getUsersNeedingContent();
      
      // Filter users who don't have too many pending posts
      const usersNeedingPosts = [];
      for (const user of users) {
        const scheduledPosts = await PostsDB.getUserScheduledPosts(user.id);
        const pendingPosts = scheduledPosts.filter(post => 
          post.status === 'pending' && new Date(post.scheduled_for) > new Date()
        );
        
        if (pendingPosts.length < 3) {
          usersNeedingPosts.push(user);
        }
      }
      
      return usersNeedingPosts;
    } catch (error) {
      console.error('❌ Error getting users needing posts:', error);
      return [];
    }
  }

  // Generate posts for a specific user
  async generatePostsForUser(user) {
    try {
      const preferences = await PreferencesDB.getUserPreferences(user.user_id || user.id);
      const topics = preferences.topics.split(',');
      const postsPerWeek = preferences.posts_per_week;
      const postingDays = preferences.posting_days.split(',').map(d => parseInt(d));
      const postingTime = preferences.posting_time;

      // Calculate next posting dates
      const nextDates = this.calculateNextPostingDates(postingDays, postingTime, postsPerWeek);

      for (let i = 0; i < Math.min(nextDates.length, 3); i++) {
        const randomTopic = topics[Math.floor(Math.random() * topics.length)].trim();
        
        try {
          // Generate post content
          const postData = await this.postProcessor(randomTopic, preferences.tone);
          
          if (postData && postData.post) {
            await PostsDB.createScheduledPost(user.user_id || user.id, {
              topic: randomTopic,
              tone: preferences.tone,
              post_content: postData.post,
              image_url: postData.image?.url || null,
              article_url: postData.article?.url || null,
              scheduled_for: nextDates[i].toISOString()
            });

            console.log(`📝 Scheduled post for ${user.name} on ${nextDates[i].toISOString()}`);
          }

        } catch (error) {
          console.error(`❌ Error generating post for user ${user.name}:`, error.message);
        }
      }

    } catch (error) {
      console.error(`❌ Error in generatePostsForUser for ${user.name}:`, error.message);
    }
  }

  // Calculate next posting dates based on user preferences
  calculateNextPostingDates(postingDays, postingTime, postsPerWeek) {
    const dates = [];
    const now = new Date();
    const [hour, minute] = postingTime.split(':').map(num => parseInt(num));

    // Sort posting days
    const sortedDays = [...postingDays].sort((a, b) => a - b);

    // Find next posting dates
    for (let week = 0; week < 2; week++) {
      for (const dayOfWeek of sortedDays) {
        const nextDate = new Date(now);
        nextDate.setDate(now.getDate() + (7 * week) + (dayOfWeek - now.getDay() + 7) % 7);
        nextDate.setHours(hour, minute, 0, 0);

        // Skip if the date is in the past
        if (nextDate > now) {
          dates.push(nextDate);
        }

        if (dates.length >= postsPerWeek) break;
      }
      if (dates.length >= postsPerWeek) break;
    }

    return dates.slice(0, postsPerWeek);
  }

  // Format date for database storage (PostgreSQL accepts ISO strings)
  formatDateForDB(date) {
    return date.toISOString();
  }

  // Schedule a one-time post
  async scheduleOneTimePost(userId, postData, scheduledDate) {
    try {
      const post = await PostsDB.createScheduledPost(userId, {
        ...postData,
        scheduled_for: scheduledDate.toISOString()
      });

      console.log(`📅 One-time post scheduled for user ${userId}: ${post.id}`);
      return post.id;

    } catch (error) {
      console.error(`❌ Error scheduling one-time post:`, error.message);
      throw error;
    }
  }

  // Get upcoming posts for a user
  async getUserUpcomingPosts(userId) {
    try {
      const posts = await PostsDB.getUserScheduledPosts(userId);
      return posts.filter(post => 
        post.status === 'pending' && new Date(post.scheduled_for) > new Date()
      );
    } catch (error) {
      console.error(`❌ Error getting upcoming posts for user ${userId}:`, error.message);
      return [];
    }
  }

  // Cancel a scheduled post
  async cancelScheduledPost(postId, userId) {
    try {
      const success = await PostsDB.deleteScheduledPost(postId, userId);
      if (success) {
        console.log(`🗑️ Cancelled scheduled post ${postId} for user ${userId}`);
      }
      return success;
    } catch (error) {
      console.error(`❌ Error cancelling post ${postId}:`, error.message);
      return false;
    }
  }
}

module.exports = new PostScheduler(); 