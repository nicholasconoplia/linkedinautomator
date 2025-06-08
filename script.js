// LinkedIn Post Generator with Automation - Frontend JavaScript
class LinkedInPostGenerator {
    constructor() {
        // Original elements
        this.form = document.getElementById('postForm');
        this.generateBtn = document.getElementById('generateBtn');
        this.loader = document.getElementById('loader');
        this.outputCard = document.getElementById('outputCard');
        this.copyBtn = document.getElementById('copyBtn');
        this.regenerateBtn = document.getElementById('regenerateBtn');
        this.successMessage = document.getElementById('successMessage');
        this.errorMessage = document.getElementById('errorMessage');
        
        // Topic input elements
        this.customTopicInput = document.getElementById('customTopic');
        this.predefinedTopicSelect = document.getElementById('predefinedTopic');
        
        // Authentication elements
        this.loginPrompt = document.getElementById('login-prompt');
        this.userProfile = document.getElementById('user-profile');
        this.logoutBtn = document.getElementById('logout-btn');
        this.viewDashboardBtn = document.getElementById('view-dashboard-btn');
        this.automationPanel = document.getElementById('automation-panel');
        
        // Automation elements
        this.automationForm = document.getElementById('automationForm');
        this.quickScheduleForm = document.getElementById('quickScheduleForm');
        this.postCurrentBtn = document.getElementById('postCurrentBtn');
        this.scheduledPostsList = document.getElementById('scheduledPostsList');
        this.recentActivity = document.getElementById('recentActivity');
        
        // State
        this.currentPost = null;
        this.currentTopic = null;
        this.currentTone = null;
        this.currentUser = null;
        this.userPreferences = null;
        
        this.init();
    }
    
    async init() {
        // Check authentication on load
        await this.checkAuthStatus();
        
        // Setup event listeners
        this.setupEventListeners();
        this.setupTopicInputs();
        this.addFormInteractions();
        
        // Check if user just authenticated
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('authenticated') === 'true') {
            window.history.replaceState({}, document.title, window.location.pathname);
            await this.checkAuthStatus();
        }
    }
    
    setupEventListeners() {
        // Original form handlers
        this.form.addEventListener('submit', this.handleFormSubmit.bind(this));
        this.copyBtn.addEventListener('click', this.copyToClipboard.bind(this));
        this.regenerateBtn.addEventListener('click', this.regeneratePost.bind(this));
        
        // Authentication handlers
        if (this.logoutBtn) {
            this.logoutBtn.addEventListener('click', this.handleLogout.bind(this));
        }
        
        if (this.viewDashboardBtn) {
            this.viewDashboardBtn.addEventListener('click', this.scrollToDashboard.bind(this));
        }
        
        // Automation handlers
        if (this.automationForm) {
            this.automationForm.addEventListener('submit', this.handleSaveSettings.bind(this));
        }
        
        if (this.quickScheduleForm) {
            this.quickScheduleForm.addEventListener('submit', this.handleQuickSchedule.bind(this));
        }
        
        if (this.postCurrentBtn) {
            this.postCurrentBtn.addEventListener('click', this.handlePostToLinkedIn.bind(this));
        }
    }
    
    async checkAuthStatus() {
        console.log('🔍 Checking authentication status...');
        try {
            const response = await fetch('/api/auth-status');
            console.log('📡 Auth status response:', response.status, response.ok);
            
            if (response.ok) {
                const authData = await response.json();
                console.log('📋 Auth data received:', authData);
                
                if (authData.authenticated) {
                    console.log('✅ User is authenticated:', authData.user);
                    this.currentUser = authData.user;
                    this.showAuthenticatedState();
                    await this.loadUserData();
                } else {
                    console.log('❌ User is not authenticated');
                    this.showUnauthenticatedState();
                }
            } else {
                console.log('❌ Auth status request failed');
                this.showUnauthenticatedState();
            }
        } catch (error) {
            console.error('❌ Auth check failed:', error);
            this.showUnauthenticatedState();
        }
        
        // Check if OAuth is configured
        this.checkOAuthConfiguration();
    }
    
    checkOAuthConfiguration() {
        // Hide login button if OAuth error in URL
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('error') === 'oauth_not_configured') {
            if (this.loginPrompt) {
                this.loginPrompt.style.display = 'none';
            }
            console.log('LinkedIn OAuth not configured - automation features unavailable');
        }
    }
    
    showAuthenticatedState() {
        console.log('🟢 Showing authenticated state');
        if (this.loginPrompt) {
            console.log('🔸 Hiding login prompt');
            this.loginPrompt.style.display = 'none';
        }
        if (this.userProfile) {
            console.log('🔸 Showing user profile');
            this.userProfile.style.display = 'block';
            const nameElement = this.userProfile.querySelector('.user-name');
            if (nameElement) nameElement.textContent = this.currentUser.name;
        }
        if (this.automationPanel) {
            console.log('🔸 Showing automation panel');
            this.automationPanel.style.display = 'block';
        }
    }
    
    showUnauthenticatedState() {
        console.log('🔴 Showing unauthenticated state');
        if (this.loginPrompt) {
            console.log('🔸 Showing login prompt');
            this.loginPrompt.style.display = 'block';
        }
        if (this.userProfile) {
            console.log('🔸 Hiding user profile');
            this.userProfile.style.display = 'none';
        }
        if (this.automationPanel) {
            console.log('🔸 Hiding automation panel');
            this.automationPanel.style.display = 'none';
        }
        this.currentUser = null;
    }
    
    async loadUserData() {
        try {
            // Load user preferences
            const prefsResponse = await fetch('/api/preferences');
            if (prefsResponse.ok) {
                this.userPreferences = await prefsResponse.json();
                this.populateAutomationForm();
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
        if (!this.scheduledPostsList) return;
        
        try {
            const response = await fetch('/api/scheduled-posts');
            if (response.ok) {
                const posts = await response.json();
                this.displayScheduledPosts(posts);
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
        if (!this.recentActivity) return;
        
        try {
            const response = await fetch('/api/scheduled-posts');
            if (response.ok) {
                const posts = await response.json();
                const recentPosts = posts
                    .filter(post => post.status === 'posted' || post.status === 'failed')
                    .slice(0, 5);
                this.displayRecentActivity(recentPosts);
            }
        } catch (error) {
            console.error('Failed to load recent activity:', error);
            this.recentActivity.innerHTML = '<div class="loading">Failed to load activity</div>';
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
            const response = await fetch('/auth/logout', { method: 'POST' });
            if (response.ok) {
                this.showUnauthenticatedState();
                this.showSuccess('Logged out successfully');
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
            const postData = {
                content: this.currentPost.post,
                imageUrl: this.currentPost.image?.url
            };
            
            const response = await fetch('/api/post-now', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(postData)
            });
            
            if (response.ok) {
                const result = await response.json();
                this.showSuccess('Posted to LinkedIn successfully!');
                await this.loadRecentActivity();
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Failed to post to LinkedIn');
            }
        } catch (error) {
            console.error('Failed to post to LinkedIn:', error);
            this.showError('Failed to post to LinkedIn: ' + error.message);
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
        
        const customTopic = this.customTopicInput.value.trim();
        const predefinedTopic = this.predefinedTopicSelect.value;
        const topic = customTopic || predefinedTopic;
        const tone = document.getElementById('tone').value;
        
        if (!topic) {
            this.showError('Please enter a topic or select from the dropdown');
            this.customTopicInput.focus();
            return;
        }
        
        this.currentTopic = topic;
        this.currentTone = tone;
        
        this.setLoadingState(true);
        this.hideMessages();
        
        try {
            await this.generatePost(topic, tone);
        } catch (error) {
            console.error('Generation failed:', error);
            this.showError(error.message || 'Failed to generate post. Please try again.');
        } finally {
            this.setLoadingState(false);
        }
    }
    
    async generatePost(topic, tone) {
        const response = await fetch('/api/generate-post', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ topic, tone })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Network error' }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        this.displayGeneratedPost(data);
    }
    
    displayGeneratedPost(response) {
        const data = response.data || response;
        this.currentPost = data;
        
        let postText = data.post || '';
        
        if (data.article && data.article.url && data.article.url !== '#') {
            postText += `\n\n📰 Source: ${data.article.url}`;
        }
        
        document.getElementById('generatedPost').innerHTML = this.formatPostText(postText);
        
        document.getElementById('wordCount').textContent = this.countWords(postText);
        document.getElementById('newsSource').textContent = data.article?.source || 'Mock Data';
        document.getElementById('keywords').textContent = data.keywords || '-';
        
        if (data.article && data.article.title !== 'Latest Development in ' + this.currentTopic.charAt(0).toUpperCase() + this.currentTopic.slice(1)) {
            document.getElementById('articleTitle').textContent = data.article.title || '';
            document.getElementById('articleSnippet').textContent = data.article.snippet || '';
            document.getElementById('articleLink').href = data.article.url || '#';
            document.getElementById('sourceArticle').style.display = 'block';
        } else {
            document.getElementById('sourceArticle').style.display = 'none';
        }
        
        if (data.image && data.image.url) {
            const imageLinkElement = document.getElementById('imageUrl');
            const imageLinkContainer = document.getElementById('postImageLink');
            
            imageLinkElement.href = data.image.url;
            imageLinkElement.textContent = data.image.url;
            document.getElementById('imageAttribution').textContent = data.image.attribution || '';
            
            imageLinkContainer.style.display = 'block';
        } else {
            document.getElementById('postImageLink').style.display = 'none';
        }
        
        document.getElementById('postMetadata').style.display = 'grid';
        this.outputCard.style.display = 'block';
        
        // Enable the post to LinkedIn button if user is authenticated
        if (this.currentUser && this.postCurrentBtn) {
            this.postCurrentBtn.disabled = false;
        }
        
        this.outputCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    formatPostText(text) {
        if (!text) return '';
        
        return text
            .replace(/\n/g, '<br>')
            .replace(/#(\w+)/g, '<span class="hashtag">#$1</span>')
            .replace(/^• /gm, '<span class="bullet-point">• </span>')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="post-link">$1</a>')
            .replace(/📰 Source: (https?:\/\/[^\s]+)/g, '<div class="source-link">📰 Source: <a href="$1" target="_blank" rel="noopener">$1</a></div>');
    }
    
    countWords(text) {
        if (!text) return 0;
        return text.trim().split(/\s+/).filter(word => word.length > 0).length;
    }
    
    async copyToClipboard() {
        if (!this.currentPost || !this.currentPost.post) {
            this.showError('No post to copy');
            return;
        }
        
        let textToCopy = this.currentPost.post;
        
        if (this.currentPost.article && this.currentPost.article.url && this.currentPost.article.url !== '#') {
            textToCopy += `\n\n📰 Source: ${this.currentPost.article.url}`;
        }
        
        try {
            await navigator.clipboard.writeText(textToCopy);
            this.showSuccess();
        } catch (error) {
            console.error('Clipboard failed:', error);
            
            const textArea = document.createElement('textarea');
            textArea.value = textToCopy;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            
            try {
                document.execCommand('copy');
                this.showSuccess();
            } catch (fallbackError) {
                this.showError('Failed to copy to clipboard');
            }
            
            document.body.removeChild(textArea);
        }
    }
    
    async regeneratePost() {
        if (!this.currentTopic || !this.currentTone) {
            this.showError('No topic to regenerate');
            return;
        }
        
        this.setLoadingState(true);
        this.hideMessages();
        
        try {
            await this.generatePost(this.currentTopic, this.currentTone);
        } catch (error) {
            console.error('Regeneration failed:', error);
            this.showError(error.message || 'Failed to regenerate post');
        } finally {
            this.setLoadingState(false);
        }
    }
    
    setLoadingState(isLoading) {
        this.generateBtn.disabled = isLoading;
        
        if (isLoading) {
            this.loader.style.display = 'block';
            this.generateBtn.querySelector('.btn-text').textContent = 'Generating...';
        } else {
            this.loader.style.display = 'none';
            this.generateBtn.querySelector('.btn-text').textContent = 'Find Latest News & Generate Post';
        }
    }
    
    showSuccess(message = null) {
        if (message) {
            const content = this.successMessage.querySelector('.success-content p');
            if (content) content.textContent = message;
        }
        
        this.hideMessages();
        this.successMessage.style.display = 'block';
        
        setTimeout(() => {
            this.successMessage.style.display = 'none';
        }, 3000);
    }
    
    showError(message) {
        const errorText = document.getElementById('errorText');
        if (errorText) {
            errorText.textContent = message || 'An error occurred';
        }
        
        this.hideMessages();
        this.errorMessage.style.display = 'block';
        
        setTimeout(() => {
            this.errorMessage.style.display = 'none';
        }, 5000);
    }
    
    hideMessages() {
        this.successMessage.style.display = 'none';
        this.errorMessage.style.display = 'none';
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new LinkedInPostGenerator();
});

// Add subtle LinkedIn-style interactions
document.addEventListener('DOMContentLoaded', () => {
    // Add hover effects to cards
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.transform = 'translateY(-2px)';
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = 'translateY(0)';
        });
    });
});

// Add smooth scrolling for better UX
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});