const axios = require('axios');
const { UserDB } = require('./database');

class LinkedInService {
  constructor() {
    this.apiBaseUrl = 'https://api.linkedin.com/v2';
    this.postsApiBaseUrl = 'https://api.linkedin.com/rest';
    // Removed linkedinVersion - using default LinkedIn API without version header
  }

  // Post content to LinkedIn using the modern Posts API
  async createPost(accessToken, postContent, imageUrl = null) {
    try {
      // First, get the user's profile ID using the userinfo endpoint
      const profileResponse = await axios.get(`${this.apiBaseUrl}/userinfo`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      // The userinfo endpoint returns 'sub' as the user ID
      const authorId = profileResponse.data.sub;
      console.log('📋 LinkedIn user ID retrieved:', authorId);

      // Prepare the post data using the new Posts API format
      let postData = {
        author: `urn:li:person:${authorId}`,
        commentary: postContent,
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: []
        },
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false
      };

      // If there's an image, include it in the text for now
      // LinkedIn's image upload process requires separate API calls
      if (imageUrl) {
        postData.commentary += `\n\n🖼️ Image: ${imageUrl}`;
      }

      console.log('📤 Posting to LinkedIn with data:', JSON.stringify(postData, null, 2));

      // Create the post using the modern Posts API
      const response = await axios.post(`${this.postsApiBaseUrl}/posts`, postData, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
          // Removed LinkedIn-Version header - using default API version
        }
      });

      console.log('✅ LinkedIn post created successfully:', response.data);

      return {
        success: true,
        postId: response.headers['x-restli-id'] || response.data.id,
        data: response.data
      };

    } catch (error) {
      console.error('❌ LinkedIn posting error:', error.response?.data || error.message);
      console.error('❌ Full error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers,
        data: error.response?.data
      });
      
      return {
        success: false,
        error: error.response?.data?.message || error.response?.data?.error || error.message,
        statusCode: error.response?.status,
        details: error.response?.data
      };
    }
  }

  // Get user profile information
  async getUserProfile(accessToken) {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/userinfo`, {
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