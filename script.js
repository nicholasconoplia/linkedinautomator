// PostPilot - AI-Driven LinkedIn Content Platform
class PostPilotApp {
    constructor() {
        // Core elements
        this.form = document.getElementById('postForm');
        this.generateBtn = document.getElementById('generateBtn');
        this.loader = document.getElementById('loader');
        this.output = document.getElementById('output');
        this.copyBtn = document.getElementById('copyBtn');
        this.regenerateBtn = document.getElementById('regenerateBtn');
        this.postOptions = document.getElementById('postOptions');
        this.postBtn = document.getElementById('postBtn');
        
        // Topic input elements
        this.topicInput = document.getElementById('topic');
        this.topicChips = document.querySelectorAll('.topic-chip');
        this.toneSelect = document.getElementById('tone');
        this.lengthSelect = document.getElementById('length');
        
        // Authentication elements
        this.authSection = document.getElementById('authSection');
        this.loginSection = document.getElementById('loginSection');
        this.userSection = document.getElementById('userSection');
        this.userName = document.getElementById('userName');
        
        // Debug element detection
        console.log('🔍 Element detection:');
        console.log('  - loginSection:', !!this.loginSection);
        console.log('  - userSection:', !!this.userSection);
        console.log('  - userName:', !!this.userName);
        
        // Activity elements
        this.activityList = document.getElementById('activityList');
        
        // State
        this.currentPost = null;
        this.currentImageUrl = null;
        this.currentArticleData = null;
        this.isLoggedIn = false;
        this.currentUser = null;
        
        this.init();
    }
    
    async init() {
        console.log('🚀 PostPilot initializing...');
        
        // Setup event listeners
        this.setupEventListeners();
        this.setupTopicChips();
        this.addFormInteractions();
        
        // Check authentication status
        await this.checkAuthStatus();
        
        // Load recent activity
        this.loadRecentActivity();
        
        // Check if user just authenticated
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('authenticated') === 'true') {
            window.history.replaceState({}, document.title, window.location.pathname);
            await this.checkAuthStatus();
        }
        
        console.log('✅ PostPilot ready!');
    }
    
    setupEventListeners() {
        // Form handlers
        this.form.addEventListener('submit', this.handleFormSubmit.bind(this));
        
        if (this.copyBtn) {
            this.copyBtn.addEventListener('click', this.copyToClipboard.bind(this));
        }
        
        if (this.regenerateBtn) {
            this.regenerateBtn.addEventListener('click', this.regeneratePost.bind(this));
        }
        
        if (this.postBtn) {
            this.postBtn.addEventListener('click', this.handlePostToLinkedIn.bind(this));
        }
        
        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeyboardShortcuts.bind(this));
    }
    
    setupTopicChips() {
        this.topicChips.forEach(chip => {
            chip.addEventListener('click', () => {
                // Remove selected class from all chips
                this.topicChips.forEach(c => c.classList.remove('selected'));
                
                // Add selected class to clicked chip
                chip.classList.add('selected');
                
                // Set the topic in the input field
                const topic = chip.getAttribute('data-topic');
                this.topicInput.value = topic;
                
                // Add animation effect
                chip.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    chip.style.transform = '';
                }, 150);
                
                console.log(`📌 Selected topic: ${topic}`);
            });
        });
        
        // Clear selection when user types in input
        this.topicInput.addEventListener('input', () => {
            if (this.topicInput.value.trim() === '') {
                this.topicChips.forEach(c => c.classList.remove('selected'));
            }
        });
    }

    handleKeyboardShortcuts(e) {
        // Ctrl/Cmd + Enter to generate
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            this.form.dispatchEvent(new Event('submit'));
        }
        
        // Ctrl/Cmd + C to copy (when content is generated)
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && this.currentPost && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.copyToClipboard();
        }
    }

    async checkAuthStatus() {
        console.log('🔍 Checking authentication status...');
        try {
            const response = await fetch('/api/auth-status');
            
            if (response.ok) {
                const authData = await response.json();
                console.log('📋 Auth response:', authData);
                
                if (authData.authenticated && authData.user) {
                    console.log('✅ User is authenticated:', authData.user.name);
                    this.currentUser = authData.user;
                    this.isLoggedIn = true;
                    this.showAuthenticatedState();
                } else {
                    console.log('ℹ️ User is not authenticated');
                    this.currentUser = null;
                    this.isLoggedIn = false;
                    this.showUnauthenticatedState();
                }
            } else {
                console.log('❌ Auth status request failed:', response.status);
                this.showUnauthenticatedState();
            }
        } catch (error) {
            console.error('❌ Auth check failed:', error);
            this.showUnauthenticatedState();
        }
        
        this.updatePostButtonState();
    }
    
    showAuthenticatedState() {
        console.log('🟢 Showing authenticated state for:', this.currentUser?.name);
        
        if (this.loginSection) {
            console.log('🔸 Hiding login section');
            this.loginSection.style.display = 'none';
        } else {
            console.log('⚠️ Login section not found');
        }
        
        if (this.userSection) {
            console.log('🔸 Showing user section');
            this.userSection.style.display = 'block';
        } else {
            console.log('⚠️ User section not found');
        }
        
        if (this.userName && this.currentUser) {
            console.log('🔸 Setting user name:', this.currentUser.name);
            this.userName.textContent = this.currentUser.name;
        } else {
            console.log('⚠️ User name element or user data not found');
        }
    }
    
    showUnauthenticatedState() {
        console.log('🔴 Showing unauthenticated state');
        if (this.loginSection) {
            this.loginSection.style.display = 'block';
        }
        if (this.userSection) {
            this.userSection.style.display = 'none';
        }
        this.currentUser = null;
        this.isLoggedIn = false;
    }

    updatePostButtonState() {
        if (this.postBtn) {
            if (this.isLoggedIn && this.currentPost) {
                this.postBtn.disabled = false;
                this.postBtn.textContent = '🚀 Post to LinkedIn';
            } else if (!this.isLoggedIn) {
                this.postBtn.disabled = true;
                this.postBtn.textContent = 'Connect LinkedIn to Post';
            } else {
                this.postBtn.disabled = true;
                this.postBtn.textContent = 'Generate Content First';
            }
        }
    }
    
    async loadUserData() {
        // Only load user data if authenticated
        if (!this.currentUser) {
            console.log('🚫 Skipping user data load - not authenticated');
            return;
        }
        
        try {
            console.log('📥 Loading user data...');
            
            // Load user preferences
            const prefsResponse = await fetch('/api/preferences');
            if (prefsResponse.ok) {
                const prefsText = await prefsResponse.text();
                if (prefsText && prefsText !== 'undefined') {
                    this.userPreferences = JSON.parse(prefsText);
                    this.populateAutomationForm();
                }
            } else {
                console.log('⚠️ Preferences not available:', prefsResponse.status);
            }
            
            // Load scheduled posts
            await this.loadScheduledPosts();
            
            // Load recent activity
            await this.loadRecentActivity();
        } catch (error) {
            console.error('Failed to load user data:', error);
        }
    }
    
    populateAutomationForm() {
        if (!this.userPreferences || !this.automationForm) return;
        
        const form = this.automationForm;
        form.querySelector('#autoPosting').checked = this.userPreferences.auto_posting_enabled;
        form.querySelector('#postsPerWeek').value = this.userPreferences.posts_per_week;
        form.querySelector('#postingTime').value = this.userPreferences.posting_time;
        form.querySelector('#defaultTopics').value = this.userPreferences.topics;
        form.querySelector('#defaultTone').value = this.userPreferences.tone;
        
        // Set posting days
        const days = this.userPreferences.posting_days.split(',');
        form.querySelectorAll('.days-selector input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = days.includes(checkbox.value);
        });
        
        // Update dashboard highlights
        this.updateDashboardHighlights();
    }
    
    updateDashboardHighlights() {
        // Update posts per week display
        const postsPerWeekDisplay = document.getElementById('postsPerWeekDisplay');
        if (postsPerWeekDisplay && this.userPreferences) {
            postsPerWeekDisplay.textContent = this.userPreferences.posts_per_week || '3';
        }
        
        // Update automation status
        const automationStatus = document.getElementById('automationStatus');
        if (automationStatus && this.userPreferences) {
            const isEnabled = this.userPreferences.auto_posting_enabled;
            automationStatus.textContent = isEnabled ? '🟢 Enabled' : '🔴 Disabled';
        }
    }
    
    scrollToDashboard() {
        if (this.automationPanel) {
            this.automationPanel.scrollIntoView({ 
                behavior: 'smooth',
                block: 'start'
            });
        }
    }
    
    async loadScheduledPosts() {
        if (!this.scheduledPostsList || !this.currentUser) return;
        
        try {
            const response = await fetch('/api/scheduled-posts');
            if (response.ok) {
                const postsText = await response.text();
                if (postsText && postsText !== 'undefined') {
                    const posts = JSON.parse(postsText);
                    this.displayScheduledPosts(posts);
                }
            } else {
                console.log('⚠️ Scheduled posts not available:', response.status);
            }
        } catch (error) {
            console.error('Failed to load scheduled posts:', error);
            this.scheduledPostsList.innerHTML = '<div class="loading">Failed to load posts</div>';
        }
    }
    
    displayScheduledPosts(posts) {
        if (!this.scheduledPostsList) return;
        
        // Update scheduled posts count in dashboard
        const scheduledPostsCount = document.getElementById('scheduledPostsCount');
        if (scheduledPostsCount) {
            scheduledPostsCount.textContent = posts.length;
        }
        
        if (posts.length === 0) {
            this.scheduledPostsList.innerHTML = '<div class="loading">No scheduled posts</div>';
            return;
        }
        
        const html = posts.map(post => `
            <div class="scheduled-post-item">
                <div class="post-topic">${post.topic}</div>
                <div class="post-scheduled-time">Scheduled for: ${new Date(post.scheduled_for).toLocaleString()}</div>
                <div class="post-status ${post.status}">${post.status}</div>
            </div>
        `).join('');
        
        this.scheduledPostsList.innerHTML = html;
    }
    
    async loadRecentActivity() {
        if (!this.activityList) return;
        
        if (!this.isLoggedIn) {
            this.activityList.innerHTML = '<div class="loading">Connect LinkedIn to view activity</div>';
            return;
        }
        
        // Mock recent activity data for now since the API endpoint doesn't exist yet
        const mockActivities = [
            {
                title: 'Generated AI content about Technology',
                timestamp: Date.now() - 1000 * 60 * 15, // 15 minutes ago
                status: 'posted'
            },
            {
                title: 'Generated AI content about Leadership',
                timestamp: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
                status: 'posted'
            },
            {
                title: 'Generated AI content about Innovation',
                timestamp: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
                status: 'posted'
            }
        ];
        
        try {
            this.activityList.innerHTML = mockActivities.map(activity => `
                <div class="activity-item">
                    <div class="activity-content">
                        <div class="activity-title">${activity.title}</div>
                        <div class="activity-time">${this.formatDate(activity.timestamp)}</div>
                    </div>
                    <div class="activity-status ${activity.status}">${activity.status}</div>
                </div>
            `).join('');
        } catch (error) {
            console.error('❌ Error loading activity:', error);
            this.activityList.innerHTML = '<div class="loading">Failed to load activity</div>';
        }
    }
    
    displayRecentActivity(posts) {
        if (!this.recentActivity) return;
        
        if (posts.length === 0) {
            this.recentActivity.innerHTML = '<div class="loading">No recent activity</div>';
            return;
        }
        
        const html = posts.map(post => `
            <div class="activity-item">
                <div class="activity-content">
                    <div class="activity-title">${post.topic}</div>
                    <div class="activity-time">${new Date(post.posted_at || post.scheduled_for).toLocaleDateString()}</div>
                </div>
                <div class="activity-status ${post.status}">${post.status}</div>
            </div>
        `).join('');
        
        this.recentActivity.innerHTML = html;
    }
    
    async handleLogout(e) {
        e.preventDefault();
        
        try {
            const response = await fetch('/api/logout', { method: 'POST' });
            if (response.ok) {
                this.showUnauthenticatedState();
                this.showSuccess('Logged out successfully');
                // Redirect to home page to clear any authentication state
                setTimeout(() => window.location.href = '/', 1000);
            } else {
                this.showError('Logout failed');
            }
        } catch (error) {
            console.error('Logout failed:', error);
            this.showError('Logout failed');
        }
    }
    
    async handleSaveSettings(e) {
        e.preventDefault();
        
        const formData = new FormData(this.automationForm);
        const days = Array.from(this.automationForm.querySelectorAll('.days-selector input:checked'))
            .map(input => input.value);
        
        const preferences = {
            auto_posting_enabled: formData.get('autoPosting') === 'on',
            posts_per_week: parseInt(formData.get('postsPerWeek')),
            posting_days: days.join(','),
            posting_time: formData.get('postingTime'),
            topics: formData.get('defaultTopics'),
            tone: formData.get('defaultTone')
        };
        
        try {
            const response = await fetch('/api/preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preferences)
            });
            
            if (response.ok) {
                this.userPreferences = preferences;
                this.showSuccess('Settings saved successfully!');
            } else {
                throw new Error('Failed to save settings');
            }
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.showError('Failed to save settings');
        }
    }
    
    async handleQuickSchedule(e) {
        e.preventDefault();
        
        const formData = new FormData(this.quickScheduleForm);
        const postData = {
            topic: formData.get('quickTopic'),
            tone: formData.get('quickTone'),
            scheduled_for: formData.get('quickDateTime')
        };
        
        try {
            const response = await fetch('/api/schedule-post', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postData)
            });
            
            if (response.ok) {
                this.showSuccess('Post scheduled successfully!');
                this.quickScheduleForm.reset();
                await this.loadScheduledPosts();
            } else {
                throw new Error('Failed to schedule post');
            }
        } catch (error) {
            console.error('Failed to schedule post:', error);
            this.showError('Failed to schedule post');
        }
    }
    
    async handlePostToLinkedIn() {
        if (!this.currentPost) {
            this.showError('Generate a post first');
            return;
        }
        
        try {
            // Get the selected post type
            const selectedPostType = document.querySelector('input[name="postType"]:checked')?.value || 'image';
            const useArticleLink = selectedPostType === 'link';
            
            // Clean and validate the article URL
            let cleanArticleUrl = null;
            if (this.currentPost.article?.url && this.currentPost.article.url !== '#') {
                cleanArticleUrl = this.cleanUrl(this.currentPost.article.url);
                console.log('📋 Using article URL:', cleanArticleUrl);
            }
            
            const postData = {
                content: this.currentPost.post,
                imageUrl: useArticleLink ? null : this.currentPost.image?.url,
                articleUrl: cleanArticleUrl,
                useArticleLink: useArticleLink
            };
            
            console.log('📤 Posting with data:', postData);
            
            const response = await fetch('/api/post-now', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postData)
            });
            
            if (response.ok) {
                const result = await response.json();
                this.showSuccess(`Posted to LinkedIn successfully! ${useArticleLink ? '(with article link preview)' : '(with image)'}`);
                await this.loadRecentActivity();
            } else {
                const error = await response.json();
                
                // Handle duplicate content error with helpful suggestion
                if (error.error && error.error.includes('similar to a recent post')) {
                    this.showDuplicateContentError();
                    return;
                }
                
                throw new Error(error.error || 'Failed to post to LinkedIn');
            }
        } catch (error) {
            console.error('Failed to post to LinkedIn:', error);
            this.showError('Failed to post to LinkedIn: ' + error.message);
        }
    }
    
    // Clean and validate URL to prevent 404 errors
    cleanUrl(url) {
        if (!url) return null;
        
        // Remove any leading/trailing whitespace
        url = url.trim();
        
        // Ensure the URL has a protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }
        
        // Remove any invalid characters that might cause issues
        url = url.replace(/[\s\n\r\t]/g, '');
        
        // Remove trailing slashes and fragments that might cause issues
        url = url.replace(/\/+$/, '').split('#')[0];
        
        // Validate the URL format
        try {
            new URL(url);
            return url;
        } catch (error) {
            console.warn('⚠️ Invalid URL format:', url);
            return null;
        }
    }
    
    // Original methods (updated for new structure)
    addFormInteractions() {
        const inputs = this.form.querySelectorAll('select, input[type="text"]');
        inputs.forEach(input => {
            input.addEventListener('focus', (e) => {
                e.target.closest('.form-group').classList.add('focused');
            });
            
            input.addEventListener('blur', (e) => {
                e.target.closest('.form-group').classList.remove('focused');
            });
            
            if (input.tagName === 'SELECT') {
                input.addEventListener('mouseenter', (e) => {
                    if (!e.target.matches(':focus')) {
                        e.target.style.borderColor = 'var(--linkedin-dark-75)';
                    }
                });
                
                input.addEventListener('mouseleave', (e) => {
                    if (!e.target.matches(':focus')) {
                        e.target.style.borderColor = 'var(--linkedin-gray-400)';
                    }
                });
            }
        });
    }
    
    setupTopicInputs() {
        this.customTopicInput.addEventListener('input', () => {
            if (this.customTopicInput.value.trim()) {
                this.predefinedTopicSelect.value = '';
                this.predefinedTopicSelect.style.opacity = '0.7';
            } else {
                this.predefinedTopicSelect.style.opacity = '1';
            }
        });
        
        this.predefinedTopicSelect.addEventListener('change', () => {
            if (this.predefinedTopicSelect.value) {
                this.customTopicInput.value = this.predefinedTopicSelect.value;
                this.customTopicInput.style.fontWeight = 'var(--font-weight-semibold)';
                this.customTopicInput.style.color = 'var(--linkedin-blue)';
            } else {
                this.customTopicInput.style.fontWeight = 'var(--font-weight-medium)';
                this.customTopicInput.style.color = 'var(--linkedin-dark-90)';
            }
        });
    }
    
    async handleFormSubmit(e) {
        e.preventDefault();
        
        const topic = this.topicInput.value.trim();
        const tone = this.toneSelect.value;
        const length = this.lengthSelect.value;
        
        if (!topic) {
            this.showError('Please enter a topic or select from popular topics');
            return;
        }

        // Check if user is authenticated
        if (!this.isLoggedIn) {
            this.showError('Please connect your LinkedIn account first');
            return;
        }

        // Check subscription status before generating
        const canGenerate = await this.checkSubscriptionLimit();
        if (!canGenerate) {
            return; // Modal will be shown by checkSubscriptionLimit
        }
        
        this.setLoadingState(true);
        this.hideMessages();
        
        try {
            console.log(`🎯 Generating content for: ${topic}`);
            await this.generatePost(topic, tone, length);
        } catch (error) {
            console.error('❌ Generation failed:', error);
            
            // Check if it's a subscription error
            if (error.message.includes('subscription') || error.message.includes('limit')) {
                await this.showSubscriptionModal();
            } else {
                this.showError('Failed to generate content. Please try again.');
            }
        } finally {
            this.setLoadingState(false);
        }
    }

    async checkSubscriptionLimit() {
        try {
            const token = localStorage.getItem('jwt_token');
            if (!token) {
                console.log('No JWT token found - showing subscription modal');
                await this.showSubscriptionModal();
                return false;
            }

            const response = await fetch('/api/subscription/status', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                console.error('Failed to check subscription status:', response.status);
                await this.showSubscriptionModal();
                return false;
            }

            const data = await response.json();
            console.log('Subscription status:', data);
            
            // Check if user has access
            if (!data.usageLimit || !data.usageLimit.hasAccess) {
                console.log('No access - showing subscription modal');
                await this.showSubscriptionModal(data);
                return false;
            }

            console.log('Access granted - posts remaining:', data.usageLimit.postsRemaining);
            return true;
        } catch (error) {
            console.error('Error checking subscription:', error);
            // Show modal on error to be safe
            await this.showSubscriptionModal();
            return false;
        }
    }

    async showSubscriptionModal(usageData = null) {
        const modal = document.getElementById('subscriptionModal');
        const usageInfo = document.getElementById('usageInfo');
        const plansGrid = document.getElementById('plansGrid');

        // Update usage information
        if (usageData && usageData.usageLimit) {
            const { postsUsed, postsLimit, reason } = usageData.usageLimit;
            const usageCard = usageInfo.querySelector('.usage-card');
            
            if (postsLimit > 0) {
                usageCard.innerHTML = `
                    <div class="usage-icon">📊</div>
                    <div class="usage-text">
                        <h3>Monthly Usage: ${postsUsed}/${postsLimit} posts</h3>
                        <p>You've used all your posts for this month. Upgrade to continue creating content!</p>
                    </div>
                `;
            } else {
                usageCard.innerHTML = `
                    <div class="usage-icon">⚡</div>
                    <div class="usage-text">
                        <h3>No Active Subscription</h3>
                        <p>Subscribe to start generating AI-powered LinkedIn content or use an access key.</p>
                    </div>
                `;
            }
        }

        // Load subscription plans
        await this.loadModalPlans();

        // Show modal
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    async loadModalPlans() {
        const plansGrid = document.getElementById('plansGrid');
        
        try {
            const response = await fetch('/api/subscription/plans');
            const plans = await response.json();
            
            plansGrid.innerHTML = '';

            // Filter out free trial plan for the modal
            const paidPlans = plans.filter(plan => plan.price > 0);

            paidPlans.forEach((plan, index) => {
                const planCard = document.createElement('div');
                planCard.className = 'plan-card-modal';
                if (index === 1) planCard.classList.add('popular'); // Make Professional popular
                
                const regularPrice = plan.launch_price ? (plan.launch_price * 2).toFixed(2) : null;
                const features = plan.features?.features || ['AI-powered content', 'News integration', 'Multiple tones'];
                
                planCard.innerHTML = `
                    <div class="plan-name-modal">${plan.name}</div>
                    <div class="plan-price-modal">
                        ${regularPrice ? `<span class="crossed">$${regularPrice}</span>` : ''}
                        $${plan.launch_price || plan.price}/mo
                    </div>
                    <div class="plan-posts-modal">${plan.posts_limit === -1 ? 'Unlimited' : plan.posts_limit} posts/month</div>
                    <ul class="plan-features-modal">
                        ${features.slice(0, 3).map(feature => `<li>${feature}</li>`).join('')}
                    </ul>
                `;
                
                planCard.addEventListener('click', () => {
                    window.location.href = '/subscribe';
                });
                
                plansGrid.appendChild(planCard);
            });
        } catch (error) {
            console.error('Error loading plans:', error);
            plansGrid.innerHTML = '<div class="error">Failed to load subscription plans. Please refresh the page.</div>';
        }
    }
    
    async generatePost(topic, tone = 'professional', length = 'medium') {
        try {
            const token = localStorage.getItem('jwt_token');
            const headers = {
                'Content-Type': 'application/json',
            };
            
            // Add auth token if available
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const response = await fetch('/api/generate-post', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ topic, tone })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                
                // Check if it's a subscription limit error
                if (response.status === 403 && errorData.needsUpgrade) {
                    await this.showSubscriptionModal();
                    throw new Error(errorData.error || 'Subscription limit reached');
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.post) {
                this.currentPost = {
                    post: data.post,
                    image: data.image,
                    article: data.article
                };
                this.currentImageUrl = data.image?.url;
                this.currentArticleData = data.article;
                
                this.displayGeneratedContent(data);
                this.showSuccess('Content generated successfully!');
                
                console.log('✅ Content generated successfully');
            } else {
                throw new Error(data.error || 'Failed to generate content');
            }
        } catch (error) {
            console.error('❌ Error generating post:', error);
            throw error;
        }
    }
    
    displayGeneratedContent(data) {
        // Build the content HTML
        let contentHTML = '';
        
        // Post content
        contentHTML += `
            <div class="post-content">
                <div class="post-text" id="generatedPost">${this.formatPostText(data.post)}</div>
            </div>
        `;
        
        // Image link if available
        if (data.image && data.image.url) {
            contentHTML += `
                <div class="post-image-link" id="postImageLink">
                    <div class="image-link-container">
                        <h4>Suggested Image for Your Post</h4>
                        <a href="${data.image.url}" target="_blank" rel="noopener" class="image-url-link">
                            View suggested image →
                        </a>
                    </div>
                </div>
            `;
        }
        
        // Post metadata
        const wordCount = data.post.split(' ').length;
        contentHTML += `
            <div class="post-metadata">
                <div class="metadata-item">
                    <span class="label">Word Count</span>
                    <span>${wordCount}</span>
                </div>
                <div class="metadata-item">
                    <span class="label">Tone</span>
                    <span>${this.capitalizeFirst(this.toneSelect.value)}</span>
                </div>
                <div class="metadata-item">
                    <span class="label">Length</span>
                    <span>${this.capitalizeFirst(this.lengthSelect.value)}</span>
                </div>
            </div>
        `;
        
        // Source article if available
        if (data.article) {
            contentHTML += `
                <div class="source-article">
                    <h3>Source Article</h3>
                    <div class="article-card">
                        <h4>${data.article.title}</h4>
                        <p>${data.article.snippet}</p>
                        <a href="${data.article.url}" target="_blank" rel="noopener">Read full article →</a>
                    </div>
                </div>
            `;
        }
        
        this.output.innerHTML = contentHTML;
        
        // Show action buttons and post options
        if (this.copyBtn) this.copyBtn.style.display = 'inline-flex';
        if (this.regenerateBtn) this.regenerateBtn.style.display = 'inline-flex';
        if (this.postOptions) this.postOptions.style.display = 'block';
        
        // Update post button state
        this.updatePostButtonState();
        
        // Scroll to output
        this.output.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    formatPostText(text) {
        return text
            .replace(/#(\w+)/g, '<span class="hashtag">#$1</span>')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="post-link">$1</a>')
            .replace(/\n/g, '<br>');
    }
    
    async copyToClipboard() {
        if (!this.currentPost) {
            this.showError('No content to copy');
            return;
        }
        
        try {
            await navigator.clipboard.writeText(this.currentPost.post);
            this.showSuccess('Content copied to clipboard!');
            
            // Animate the copy button
            if (this.copyBtn) {
                const originalText = this.copyBtn.textContent;
                this.copyBtn.textContent = '✅ Copied!';
                this.copyBtn.style.background = 'var(--success-gradient)';
                this.copyBtn.style.color = 'white';
                
                setTimeout(() => {
                    this.copyBtn.textContent = originalText;
                    this.copyBtn.style.background = '';
                    this.copyBtn.style.color = '';
                }, 2000);
            }
            
            console.log('📋 Content copied to clipboard');
        } catch (err) {
            console.error('❌ Failed to copy:', err);
            this.showError('Failed to copy content');
        }
    }
    
    async regeneratePost() {
        const topic = this.topicInput.value.trim();
        const tone = this.toneSelect.value;
        const length = this.lengthSelect.value;
        
        if (!topic) {
            this.showError('Please enter a topic first');
            return;
        }
        
        console.log('🔄 Regenerating content...');
        
        // Trigger form submission
        this.form.dispatchEvent(new Event('submit'));
    }
    
    setLoadingState(isLoading) {
        if (this.generateBtn) {
            this.generateBtn.disabled = isLoading;
            
            if (isLoading) {
                this.loader.style.display = 'inline-block';
                this.generateBtn.querySelector('.btn-text').textContent = 'Generating...';
            } else {
                this.loader.style.display = 'none';
                this.generateBtn.querySelector('.btn-text').textContent = 'Generate Content';
            }
        }
    }
    
    showSuccess(message) {
        this.showNotification(message, 'success');
    }
    
    showError(message) {
        this.showNotification(message, 'error');
    }

    showDuplicateContentError() {
        // Remove existing notifications
        const existing = document.querySelectorAll('.success-message, .error-message, .duplicate-error');
        existing.forEach(el => el.remove());

        const notification = document.createElement('div');
        notification.className = 'duplicate-error';
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-header">
                    <span class="notification-icon">⚠️</span>
                    <span class="notification-title">Duplicate Content Detected</span>
                </div>
                <p class="notification-message">
                    This content is too similar to a recent post. LinkedIn prevents posting duplicate content to avoid spam.
                </p>
                <div class="notification-actions">
                    <button class="regenerate-and-post-btn" onclick="window.postPilot.regenerateAndPost()">
                        🔄 Generate New Content & Post
                    </button>
                    <button class="modify-and-post-btn" onclick="window.postPilot.showContentModifier()">
                        ✏️ Modify Current Content
                    </button>
                </div>
            </div>
        `;

        // Add styles for duplicate error
        if (!document.querySelector('#duplicateErrorStyles')) {
            const style = document.createElement('style');
            style.id = 'duplicateErrorStyles';
            style.textContent = `
                .duplicate-error {
                    background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
                    border: 2px solid #e6a23c;
                    border-radius: 12px;
                    padding: 20px;
                    margin: 20px 0;
                    box-shadow: 0 4px 12px rgba(230, 162, 60, 0.2);
                    animation: slideIn 0.3s ease-out;
                }
                
                .notification-content {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                
                .notification-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 600;
                    color: #b7791f;
                }
                
                .notification-icon {
                    font-size: 20px;
                }
                
                .notification-title {
                    font-size: 16px;
                }
                
                .notification-message {
                    color: #856404;
                    margin: 0;
                    line-height: 1.5;
                }
                
                .notification-actions {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                
                .regenerate-and-post-btn, .modify-and-post-btn {
                    padding: 10px 16px;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    font-size: 14px;
                }
                
                .regenerate-and-post-btn {
                    background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
                    color: white;
                }
                
                .regenerate-and-post-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
                }
                
                .modify-and-post-btn {
                    background: linear-gradient(135deg, #007bff 0%, #6c757d 100%);
                    color: white;
                }
                
                .modify-and-post-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
                }
            `;
            document.head.appendChild(style);
        }

        // Insert notification before the output section
        const outputSection = this.output.closest('.card');
        if (outputSection) {
            outputSection.parentNode.insertBefore(notification, outputSection);
        } else {
            document.body.appendChild(notification);
        }

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 10000);
    }
    
    showNotification(message, type = 'success') {
        // Remove existing notifications
        const existing = document.querySelectorAll('.success-message, .error-message, .info-message');
        existing.forEach(el => el.remove());
        
        const notification = document.createElement('div');
        notification.className = `${type}-message`;
        
        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
        const title = type === 'success' ? 'Success!' : type === 'error' ? 'Error' : 'Info';
        
        notification.innerHTML = `
            <div class="${type}-content">
                <div class="${type}-icon">${icon}</div>
                <div>
                    <h3>${title}</h3>
                    <p>${message}</p>
                </div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
        
        // Add click to dismiss
        notification.addEventListener('click', () => {
            notification.remove();
        });
    }
    
    hideMessages() {
        const existing = document.querySelectorAll('.success-message, .error-message, .info-message');
        existing.forEach(el => el.remove());
    }
    
    // Utility functions
    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        
        return date.toLocaleDateString();
    }

    async regenerateAndPost() {
        try {
            // Hide any existing notifications
            this.hideMessages();
            document.querySelectorAll('.duplicate-error').forEach(el => el.remove());
            
            this.showNotification('Generating fresh content...', 'info');
            
            // Regenerate content
            const topic = this.topicInput.value.trim();
            const tone = this.toneSelect.value;
            
            if (!topic) {
                this.showError('Please enter a topic first');
                return;
            }
            
            await this.generatePost(topic, tone);
            
            // Wait a moment then auto-post
            setTimeout(async () => {
                await this.handlePostToLinkedIn();
            }, 1000);
            
        } catch (error) {
            console.error('❌ Regenerate and post failed:', error);
            this.showError('Failed to regenerate content: ' + error.message);
        }
    }

    showContentModifier() {
        // Remove existing notifications and modifiers
        document.querySelectorAll('.duplicate-error, .content-modifier').forEach(el => el.remove());
        
        if (!this.currentPost) {
            this.showError('No content to modify');
            return;
        }

        const modifier = document.createElement('div');
        modifier.className = 'content-modifier';
        modifier.innerHTML = `
            <div class="modifier-content">
                <h3>✏️ Modify Your Content</h3>
                <p>Make small changes to avoid the duplicate content restriction:</p>
                <div class="modifier-form">
                    <textarea id="modifiedContent" class="modified-content-input" rows="6">${this.currentPost.post}</textarea>
                    <div class="modifier-actions">
                        <button class="save-and-post-btn" onclick="window.postPilot.saveModifiedContent()">
                            💾 Save & Post
                        </button>
                        <button class="cancel-modifier-btn" onclick="window.postPilot.cancelContentModification()">
                            ❌ Cancel
                        </button>
                    </div>
                    <div class="modifier-tips">
                        <strong>Tips to avoid duplicates:</strong>
                        <ul>
                            <li>Add a personal insight or comment</li>
                            <li>Change the opening sentence</li>
                            <li>Add relevant emojis or hashtags</li>
                            <li>Include a call-to-action</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;

        // Add styles for content modifier
        if (!document.querySelector('#contentModifierStyles')) {
            const style = document.createElement('style');
            style.id = 'contentModifierStyles';
            style.textContent = `
                .content-modifier {
                    background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                    border: 2px solid #6c757d;
                    border-radius: 12px;
                    padding: 20px;
                    margin: 20px 0;
                    box-shadow: 0 4px 12px rgba(108, 117, 125, 0.2);
                }
                
                .modifier-content h3 {
                    margin: 0 0 10px 0;
                    color: #495057;
                }
                
                .modifier-form {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                
                .modified-content-input {
                    width: 100%;
                    padding: 12px;
                    border: 2px solid #ced4da;
                    border-radius: 8px;
                    font-family: inherit;
                    font-size: 14px;
                    line-height: 1.5;
                    resize: vertical;
                    min-height: 120px;
                }
                
                .modified-content-input:focus {
                    outline: none;
                    border-color: #0077b5;
                    box-shadow: 0 0 0 3px rgba(0, 119, 181, 0.1);
                }
                
                .modifier-actions {
                    display: flex;
                    gap: 12px;
                }
                
                .save-and-post-btn, .cancel-modifier-btn {
                    padding: 10px 16px;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                
                .save-and-post-btn {
                    background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
                    color: white;
                }
                
                .cancel-modifier-btn {
                    background: #6c757d;
                    color: white;
                }
                
                .save-and-post-btn:hover, .cancel-modifier-btn:hover {
                    transform: translateY(-2px);
                }
                
                .modifier-tips {
                    background: #fff;
                    padding: 15px;
                    border-radius: 8px;
                    border-left: 4px solid #17a2b8;
                }
                
                .modifier-tips ul {
                    margin: 5px 0 0 0;
                    padding-left: 20px;
                }
                
                .modifier-tips li {
                    margin: 5px 0;
                    color: #495057;
                }
            `;
            document.head.appendChild(style);
        }

        // Insert modifier before the output section
        const outputSection = this.output.closest('.card');
        if (outputSection) {
            outputSection.parentNode.insertBefore(modifier, outputSection);
        } else {
            document.body.appendChild(modifier);
        }

        // Focus on the textarea
        setTimeout(() => {
            document.getElementById('modifiedContent').focus();
        }, 100);
    }

    async saveModifiedContent() {
        const modifiedText = document.getElementById('modifiedContent')?.value?.trim();
        
        if (!modifiedText) {
            this.showError('Please enter modified content');
            return;
        }

        // Update current post with modified content
        this.currentPost.post = modifiedText;
        
        // Remove the modifier
        document.querySelectorAll('.content-modifier').forEach(el => el.remove());
        
        // Update the display
        const postTextElement = document.getElementById('generatedPost');
        if (postTextElement) {
            postTextElement.innerHTML = this.formatPostText(modifiedText);
        }
        
        this.showSuccess('Content updated! Ready to post.');
        
        // Auto-post the modified content
        setTimeout(async () => {
            await this.handlePostToLinkedIn();
        }, 500);
    }

    cancelContentModification() {
        document.querySelectorAll('.content-modifier').forEach(el => el.remove());
        this.showNotification('Content modification cancelled', 'info');
    }
}

// Global functions for HTML onclick handlers
function copyToClipboard() {
    if (window.postPilot) {
        window.postPilot.copyToClipboard();
    }
}

function regeneratePost() {
    if (window.postPilot) {
        window.postPilot.regeneratePost();
    }
}

function postToLinkedIn() {
    if (window.postPilot) {
        window.postPilot.handlePostToLinkedIn();
    }
}

async function logout() {
    try {
        const response = await fetch('/auth/logout', { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            if (window.postPilot) {
                window.postPilot.isLoggedIn = false;
                window.postPilot.currentUser = null;
                window.postPilot.showUnauthenticatedState();
                window.postPilot.updatePostButtonState();
            }
            console.log('✅ User logged out');
        } else {
            throw new Error('Logout failed');
        }
    } catch (error) {
        console.error('❌ Error logging out:', error);
        if (window.postPilot) {
            window.postPilot.showError('Failed to logout');
        }
    }
}

// Subscription Modal Functions
function closeSubscriptionModal() {
    const modal = document.getElementById('subscriptionModal');
    modal.style.display = 'none';
    document.body.style.overflow = '';
}

async function activateAccessKey() {
    const keyInput = document.getElementById('accessKeyInput');
    const messageDiv = document.getElementById('accessKeyMessage');
    const keyCode = keyInput.value.trim();

    if (!keyCode) {
        showAccessKeyMessage('Please enter an access key', 'error');
        return;
    }

    try {
        const response = await fetch('/api/access-key/activate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('jwt_token')}`
            },
            body: JSON.stringify({ keyCode })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showAccessKeyMessage(`✅ ${result.message}`, 'success');
            keyInput.value = '';
            
            // Close modal after 2 seconds
            setTimeout(() => {
                closeSubscriptionModal();
            }, 2000);
        } else {
            showAccessKeyMessage(result.error || 'Invalid access key', 'error');
        }
    } catch (error) {
        console.error('Error activating access key:', error);
        showAccessKeyMessage('Failed to activate access key', 'error');
    }
}

function showAccessKeyMessage(message, type) {
    const messageDiv = document.getElementById('accessKeyMessage');
    messageDiv.textContent = message;
    messageDiv.className = `access-key-message ${type}`;
    messageDiv.style.display = 'block';

    // Hide after 5 seconds for error messages
    if (type === 'error') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    window.postPilot = new PostPilotApp();
});

// Console welcome message
console.log(`
🚀 PostPilot - AI-Driven LinkedIn Content Platform
✨ Ready to create amazing content!

Keyboard shortcuts:
• Ctrl/Cmd + Enter: Generate content
• Ctrl/Cmd + C: Copy content (when generated)

Need help? Check the console for detailed logs.
`);