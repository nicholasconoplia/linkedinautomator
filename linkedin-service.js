const axios = require('axios');
const { UserDB } = require('./database');

class LinkedInService {
  constructor() {
    this.apiBaseUrl = 'https://api.linkedin.com/v2';
    this.postsApiBaseUrl = 'https://api.linkedin.com/rest';
    this.linkedinVersion = '202505'; // May 2025 - current active version
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

      // If there's an image, upload it and attach to the post
      if (imageUrl) {
        console.log('🖼️ Uploading image to LinkedIn:', imageUrl);
        
        try {
          const mediaUrn = await this.uploadImage(accessToken, imageUrl, authorId);
          console.log('✅ Image uploaded successfully, media URN:', mediaUrn);
          
          // Add the image to the post content
          postData.content = {
            media: {
              title: 'Uploaded Image',
              id: mediaUrn
            }
          };
        } catch (imageError) {
          console.error('❌ Image upload failed, posting without image:', imageError.message);
          // Continue with text-only post if image upload fails
        }
      }

      console.log('📤 Posting to LinkedIn with data:', JSON.stringify(postData, null, 2));

      // Create the post using the modern Posts API
      const response = await axios.post(`${this.postsApiBaseUrl}/posts`, postData, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
          'LinkedIn-Version': this.linkedinVersion // Using known stable version
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

  // Upload image to LinkedIn and return media URN
  async uploadImage(accessToken, imageUrl, authorId) {
    try {
      // Step 1: Download the image
      console.log('⬇️ Downloading image from URL:', imageUrl);
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000 // 30 second timeout
      });
      
      const imageBuffer = Buffer.from(imageResponse.data);
      const contentType = imageResponse.headers['content-type'] || 'image/jpeg';
      
      console.log('📊 Image downloaded:', {
        size: imageBuffer.length,
        contentType: contentType
      });

      // Step 2: Register the upload with LinkedIn
      const registerUploadRequest = {
        registerUploadRequest: {
          recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
          owner: `urn:li:person:${authorId}`,
          serviceRelationships: [
            {
              relationshipType: 'OWNER',
              identifier: 'urn:li:userGeneratedContent'
            }
          ]
        }
      };

      console.log('📝 Registering upload with LinkedIn...');
      const registerResponse = await axios.post(`${this.apiBaseUrl}/assets?action=registerUpload`, registerUploadRequest, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'LinkedIn-Version': this.linkedinVersion
        }
      });

      const uploadMechanism = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'];
      const asset = registerResponse.data.value.asset;
      
      console.log('✅ Upload registered, asset:', asset);

      // Step 3: Upload the actual image binary data
      console.log('⬆️ Uploading image binary data...');
      await axios.put(uploadMechanism.uploadUrl, imageBuffer, {
        headers: {
          'Content-Type': contentType,
          ...uploadMechanism.headers
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      });

      console.log('✅ Image binary upload completed');
      return asset;

    } catch (error) {
      console.error('❌ Image upload error:', {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
      throw new Error(`Image upload failed: ${error.message}`);
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