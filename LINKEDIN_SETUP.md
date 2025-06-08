# 🔗 LinkedIn OAuth Setup Guide

This guide explains how to set up LinkedIn OAuth integration to enable automatic posting and scheduling features.

## 📋 Prerequisites

1. A LinkedIn account
2. Your LinkedIn Post Generator application running
3. The updated code with automation features

## 🚀 Step 1: Create a LinkedIn Developer Application

### 1.1 Go to LinkedIn Developers
Visit: https://www.linkedin.com/developers/

### 1.2 Create a New App
1. Click "Create app"
2. Fill in the required information:
   - **App name**: "LinkedIn Post Generator" (or your preferred name)
   - **LinkedIn Page**: Select your LinkedIn company page (or create one if needed)
   - **Privacy policy URL**: `http://localhost:3000/privacy` (you can create a simple privacy page)
   - **App logo**: Upload a logo (optional but recommended)

### 1.3 Configure App Settings
1. After creating the app, go to the "Auth" tab
2. Add the following **Authorized redirect URLs**:
   ```
   http://localhost:3000/auth/linkedin/callback
   ```
   
   For production, also add:
   ```
   https://yourdomain.com/auth/linkedin/callback
   ```

### 1.4 Request API Access
1. Go to the "Products" tab
2. Request access to:
   - **Sign In with LinkedIn** (should be automatically available)
   - **Share on LinkedIn** (this may require approval)
   - **Marketing Developer Platform** (optional, for more advanced features)

## 🔑 Step 2: Get Your Credentials

### 2.1 Find Your App Credentials
1. Go to the "Auth" tab of your LinkedIn app
2. Copy the following values:
   - **Client ID**
   - **Client Secret**

### 2.2 Update Your .env File
Replace the placeholders in your `.env` file:

```env
# LinkedIn OAuth Configuration
LINKEDIN_CLIENT_ID=your_actual_client_id_here
LINKEDIN_CLIENT_SECRET=your_actual_client_secret_here
LINKEDIN_CALLBACK_URL=http://localhost:3000/auth/linkedin/callback
```

## 🔐 Step 3: LinkedIn App Permissions

Make sure your LinkedIn app has the following scopes enabled:

### Required Scopes:
- `r_liteprofile` - Basic profile information
- `r_emailaddress` - Email address
- `w_member_social` - Post to LinkedIn

### How to Check/Enable Scopes:
1. In your LinkedIn app, go to "Auth" tab
2. Under "OAuth 2.0 scopes", ensure the required scopes are listed
3. If not available, you may need to request access via the "Products" tab

## 🌐 Step 4: Test the Integration

### 4.1 Start Your Application
```bash
npm start
```

### 4.2 Test Authentication
1. Open `http://localhost:3000`
2. Click "Login with LinkedIn for Auto-Posting"
3. You should be redirected to LinkedIn's authorization page
4. Grant permissions
5. You should be redirected back to your app with authentication complete

### 4.3 Verify Features Work
- ✅ User profile shows in header
- ✅ Automation dashboard appears
- ✅ Generate a post and try "Post Current Content to LinkedIn"
- ✅ Set up automation settings
- ✅ Schedule posts

## 🚨 Important Notes

### Development vs Production
- The callback URL must match exactly what you set in LinkedIn app settings
- For local development: `http://localhost:3000/auth/linkedin/callback`
- For production: `https://yourdomain.com/auth/linkedin/callback`

### LinkedIn Review Process
- Some LinkedIn API products require review and approval
- **Share on LinkedIn** might require manual approval from LinkedIn
- This can take several days to weeks
- Your app will work for you (the developer) immediately, but may not work for other users until approved

### Rate Limiting
- LinkedIn has strict rate limits for posting
- Our application includes built-in rate limiting to comply
- Don't exceed posting frequency guidelines

## 🔧 Troubleshooting

### "Invalid Redirect URI" Error
- Double-check your callback URL in LinkedIn app settings
- Ensure the URL matches exactly (including http/https)
- Make sure there are no trailing slashes

### "Insufficient Permissions" Error
- Verify all required scopes are enabled
- Check if your app needs approval for certain products
- Make sure you're using the correct Client ID/Secret

### "Access Token Expired" Error
- The app handles token refresh automatically
- If issues persist, try logging out and logging back in

### LinkedIn App Not Approved
- You can still test with your own LinkedIn account
- Other users won't be able to use the feature until approved
- Consider applying for LinkedIn Partner Program for faster approval

## 📚 Additional Resources

- [LinkedIn API Documentation](https://docs.microsoft.com/linkedin/)
- [LinkedIn Marketing Developer Platform](https://docs.microsoft.com/linkedin/marketing/)
- [OAuth 2.0 Guide](https://docs.microsoft.com/linkedin/shared/authentication/authorization-code-flow)

## 🎯 Next Steps

Once LinkedIn OAuth is set up:

1. **Configure Automation Settings**
   - Set posting frequency (1-7 posts per week)
   - Choose posting days and times
   - Set default topics and tone

2. **Test Automated Posting**
   - Generate posts manually
   - Post immediately to LinkedIn
   - Schedule posts for later

3. **Monitor Performance**
   - Check scheduled posts
   - Review recent activity
   - Adjust settings as needed

## 💡 Pro Tips

- **Start with manual posting** to ensure everything works
- **Use scheduling wisely** - don't over-post
- **Monitor engagement** on your LinkedIn posts
- **Customize topics** to match your industry/interests
- **Test thoroughly** before enabling full automation

---

**Need help?** If you encounter issues, check the console logs in your browser and server terminal for specific error messages. 