const axios = require('axios');
const { UserDB } = require('./database');

class LinkedInService {
  constructor() {
    this.apiBaseUrl = 'https://api.linkedin.com/v2';
  }

  // Post content to LinkedIn
  async createPost(accessToken, postContent, imageUrl = null) {
    try {
      // First, get the user's profile ID
      const profileResponse = await axios.get(`${this.apiBaseUrl}/people/~`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const authorId = profileResponse.data.id;

      // Prepare the post data
      const postData = {
        author: `urn:li:person:${authorId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: postContent
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      };

      // If there's an image, add it to the post
      if (imageUrl) {
        // For now, we'll include the image URL in the text
        // LinkedIn's image upload process is more complex and requires additional steps
        postData.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text += 
          `\n\n🖼️ Image: ${imageUrl}`;
      }

      // Create the post
      const response = await axios.post(`${this.apiBaseUrl}/ugcPosts`, postData, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      });

      return {
        success: true,
        postId: response.data.id,
        data: response.data
      };

    } catch (error) {
      console.error('❌ LinkedIn posting error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        statusCode: error.response?.status
      };
    }
  }

  // Get user profile information
  async getUserProfile(accessToken) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/people/~`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        success: true,
        profile: response.data
      };

    } catch (error) {
      console.error('❌ LinkedIn profile fetch error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  // Refresh access token
  async refreshAccessToken(refreshToken) {
    try {
      const response = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      return {
        success: true,
        tokens: {
          access_token: response.data.access_token,
          refresh_token: response.data.refresh_token || refreshToken,
          expires_at: Date.now() + (response.data.expires_in * 1000)
        }
      };

    } catch (error) {
      console.error('❌ Token refresh error:', error.response?.data || error.message);
      
      return {
        success: false,
        error: error.response?.data?.error_description || error.message
      };
    }
  }

  // Check if token is expired and refresh if needed
  async ensureValidToken(userId) {
    try {
      const user = await UserDB.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if token is expired (with 5 minute buffer)
      const now = Date.now();
      const expiresAt = user.token_expires_at;
      
      if (expiresAt && (now + 300000) >= expiresAt && user.refresh_token) {
        console.log('🔄 Refreshing LinkedIn token for user:', user.name);
        
        const refreshResult = await this.refreshAccessToken(user.refresh_token);
        
        if (refreshResult.success) {
          await UserDB.updateTokens(userId, refreshResult.tokens);
          return refreshResult.tokens.access_token;
        } else {
          throw new Error('Failed to refresh token: ' + refreshResult.error);
        }
      }

      return user.access_token;

    } catch (error) {
      console.error('❌ Token validation error:', error.message);
      throw error;
    }
  }

  // Validate that a token still works
  async validateToken(accessToken) {
    try {
      const profileResult = await this.getUserProfile(accessToken);
      return profileResult.success;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new LinkedInService(); 