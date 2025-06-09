module.exports = {
  // Viral post format templates with psychological hooks
  viralFormats: [
    {
      id: "open_loop",
      label: "🧲 Open Loop Hook",
      description: "Creates curiosity gap that compels reading",
      prompt: "Write a LinkedIn post using an open loop hook that creates curiosity. Start with an intriguing statement or question that promises a payoff, then deliver valuable insight. Format: Hook → Brief setup → Insight/Lesson → Soft engagement CTA."
    },
    {
      id: "hot_take",
      label: "🔥 Contrarian Hot Take",
      description: "Unpopular opinion that sparks discussion",
      prompt: "Write a LinkedIn post starting with a contrarian opinion about [topic]. Begin with 'Unpopular opinion:' or 'Hot take:' then justify your position with personal experience or data. End with a question to encourage debate."
    },
    {
      id: "framework_list",
      label: "📋 Framework/List",
      description: "Actionable steps or framework",
      prompt: "Create a LinkedIn post sharing a 3-5 step framework or actionable list about [topic]. Use bold headers for each point with 1-2 line explanations. Make it immediately actionable and valuable."
    },
    {
      id: "confession_story",
      label: "💭 Confession + Lesson",
      description: "Vulnerable admission with professional insight",
      prompt: "Write a LinkedIn post starting with a personal confession or mistake related to [topic]. Build tension, then reveal the lesson learned. Make it relatable and tie to professional growth."
    },
    {
      id: "pattern_interrupt",
      label: "⚡ Pattern Interrupt",
      description: "Breaks expected thinking patterns",  
      prompt: "Create a LinkedIn post that challenges conventional wisdom about [topic]. Start with something unexpected or counterintuitive, then explain why the common approach is wrong and what works better."
    },
    {
      id: "story_arc",
      label: "📖 Story Arc",
      description: "Narrative structure with conflict resolution",
      prompt: "Write a LinkedIn post using a story structure: Setup (situation) → Conflict (challenge/problem) → Resolution (how it was solved) → Lesson (what others can learn). Keep it concise but engaging."
    },
    {
      id: "before_after",
      label: "🔄 Before vs After",
      description: "Transformation or comparison format",
      prompt: "Create a LinkedIn post showing a before vs after comparison related to [topic]. Could be mindset shifts, process improvements, or results. Make the contrast clear and the transformation inspiring."
    },
    {
      id: "myth_busting",
      label: "💥 Myth Busting", 
      description: "Debunks common misconceptions",
      prompt: "Write a LinkedIn post that debunks a common myth or misconception about [topic]. Start with 'Myth:', state the false belief, then provide 'Reality:' with the truth and supporting evidence."
    }
  ],

  // Engagement boosting techniques
  engagementHooks: {
    curiosity: [
      "Here's what nobody tells you about...",
      "I learned this lesson the hard way...",
      "This changed everything for me...",
      "You won't believe what happened when...",
      "The uncomfortable truth about..."
    ],
    
    social_proof: [
      "After working with 100+ clients...",
      "In my 10 years of experience...",
      "Top performers all do this one thing...",
      "The most successful people I know...",
      "Industry leaders agree on this..."
    ],
    
    urgency: [
      "This trend is happening right now...",
      "The window is closing on...",
      "If you're not doing this yet...",
      "Time is running out for...",
      "The future depends on..."
    ],
    
    controversy: [
      "Unpopular opinion:",
      "This might be controversial, but...",
      "I'll probably get hate for this...",
      "Most people get this wrong...",
      "Hot take:"
    ]
  },

  // Call-to-action variations
  softCTAs: [
    "What's your take on this?",
    "Have you experienced this too?",
    "What would you add to this list?",
    "Am I missing something here?",
    "Share your thoughts below 👇",
    "What's worked for you?",
    "Do you agree or disagree?",
    "What's your experience been?",
    "How do you handle this situation?",
    "What advice would you give?"
  ],

  // Twitter to LinkedIn adaptation patterns
  tweetAdaptationRules: {
    expansion: "Expand the core insight with professional context and personal experience",
    formatting: "Add line breaks, emojis sparingly, and structure for LinkedIn's format", 
    audience: "Adapt language from casual Twitter tone to professional but approachable LinkedIn tone",
    context: "Add more background context since LinkedIn audience expects more depth",
    cta: "Replace Twitter engagement patterns with LinkedIn-appropriate calls to action"
  },

  // Pre-cached viral tweet examples by topic (to avoid scraping)
  viralTweetBank: {
    "Artificial Intelligence": [
      {
        text: "AI won't replace you. A person using AI will.",
        author: "Anonymous",
        engagement_reason: "Simple, memorable, actionable truth"
      },
      {
        text: "Stop calling it AI. Start calling it 'Intelligent Assistance'. Changes the whole perspective.",
        author: "Tech Influencer",
        engagement_reason: "Reframing perspective"
      }
    ],
    
    "Leadership": [
      {
        text: "Great leaders don't create followers. They create more leaders.",
        author: "Leadership Expert", 
        engagement_reason: "Inspirational mindset shift"
      },
      {
        text: "Your title makes you a manager. Your team makes you a leader.",
        author: "Business Coach",
        engagement_reason: "Distinction that resonates"
      }
    ],
    
    "Productivity": [
      {
        text: "Busy is not a badge of honor. Results are.",
        author: "Productivity Expert",
        engagement_reason: "Challenges busy culture"
      },
      {
        text: "The most productive people don't manage time. They manage energy.",
        author: "Performance Coach", 
        engagement_reason: "Reframes productivity approach"
      }
    ],

    "Career Development": [
      {
        text: "Your network is your net worth, but your skills are your security.",
        author: "Career Coach",
        engagement_reason: "Balances networking with skill development"
      },
      {
        text: "Stop waiting for permission to level up. Give it to yourself.",
        author: "Professional Development",
        engagement_reason: "Empowering call to action"
      }
    ],

    "Remote Work": [
      {
        text: "Remote work isn't about working from home. It's about working from anywhere you're most productive.",
        author: "Remote Work Advocate",
        engagement_reason: "Reframes remote work concept"
      },
      {
        text: "The future of work isn't remote or in-office. It's flexible.",
        author: "Future of Work Expert",
        engagement_reason: "Balanced perspective on work trends"
      }
    ]
  },

  // Helper function to get random viral format
  getRandomViralFormat() {
    const formats = this.viralFormats;
    return formats[Math.floor(Math.random() * formats.length)];
  },

  // Helper function to get engagement hook by type
  getEngagementHook(type) {
    const hooks = this.engagementHooks[type];
    if (!hooks) return "";
    return hooks[Math.floor(Math.random() * hooks.length)];
  },

  // Helper function to get soft CTA
  getRandomCTA() {
    return this.softCTAs[Math.floor(Math.random() * this.softCTAs.length)];
  },

  // Helper function to get viral tweet for topic
  getViralTweet(topic) {
    const tweets = this.viralTweetBank[topic];
    if (!tweets || tweets.length === 0) return null;
    return tweets[Math.floor(Math.random() * tweets.length)];
  }
}; 