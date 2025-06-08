# LinkedIn Post Generator 🚀 with Automation

An AI-powered LinkedIn post generator with full automation capabilities. Creates engaging content based on real-time news and can automatically post to your LinkedIn profile on schedule.

![LinkedIn Post Generator](https://img.shields.io/badge/LinkedIn-Post%20Generator-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)
![Automation](https://img.shields.io/badge/Automation-Enabled-00A0B0?style=for-the-badge&logo=clockify&logoColor=white)

## ✨ Features

### 🤖 Content Generation
- 📰 **Real-time News Integration** - Fetches latest news from multiple APIs
- 🧠 **AI-Powered Content** - Uses OpenAI GPT-4 for professional LinkedIn posts
- 🖼️ **Automatic Image Fetching** - Relevant images from Pexels API
- 🎯 **LinkedIn Optimized** - Templates designed for maximum engagement
- 📝 **Multiple Tones** - Professional, thought leadership, conversational, analytical, motivational

### 🔄 LinkedIn Automation (NEW!)
- 🔐 **OAuth Integration** - Secure LinkedIn login with OAuth 2.0
- 📤 **Auto-Posting** - Post directly to LinkedIn with one click
- ⏰ **Smart Scheduling** - Schedule posts for optimal times
- 📊 **Frequency Control** - Set 1-7 posts per week
- 📅 **Day/Time Selection** - Choose specific posting schedule
- 🤖 **Full Automation** - Generates and posts content automatically

### 📊 Management Dashboard (NEW!)
- 👤 **User Authentication** - LinkedIn OAuth login
- ⚙️ **Settings Management** - Configure all automation preferences
- 📋 **Scheduled Posts** - View and manage upcoming posts
- 📈 **Activity Tracking** - Monitor posted content and performance
- 💾 **Data Persistence** - Settings saved automatically

### 🔒 Security & Performance
- 🛡️ **Secure Authentication** - LinkedIn OAuth 2.0 implementation
- ⚡ **Rate Limiting** - Built-in protection against API abuse
- 🔄 **Token Management** - Automatic refresh and expiration handling
- 🗄️ **Local Database** - SQLite for user data and schedules

## 🛠️ Technologies Used

- **Backend**: Node.js, Express.js
- **AI**: OpenAI GPT-4
- **News APIs**: NewsAPI, NewsData.io, GNews.io
- **Image APIs**: Unsplash, Pexels
- **Frontend**: Vanilla JavaScript, Modern CSS
- **Security**: Helmet, CORS, Rate Limiting

## 📋 Prerequisites

- Node.js 16+ and npm 8+
- OpenAI API key (required)
- At least one News API key (optional - will use mock data if unavailable)
- Image API key (optional - for automatic image fetching)

## 🚀 Quick Start

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd linkedinpost
npm install
```

### 2. Environment Setup

Copy the example environment file and add your API keys:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```env
# Required
OPENAI_API_KEY=sk-proj-your_openai_api_key_here

# Optional - Choose at least one news API
NEWS_API_KEY=your_newsapi_org_key_here
NEWSDATA_API_KEY=your_newsdata_io_key_here
GNEWS_API_KEY=your_gnews_io_key_here

# Optional - Choose one image API
UNSPLASH_ACCESS_KEY=your_unsplash_access_key_here
PEXELS_API_KEY=your_pexels_api_key_here

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 3. Get API Keys

#### OpenAI (Required)
1. Visit [OpenAI Platform](https://platform.openai.com)
2. Create account and add billing information
3. Generate API key from API Keys section
4. Cost: ~$0.002 per post generation

#### News APIs (Choose One - Free Tiers Available)
- **NewsAPI**: [newsapi.org](https://newsapi.org) - 100 requests/day free
- **NewsData**: [newsdata.io](https://newsdata.io) - 200 requests/day free  
- **GNews**: [gnews.io](https://gnews.io) - 100 requests/day free

#### Image APIs (Optional - Free Tiers Available)
- **Unsplash**: [unsplash.com/developers](https://unsplash.com/developers) - 50 requests/hour free
- **Pexels**: [pexels.com/api](https://pexels.com/api) - 200 requests/hour free

### 4. LinkedIn OAuth Setup (For Automation Features)

To enable automatic posting and scheduling:

1. **Create LinkedIn Developer App**
   - Visit [LinkedIn Developers](https://www.linkedin.com/developers/)
   - Create a new app and get Client ID/Secret
   - Add callback URL: `http://localhost:3000/auth/linkedin/callback`

2. **Update .env with LinkedIn credentials**:
   ```env
   LINKEDIN_CLIENT_ID=your_linkedin_client_id_here
   LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret_here
   LINKEDIN_CALLBACK_URL=http://localhost:3000/auth/linkedin/callback
   SESSION_SECRET=your_random_session_secret
   ```

3. **Request LinkedIn API Access**
   - Enable "Sign In with LinkedIn"
   - Request "Share on LinkedIn" (may require approval)

**📖 Detailed LinkedIn setup guide**: See [LINKEDIN_SETUP.md](LINKEDIN_SETUP.md)

### 5. Start the Application

```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

Visit `http://localhost:3000` in your browser.

## 📖 Usage

### Manual Post Generation
1. **Select Topic**: Choose from 20+ categories or enter custom topic
2. **Choose Tone**: Professional, Thought Leadership, Conversational, Analytical, or Motivational
3. **Generate**: Click "Find Latest News & Generate Post"
4. **Review**: Check the generated post, source article, and relevant image
5. **Copy or Post**: Copy to clipboard OR login and post directly to LinkedIn

### Automation Features (After LinkedIn Login)
1. **Login**: Click "Login with LinkedIn for Auto-Posting"
2. **Configure Settings**:
   - Enable automatic posting
   - Set posts per week (1-7)
   - Choose posting days and times
   - Set default topics and tone
3. **Monitor**: View scheduled posts and recent activity
4. **Manual Override**: Generate and post immediately when needed

### Scheduling Options
- **Frequency**: 1-7 posts per week
- **Days**: Choose specific weekdays
- **Time**: Set preferred posting time
- **Topics**: Rotate through your selected topics automatically

## 🎯 Topic Categories

- 🤖 Artificial Intelligence
- 🔒 Cybersecurity  
- 📊 Digital Marketing
- 🏠 Remote Work
- 🌱 Sustainability
- 💳 Financial Technology
- 🏥 Healthcare Innovation
- 🛒 E-commerce
- 📈 Data Science
- 👥 Leadership
- 🚀 Startup
- ⛓️ Blockchain
- ☁️ Cloud Computing
- 📱 Social Media
- 📋 Project Management

## 🔧 API Endpoints

- `GET /` - Serve the main application
- `POST /api/generate-post` - Generate LinkedIn post
- `GET /api/news/:topic` - Fetch news for specific topic
- `GET /api/health` - Check server and API status

## ⚙️ Configuration

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for content generation | - |
| `NEWS_API_KEY` | No | NewsAPI.org API key | - |
| `NEWSDATA_API_KEY` | No | NewsData.io API key | - |
| `GNEWS_API_KEY` | No | GNews.io API key | - |
| `UNSPLASH_ACCESS_KEY` | No | Unsplash API key for images | - |
| `PEXELS_API_KEY` | No | Pexels API key for images | - |
| `PORT` | No | Server port | 3000 |
| `NODE_ENV` | No | Environment mode | development |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window | 900000 (15 min) |
| `RATE_LIMIT_MAX_REQUESTS` | No | Max requests per window | 100 |

### Rate Limiting

Default: 100 requests per 15 minutes per IP address. Adjust in environment variables if needed.

## 🛡️ Security Features

- Helmet.js for security headers
- CORS protection
- Rate limiting per IP
- Environment-based API key management
- Input validation and sanitization

## 🎨 UI/UX Features

- LinkedIn-inspired design with official colors (#0077B5)
- Responsive design for all devices
- Loading states and progress indicators
- Success/error message handling
- Smooth animations and transitions
- Copy-to-clipboard functionality
- Auto-scroll to generated content

## 🔍 Troubleshooting

### Common Issues

**"OpenAI API key not configured"**
- Ensure `OPENAI_API_KEY` is set in your `.env` file
- Verify the API key is valid and has billing enabled

**"Using mock data" warning**
- Add at least one news API key to fetch real news
- The app works with mock data but real news provides better content

**Rate limit errors**
- Default limit is 100 requests per 15 minutes
- Adjust `RATE_LIMIT_MAX_REQUESTS` if needed

**CORS errors in development**
- Ensure you're accessing via `http://localhost:3000`
- Check that CORS is properly configured

### Debug Mode

Set `NODE_ENV=development` for detailed error logging.

## 💰 Cost Estimation

- **OpenAI GPT-4**: ~$0.002 per post generation
- **News APIs**: Free tiers available (100-200 requests/day)
- **Image APIs**: Free tiers available (50-200 requests/hour)

**Monthly cost for moderate usage**: $1-5

## 📁 Project Structure

```
linkedinpost/
├── server.js              # Express server and API logic
├── package.json           # Dependencies and scripts
├── .env.example          # Environment variables template
├── README.md             # This file
└── public/               # Frontend files
    ├── index.html        # Main HTML page
    ├── styles.css        # LinkedIn-styled CSS
    └── script.js         # Frontend JavaScript
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- OpenAI for GPT-4 API
- NewsAPI, NewsData.io, and GNews.io for news data
- Unsplash and Pexels for stock images
- LinkedIn for design inspiration

## 📞 Support

If you encounter any issues or have questions:

1. Check the troubleshooting section above
2. Review your API keys and environment variables
3. Check the browser console for error messages
4. Ensure all dependencies are installed (`npm install`)

---

**Built with ❤️ for content creators who want to make LinkedIn posting effortless and engaging!** 