// Employment - AI-Driven LinkedIn Content Platform
class EmploymentApp {
    // Utility function to get auth token from localStorage or cookies
    getAuthToken() {
        // First try localStorage
        const localToken = localStorage.getItem('auth_token');
        if (localToken) return localToken;
        
        // Then try cookies
        const cookies = document.cookie.split(';').reduce((acc, cookie) => {
            const [name, value] = cookie.trim().split('=');
            acc[name] = value;
            return acc;
        }, {});
        
        return cookies.auth_token || null;
    }

    constructor() {
        console.log('🏗️ Constructing EmploymentApp v20250609-001...');
        console.log('🔧 Automation fixes applied - debugging enabled');
        
        // Core elements
        this.form = document.getElementById('postForm');
        this.generateBtn = document.getElementById('generateBtn');
        this.loader = document.getElementById('loader');
        this.output = document.getElementById('output');
        this.copyBtn = document.getElementById('copyBtn');
        this.regenerateBtn = document.getElementById('regenerateBtn');
        this.postOptions = document.getElementById('postOptions');
        this.postBtn = document.getElementById('postBtn');
        
        console.log('🔍 Core elements check:');
        console.log('  - form:', !!this.form, this.form);
        console.log('  - generateBtn:', !!this.generateBtn, this.generateBtn);
        console.log('  - output:', !!this.output, this.output);
        console.log('  - loader:', !!this.loader, this.loader);
        
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
        
        // Determine which page we're on
        this.currentPage = this.detectCurrentPage();
        this.currentSection = this.currentPage === 'dashboard' ? 'dashboard' : this.currentPage;
        console.log('📍 Current page:', this.currentPage);
        
        this.init();
    }

    detectCurrentPage() {
        const path = window.location.pathname;
        console.log('🔍 [Navigation Debug] Current path:', path);
        let page = 'dashboard';
        if (path === '/generator') page = 'generator';
        if (path === '/automation') page = 'automation';
        if (path === '/saved-posts') page = 'saved-posts';
        console.log('🔍 [Navigation Debug] Detected page:', page);
        return page;
    }
    
    async init() {
        console.log('🚀 [Navigation Debug] Employment initializing...');
        console.log('🚀 [Navigation Debug] Current page:', this.currentPage);
        console.log('🚀 [Navigation Debug] URL:', window.location.href);
        console.log('🚀 [Navigation Debug] Search params:', window.location.search);
        
        // Setup base event listeners (auth, etc.)
        this.setupAuthEventListeners();
        
        // Page-specific initialization
        if (this.currentPage === 'generator') {
            this.setupGeneratorPage();
        } else if (this.currentPage === 'automation') {
            this.setupAutomationPage();
        } else if (this.currentPage === 'saved-posts') {
            // Don't initialize dashboard for saved-posts page
            this.setupEventListeners();
        } else {
            this.setupDashboardPage();
        }
        
        // Check authentication status
        await this.checkAuthStatus();
        
        // Check if user just authenticated or returned from subscription
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('authenticated') === 'true') {
            window.history.replaceState({}, document.title, window.location.pathname);
            await this.checkAuthStatus();
            
            // Show welcome message and check subscription after LinkedIn auth
            setTimeout(async () => {
                if (this.isLoggedIn) {
                    this.showSuccess('🎉 LinkedIn connected successfully! Welcome to Employment!');
                    
                    // Check subscription status after successful authentication
                    const hasAccess = await this.checkSubscriptionLimit();
                    if (!hasAccess) {
                        console.log('🎯 Showing subscription modal for new user');
                    }
                }
            }, 1500);
        }
        
        // Check if user returned from subscription success
        if (urlParams.get('subscription_updated') === 'true') {
            window.history.replaceState({}, document.title, window.location.pathname);
            // Force refresh subscription data
            setTimeout(async () => {
                console.log('🔧 Refreshing subscription data after payment...');
                await this.forceRefreshSubscription();
                this.showSuccess('🎉 Subscription updated successfully!');
            }, 1000);
        }
        
        console.log('✅ Employment ready for', this.currentPage, 'page!');
    }

    setupGeneratorPage() {
        console.log('🎨 Setting up Content Generator page...');
        this.setupEventListeners();
        this.setupTopicChips();
        this.addFormInteractions();
        this.setupContextPanel();
    }

    setupAutomationPage() {
        console.log('🤖 Setting up Automation page...');
        this.setupEventListeners();
        this.loadAutomationData();
    }

    setupDashboardPage() {
        console.log('📊 Setting up Dashboard page...');
        this.setupEventListeners();
        this.initializeNavigation();
    }

    setupAuthEventListeners() {
        console.log('🔐 Setting up authentication event listeners...');
        
        // Add global event delegation for auth buttons
        document.addEventListener('click', (e) => {
            if (e.target.getAttribute('data-action') === 'logout') {
                e.preventDefault();
                this.handleLogout(e);
            }
        });
    }
    
    setupEventListeners() {
        console.log('🎛️ [Navigation Debug] Setting up event listeners for page:', this.currentPage);
        
        // Form handlers - prioritize form submission over button clicks
        if (this.form) {
            console.log('✅ Form found, adding submit listener');
            this.form.addEventListener('submit', this.handleFormSubmit.bind(this));
        } else {
            console.error('❌ Form not found!');
        }
        
        // Only add button click listener if form is not found (fallback)
        if (!this.form && this.generateBtn) {
            console.log('⚠️ No form found, adding button click fallback');
            this.generateBtn.addEventListener('click', (e) => {
                console.log('🔥 Generate button clicked (fallback)');
                e.preventDefault();
                this.handleFormSubmit(e);
            });
        }
        
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
        
        // Add global event delegation
        document.addEventListener('click', this.handleGlobalClicks.bind(this));
        
        // Content type change handler
        const contentTypeSelect = document.getElementById('contentType');
        if (contentTypeSelect) {
            contentTypeSelect.addEventListener('change', this.handleContentTypeChange.bind(this));
            // Show research explanation by default since BYOB is now default
            this.handleContentTypeChange();
        }

        // Tone change handler for student context
        const toneSelect = document.getElementById('tone');
        if (toneSelect) {
            toneSelect.addEventListener('change', this.handleToneChange.bind(this));
            // Initialize based on current selection
            this.handleToneChange();
        }

        // Initialize navigation only if not on saved-posts page
        if (this.currentPage !== 'saved-posts') {
            this.initializeNavigation();
        }
    }

    initializeNavigation() {
        console.log('🧭 [Navigation Debug] Initializing navigation...');
        console.log('🧭 [Navigation Debug] Current page:', this.currentPage);
        console.log('🧭 [Navigation Debug] Current section:', this.currentSection);
        
        // Add navigation event listeners
        const navTabs = document.querySelectorAll('.nav-tab');
        console.log('🧭 [Navigation Debug] Found nav tabs:', navTabs.length);
        console.log('🧭 [Navigation Debug] Nav tab elements:', Array.from(navTabs).map(tab => ({
            section: tab.getAttribute('data-section'),
            classes: tab.className
        })));
        
        navTabs.forEach((tab, index) => {
            const sectionName = tab.getAttribute('data-section');
            console.log(`Tab ${index}: ${sectionName}`);
            
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔄 Switching to section:', sectionName);
                this.switchSection(sectionName);
            });
        });

        // Handle placeholder generate button
        const placeholderBtn = document.getElementById('placeholderGenerateBtn');
        if (placeholderBtn) {
            placeholderBtn.addEventListener('click', () => {
                this.switchSection('content-generator');
            });
        }

        // Only set initial section to dashboard if we're on the main page
        if (this.currentPage === 'dashboard') {
            console.log('🎯 Setting initial section to dashboard');
            this.switchSection('dashboard');
        }
    }

    switchSection(sectionName) {
        console.log('🔄 [Navigation Debug] ========== SECTION SWITCH ==========');
        console.log('🔄 [Navigation Debug] Attempting to switch to section:', sectionName);
        console.log('🔄 [Navigation Debug] Current page:', this.currentPage);
        console.log('🔄 [Navigation Debug] Current section:', this.currentSection);
        console.log('🔄 [Navigation Debug] URL:', window.location.href);
        
        // Update navigation tabs
        const navTabs = document.querySelectorAll('.nav-tab');
        navTabs.forEach(tab => {
            tab.classList.remove('active');
            if (tab.getAttribute('data-section') === sectionName) {
                tab.classList.add('active');
                console.log('✅ Activated tab:', sectionName);
            }
        });

        // Update content sections
        const contentSections = document.querySelectorAll('.content-section');
        contentSections.forEach(section => {
            section.classList.remove('active');
        });

        const targetSection = document.getElementById(`${sectionName}-section`);
        if (targetSection) {
            targetSection.classList.add('active');
            console.log('✅ Activated section:', sectionName);
        } else {
            console.error('❌ Section not found:', `${sectionName}-section`);
        }

        this.currentSection = sectionName;

        // Load section-specific data
        this.loadSectionData(sectionName);
    }

    async loadSectionData(sectionName) {
        console.log('📊 Loading data for section:', sectionName);
        
        switch (sectionName) {
            case 'dashboard':
                await this.loadDashboardData();
                break;
            case 'content-generator':
                // Content generator doesn't need additional data loading
                console.log('✅ Content generator section loaded');
                break;
            case 'automation':
                await this.loadAutomationData();
                break;
            default:
                console.log(`No specific loader for section: ${sectionName}`);
        }
    }

    async loadDashboardData() {
        console.log('📊 Loading dashboard data...');
        
        // Recent activity removed due to LinkedIn API restrictions
    }





    setupAutomationForm() {
        // Add automation setup form if it doesn't exist
        const automationSection = document.getElementById('automation-section');
        if (automationSection && !document.getElementById('automationSetup')) {
            const setupHTML = `
                <div id="automationSetup" class="mb-6">
                    <h3 class="text-[#0d151c] text-lg font-bold leading-tight tracking-[-0.015em] px-4 pb-3 pt-5">Setup Automation</h3>
                    <div class="bg-white border border-[#e7edf4] rounded-xl p-6 mx-4">
                        <form id="automationForm">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label class="block text-[#0d151c] text-base font-medium leading-normal pb-2">Post Frequency</label>
                                    <select id="postFrequency" class="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-xl text-[#0d151c] focus:outline-0 focus:ring-0 border border-[#cedce8] bg-slate-50 focus:border-[#cedce8] h-14 bg-[image:--select-button-svg] placeholder:text-[#49749c] p-[15px] text-base font-normal leading-normal">
                                        <option value="daily">Daily</option>
                                        <option value="weekly" selected>Weekly</option>
                                        <option value="biweekly">Bi-weekly</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[#0d151c] text-base font-medium leading-normal pb-2">Post Time</label>
                                    <input type="time" id="postTime" value="09:00" class="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-xl text-[#0d151c] focus:outline-0 focus:ring-0 border border-[#cedce8] bg-slate-50 focus:border-[#cedce8] h-14 placeholder:text-[#49749c] p-[15px] text-base font-normal leading-normal">
                                </div>
                                <div>
                                    <label class="block text-[#0d151c] text-base font-medium leading-normal pb-2">Content Type</label>
                                    <select id="autoContentType" class="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-xl text-[#0d151c] focus:outline-0 focus:ring-0 border border-[#cedce8] bg-slate-50 focus:border-[#cedce8] h-14 bg-[image:--select-button-svg] placeholder:text-[#49749c] p-[15px] text-base font-normal leading-normal">
                                        <option value="news">News-Based Posts</option>
                                        <option value="viral_format">Viral Format Posts</option>
                                        <option value="mixed">Mixed Content</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-[#0d151c] text-base font-medium leading-normal pb-2">Tone</label>
                                    <select id="autoTone" class="form-input flex w-full min-w-0 flex-1 resize-none overflow-hidden rounded-xl text-[#0d151c] focus:outline-0 focus:ring-0 border border-[#cedce8] bg-slate-50 focus:border-[#cedce8] h-14 bg-[image:--select-button-svg] placeholder:text-[#49749c] p-[15px] text-base font-normal leading-normal">
                                        <option value="professional">Professional</option>
                                        <option value="conversational">Conversational</option>
                                        <option value="inspirational">Inspirational</option>
                                        <option value="educational">Educational</option>
                                    </select>
                                </div>
                            </div>
                            <div class="mt-6">
                                <label class="block text-[#0d151c] text-base font-medium leading-normal pb-2">Days of Week</label>
                                <div class="flex flex-wrap gap-2">
                                    ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => `
                                        <label class="flex items-center gap-2 bg-[#f8fafc] border border-[#e7edf4] rounded-lg px-3 py-2 cursor-pointer hover:bg-[#e7edf4]">
                                            <input type="checkbox" value="${day.toLowerCase()}" class="text-[#0b80ee]" ${['monday', 'wednesday', 'friday'].includes(day.toLowerCase()) ? 'checked' : ''}>
                                            <span class="text-[#0d151c] text-sm font-medium">${day}</span>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                            <div class="mt-6 flex gap-4">
                                <button type="submit" class="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-12 px-5 bg-[#0b80ee] text-slate-50 text-base font-bold leading-normal tracking-[0.015em]">
                                    Save Automation Settings
                                </button>
                                <button type="button" id="pauseAutomation" class="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-12 px-5 bg-[#6b7280] text-slate-50 text-base font-bold leading-normal tracking-[0.015em]">
                                    Pause Automation
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            `;
            
            // Insert before the table
            const tableContainer = automationSection.querySelector('.px-4.py-3');
            if (tableContainer) {
                tableContainer.insertAdjacentHTML('beforebegin', setupHTML);
                
                                // Add event listeners
                const automationForm = document.getElementById('automationForm');
                if (automationForm) {
                    automationForm.addEventListener('submit', this.handleSaveAutomation.bind(this));
                }
            }
        }
    }

    async handleSaveAutomation(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const checkboxes = e.target.querySelectorAll('input[type="checkbox"]:checked');
        const selectedDays = Array.from(checkboxes).map(cb => cb.value);
        
        const automationSettings = {
            frequency: document.getElementById('postFrequency').value,
            time: document.getElementById('postTime').value,
            contentType: document.getElementById('autoContentType').value,
            tone: document.getElementById('autoTone').value,
            days: selectedDays
        };
        
        try {
            const response = await fetch('/api/automation/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(automationSettings)
            });
            
            if (response.ok) {
                this.showSuccess('Automation settings saved successfully!');
            } else {
                this.showError('Failed to save automation settings');
            }
        } catch (error) {
            console.error('Error saving automation:', error);
            this.showError('Failed to save automation settings');
        }
    }

    // ====================
    // AUTOMATION FUNCTIONALITY  
    // ====================

    async loadAutomationData() {
        console.log('🤖 Loading automation data...');
        try {
            await Promise.all([
                this.loadAutomationSettings(),
                this.loadAutomationQueue(),
                this.loadAutomationAnalytics()
            ]);
            this.setupAutomationEventListeners();
        } catch (error) {
            console.error('Error loading automation data:', error);
        }
    }

    async loadAutomationSettings() {
        try {
            const response = await fetch('/api/automation/settings', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const settings = await response.json();
                this.populateAutomationSettingsForm(settings);
                this.updateAutomationToggle(settings.enabled);
            }
        } catch (error) {
            console.error('Error loading automation settings:', error);
        }
    }

    populateAutomationSettingsForm(settings) {
        // Update form fields
        const postFrequency = document.getElementById('postFrequency');
        const postTimes = document.getElementById('postTimes');
        const autoContentMix = document.getElementById('autoContentMix');
        const autoTone = document.getElementById('autoTone');
        
        if (postFrequency) postFrequency.value = settings.frequency || 'weekly';
        if (postTimes) postTimes.value = settings.posting_times || 'afternoon';
        if (autoContentMix) autoContentMix.value = settings.content_mix || 'balanced';
        if (autoTone) autoTone.value = settings.default_tone || 'professional';

        // Update topic pool
        const topicCheckboxes = document.querySelectorAll('#topicPool input[type="checkbox"]');
        topicCheckboxes.forEach(checkbox => {
            checkbox.checked = settings.topic_pool?.includes(checkbox.value) || false;
        });

        // Update posting days
        const dayCheckboxes = document.querySelectorAll('#daysOfWeek input[type="checkbox"]');
        dayCheckboxes.forEach(checkbox => {
            checkbox.checked = settings.posting_days?.includes(checkbox.value) || false;
        });
    }

    updateAutomationToggle(enabled) {
        const toggleBtn = document.getElementById('automationToggle');
        if (toggleBtn) {
            if (enabled) {
                toggleBtn.innerHTML = '<span class="truncate">🟢 Automation ON</span>';
                toggleBtn.className = 'flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#22c55e] text-slate-50 text-sm font-bold leading-normal tracking-[0.015em]';
            } else {
                toggleBtn.innerHTML = '<span class="truncate">🔴 Automation OFF</span>';
                toggleBtn.className = 'flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#6b7280] text-slate-50 text-sm font-bold leading-normal tracking-[0.015em]';
            }
        }
    }

    async loadAutomationQueue() {
        try {
            const response = await fetch('/api/automation/queue', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                this.displayAutomationQueue(data.queue);
            }
        } catch (error) {
            console.error('Error loading automation queue:', error);
        }
    }

    displayAutomationQueue(queue) {
        // Update calendar view
        this.updateCalendarView(queue);
        
        // Update list view
        this.updateListView(queue);
    }

    updateCalendarView(queue) {
        const calendarGrid = document.getElementById('calendarGrid');
        const calendarEmpty = document.getElementById('calendarEmpty');
        
        if (!calendarGrid) return;

        if (queue.length === 0) {
            if (calendarEmpty) calendarEmpty.style.display = 'block';
            return;
        }

        if (calendarEmpty) calendarEmpty.style.display = 'none';

        // Group posts by date
        const postsByDate = {};
        queue.forEach(post => {
            const date = new Date(post.scheduled_for).toDateString();
            if (!postsByDate[date]) postsByDate[date] = [];
            postsByDate[date].push(post);
        });

        // Generate calendar days for next 4 weeks
        const today = new Date();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay() + 1); // Start from Monday

        // Clear existing calendar content except headers
        const headers = Array.from(calendarGrid.querySelectorAll('.text-center.font-medium'));
        calendarGrid.innerHTML = '';
        headers.forEach(header => calendarGrid.appendChild(header));

        for (let week = 0; week < 4; week++) {
            for (let day = 0; day < 7; day++) {
                const currentDate = new Date(startOfWeek);
                currentDate.setDate(startOfWeek.getDate() + (week * 7) + day);
                
                const dateStr = currentDate.toDateString();
                const posts = postsByDate[dateStr] || [];
                
                const dayElement = document.createElement('div');
                dayElement.className = 'border border-[#e7edf4] rounded-lg p-2 min-h-[80px] text-center';
                
                if (currentDate < today) {
                    dayElement.className += ' bg-[#f8fafc] text-[#9ca3af]';
                }
                
                dayElement.innerHTML = `
                    <div class="text-sm font-medium mb-1">${currentDate.getDate()}</div>
                    ${posts.map(post => `
                        <div class="text-xs bg-[#0b80ee] text-white rounded px-2 py-1 mb-1 truncate" title="${post.topic}">
                            📝 ${post.topic.substring(0, 15)}...
                        </div>
                    `).join('')}
                `;
                
                calendarGrid.appendChild(dayElement);
            }
        }
    }

    updateListView(queue) {
        const tableBody = document.getElementById('queueTableBody');
        if (!tableBody) return;

        if (queue.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-8 text-[#6b7280]">
                        📋 No scheduled posts yet. Generate your content queue to see posts here.
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = queue.map(post => {
            const scheduledDate = new Date(post.scheduled_for);
            const statusColor = {
                'pending': 'bg-[#fbbf24] text-white',
                'ready': 'bg-[#10b981] text-white',
                'posted': 'bg-[#6b7280] text-white',
                'failed': 'bg-[#ef4444] text-white'
            }[post.status] || 'bg-[#6b7280] text-white';

            return `
                <tr class="border-b border-[#e7edf4]">
                    <td class="px-4 py-3">
                        <div class="max-w-[200px] truncate text-sm">${post.content || `${post.topic} - ${post.content_type} post`}</div>
                    </td>
                    <td class="px-4 py-3 text-sm">${post.topic}</td>
                    <td class="px-4 py-3 text-sm">${scheduledDate.toLocaleString()}</td>
                    <td class="px-4 py-3">
                        <span class="px-2 py-1 rounded text-xs ${statusColor}">${post.status}</span>
                    </td>
                    <td class="px-4 py-3">
                        <div class="flex gap-2">
                            <button onclick="editQueueItem(${post.id})" class="text-[#0b80ee] hover:underline text-sm">Edit</button>
                            <button onclick="deleteQueueItem(${post.id})" class="text-[#ef4444] hover:underline text-sm">Delete</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    async loadAutomationAnalytics() {
        try {
            const response = await fetch('/api/automation/analytics', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const analytics = await response.json();
                this.updateAutomationAnalytics(analytics);
            }
        } catch (error) {
            console.error('Error loading automation analytics:', error);
        }
    }

    updateAutomationAnalytics(analytics) {
        const postsWeekElement = document.getElementById('automationPostsWeek');
        const nextPostElement = document.getElementById('automationNextPost');
        const queueLengthElement = document.getElementById('automationQueueLength');

        if (postsWeekElement) {
            postsWeekElement.textContent = analytics.postsThisPeriod || 0;
        }

        if (nextPostElement) {
            if (analytics.nextPost) {
                const nextDate = new Date(analytics.nextPost);
                nextPostElement.textContent = nextDate.toLocaleDateString();
            } else {
                nextPostElement.textContent = '--';
            }
        }

        if (queueLengthElement) {
            queueLengthElement.textContent = analytics.queueLength || 0;
        }
    }

    setupAutomationEventListeners() {
        console.log('🎛️ Setting up automation event listeners...');
        
        // Remove existing listeners to prevent duplicates
        this.removeAutomationEventListeners();
        
        // Automation toggle
        const automationToggle = document.getElementById('automationToggle');
        if (automationToggle) {
            console.log('✅ Adding automation toggle listener');
            automationToggle.addEventListener('click', this.handleAutomationToggle.bind(this));
        } else {
            console.warn('⚠️ Automation toggle not found');
        }

        // Automation form
        const automationForm = document.getElementById('automationForm');
        if (automationForm) {
            console.log('✅ Adding automation form listener');
            automationForm.addEventListener('submit', this.handleSaveAutomationSettings.bind(this));
        } else {
            console.warn('⚠️ Automation form not found');
        }

        // Generate queue button
        const generateQueueBtn = document.getElementById('generateQueueBtn');
        if (generateQueueBtn) {
            console.log('✅ Adding generate queue button listener');
            generateQueueBtn.addEventListener('click', this.handleGenerateQueue.bind(this));
        } else {
            console.warn('⚠️ Generate queue button not found');
        }

        // Process queue button
        const processQueueBtn = document.getElementById('processQueueBtn');
        if (processQueueBtn) {
            console.log('✅ Adding process queue button listener');
            processQueueBtn.addEventListener('click', this.handleProcessQueue.bind(this));
        } else {
            console.warn('⚠️ Process queue button not found');
        }

        // View toggle buttons
        const calendarViewBtn = document.getElementById('queueViewCalendar');
        const listViewBtn = document.getElementById('queueViewList');
        
        if (calendarViewBtn) {
            console.log('✅ Adding calendar view listener');
            calendarViewBtn.addEventListener('click', () => this.switchQueueView('calendar'));
        } else {
            console.warn('⚠️ Calendar view button not found');
        }
        
        if (listViewBtn) {
            console.log('✅ Adding list view listener');
            listViewBtn.addEventListener('click', () => this.switchQueueView('list'));
        } else {
            console.warn('⚠️ List view button not found');
        }

        // Preview schedule button
        const previewBtn = document.getElementById('previewScheduleBtn');
        if (previewBtn) {
            console.log('✅ Adding preview schedule listener');
            previewBtn.addEventListener('click', this.handlePreviewSchedule.bind(this));
        } else {
            console.warn('⚠️ Preview schedule button not found');
        }
        
        console.log('✅ Automation event listeners setup complete');
    }

    removeAutomationEventListeners() {
        // Remove existing event listeners to prevent duplicates
        const elements = [
            'automationToggle',
            'automationForm',
            'generateQueueBtn',
            'processQueueBtn',
            'queueViewCalendar',
            'queueViewList',
            'previewScheduleBtn'
        ];
        
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.replaceWith(element.cloneNode(true));
            }
        });
    }

    async handleAutomationToggle() {
        console.log('🔄 Automation toggle clicked');
        try {
            const toggleBtn = document.getElementById('automationToggle');
            if (!toggleBtn) {
                console.error('❌ Toggle button not found');
                return;
            }
            
            const isCurrentlyEnabled = toggleBtn.innerHTML.includes('ON');
            const newState = !isCurrentlyEnabled;
            console.log(`🔄 Toggling automation from ${isCurrentlyEnabled} to ${newState}`);

            const response = await fetch('/api/automation/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ enabled: newState })
            });

            console.log('📡 Toggle response status:', response.status);

            if (response.ok) {
                this.updateAutomationToggle(newState);
                this.showSuccess(`Automation ${newState ? 'enabled' : 'disabled'} successfully!`);
                console.log('✅ Automation toggle successful');
            } else {
                const errorText = await response.text();
                console.error('❌ Toggle failed:', errorText);
                this.showError('Failed to toggle automation');
            }
        } catch (error) {
            console.error('❌ Error toggling automation:', error);
            this.showError('Failed to toggle automation');
        }
    }

    async handleSaveAutomationSettings(e) {
        console.log('💾 Save automation settings triggered');
        e.preventDefault();
        e.stopPropagation();

        try {
            // Collect form data
            const formData = {
                enabled: true,
                frequency: document.getElementById('postFrequency')?.value || 'weekly',
                posting_times: document.getElementById('postTimes')?.value || 'afternoon',
                content_mix: document.getElementById('autoContentMix')?.value || 'balanced',
                default_tone: document.getElementById('autoTone')?.value || 'professional',
                topic_pool: Array.from(document.querySelectorAll('#topicPool input:checked')).map(cb => cb.value),
                posting_days: Array.from(document.querySelectorAll('#daysOfWeek input:checked')).map(cb => cb.value),
                auto_approve: false
            };

            console.log('📝 Form data collected:', formData);

            // Validation
            if (formData.topic_pool.length === 0) {
                console.warn('⚠️ No topics selected');
                this.showError('Please select at least one topic');
                return;
            }

            if (formData.posting_days.length === 0) {
                console.warn('⚠️ No days selected');
                this.showError('Please select at least one day of the week');
                return;
            }

            console.log('📡 Sending automation settings to server...');
            const response = await fetch('/api/automation/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            console.log('📡 Settings response status:', response.status);

            if (response.ok) {
                this.showSuccess('Automation settings saved successfully!');
                this.updateAutomationToggle(true);
                console.log('✅ Automation settings saved successfully');
            } else {
                const errorText = await response.text();
                console.error('❌ Save failed:', errorText);
                this.showError('Failed to save automation settings');
            }
        } catch (error) {
            console.error('❌ Error saving automation settings:', error);
            this.showError('Failed to save automation settings');
        }
    }

    async handleGenerateQueue() {
        console.log('✨ Generate queue clicked');
        try {
            const generateBtn = document.getElementById('generateQueueBtn');
            if (!generateBtn) {
                console.error('❌ Generate button not found');
                return;
            }

            const originalText = generateBtn.innerHTML;
            generateBtn.innerHTML = '⏳ Generating...';
            generateBtn.disabled = true;

            console.log('📡 Requesting queue generation...');
            const response = await fetch('/api/automation/generate-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ weeks: 4 })
            });

            console.log('📡 Generate queue response status:', response.status);

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Queue generated:', result);
                
                // Automatically process the queue to check for posts that should be posted immediately
                console.log('🔄 Processing queue for immediate posts...');
                try {
                    const processResponse = await fetch('/api/automation/process-queue', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });

                    if (processResponse.ok) {
                        const processResult = await processResponse.json();
                        console.log('✅ Queue processed:', processResult);
                        
                        const immediatelyPosted = processResult.results?.filter(r => r.action === 'posted_immediately').length || 0;
                        const scheduledForLater = processResult.results?.filter(r => r.action === 'scheduled_for_later').length || 0;
                        const failed = processResult.results?.filter(r => !r.success).length || 0;

                        let message = `Generated ${result.generated} posts for your automation queue!`;
                        if (immediatelyPosted > 0) {
                            message += ` ${immediatelyPosted} post(s) were posted immediately.`;
                        }
                        if (scheduledForLater > 0) {
                            message += ` ${scheduledForLater} post(s) scheduled for later.`;
                        }
                        if (failed > 0) {
                            message += ` ${failed} post(s) had errors.`;
                        }
                        
                        this.showSuccess(message);
                    } else {
                        console.warn('⚠️ Queue processing failed, but queue was generated successfully');
                        this.showSuccess(`Generated ${result.generated} posts for your automation queue! Processing will happen on next check.`);
                    }
                } catch (processError) {
                    console.warn('⚠️ Error processing queue:', processError);
                    this.showSuccess(`Generated ${result.generated} posts for your automation queue! Processing will happen on next check.`);
                }
                
                await this.loadAutomationQueue();
                await this.loadAutomationAnalytics();
            } else {
                const errorData = await response.text();
                console.error('❌ Generate queue failed:', errorData);
                let errorMessage = 'Failed to generate automation queue';
                try {
                    const errorJson = JSON.parse(errorData);
                    errorMessage = errorJson.error || errorMessage;
                } catch (e) {
                    console.warn('Error parsing response as JSON');
                }
                this.showError(errorMessage);
            }
        } catch (error) {
            console.error('❌ Error generating queue:', error);
            this.showError('Failed to generate automation queue');
        } finally {
            const generateBtn = document.getElementById('generateQueueBtn');
            if (generateBtn) {
                generateBtn.innerHTML = '✨ Generate Queue';
                generateBtn.disabled = false;
            }
        }
    }

    async handleProcessQueue() {
        console.log('🚀 Process queue manually triggered');
        try {
            const processBtn = document.getElementById('processQueueBtn');
            if (!processBtn) {
                console.error('❌ Process button not found');
                return;
            }

            const originalText = processBtn.innerHTML;
            processBtn.innerHTML = '⏳ Processing...';
            processBtn.disabled = true;

            console.log('📡 Requesting queue processing...');
            const response = await fetch('/api/automation/process-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            console.log('📡 Process queue response status:', response.status);

            if (response.ok) {
                const result = await response.json();
                console.log('✅ Queue processed:', result);
                
                const immediatelyPosted = result.results?.filter(r => r.action === 'posted_immediately').length || 0;
                const scheduledForLater = result.results?.filter(r => r.action === 'scheduled_for_later').length || 0;
                const failed = result.results?.filter(r => !r.success).length || 0;
                const processed = result.processed || 0;

                if (processed === 0) {
                    this.showSuccess('No posts were ready for processing at this time.');
                } else {
                    let message = `Processed ${processed} posts from your queue!`;
                    if (immediatelyPosted > 0) {
                        message += ` ${immediatelyPosted} post(s) were posted to LinkedIn immediately.`;
                    }
                    if (scheduledForLater > 0) {
                        message += ` ${scheduledForLater} post(s) scheduled for later.`;
                    }
                    if (failed > 0) {
                        message += ` ${failed} post(s) had errors.`;
                    }
                    
                    this.showSuccess(message);
                }
                
                await this.loadAutomationQueue();
                await this.loadAutomationAnalytics();
            } else {
                const errorData = await response.text();
                console.error('❌ Process queue failed:', errorData);
                let errorMessage = 'Failed to process automation queue';
                try {
                    const errorJson = JSON.parse(errorData);
                    errorMessage = errorJson.error || errorMessage;
                } catch (e) {
                    console.warn('Error parsing response as JSON');
                }
                this.showError(errorMessage);
            }
        } catch (error) {
            console.error('❌ Error processing queue:', error);
            this.showError('Failed to process automation queue');
        } finally {
            const processBtn = document.getElementById('processQueueBtn');
            if (processBtn) {
                processBtn.innerHTML = '🚀 Process Queue Now';
                processBtn.disabled = false;
            }
        }
    }

    switchQueueView(view) {
        console.log('🔄 Switching queue view to:', view);
        
        const calendarView = document.getElementById('calendarView');
        const listView = document.getElementById('listView');
        const calendarBtn = document.getElementById('queueViewCalendar');
        const listBtn = document.getElementById('queueViewList');

        if (!calendarView || !listView || !calendarBtn || !listBtn) {
            console.error('❌ Queue view elements not found:', {
                calendarView: !!calendarView,
                listView: !!listView,
                calendarBtn: !!calendarBtn,
                listBtn: !!listBtn
            });
            return;
        }

        if (view === 'calendar') {
            console.log('📅 Showing calendar view');
            calendarView.style.display = 'block';
            listView.style.display = 'none';
            calendarBtn.className = 'flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#0b80ee] text-slate-50 text-sm font-bold leading-normal tracking-[0.015em] view-toggle active';
            listBtn.className = 'flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#e7edf4] text-[#0d151c] text-sm font-bold leading-normal tracking-[0.015em] view-toggle';
        } else {
            console.log('📋 Showing list view');
            calendarView.style.display = 'none';
            listView.style.display = 'block';
            calendarBtn.className = 'flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#e7edf4] text-[#0d151c] text-sm font-bold leading-normal tracking-[0.015em] view-toggle';
            listBtn.className = 'flex min-w-[84px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#0b80ee] text-slate-50 text-sm font-bold leading-normal tracking-[0.015em] view-toggle active';
        }
        
        console.log('✅ Queue view switched successfully');
    }

    async handlePreviewSchedule() {
        try {
            const response = await fetch('/api/automation/queue?limit=10', {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.showSchedulePreview(data.queue);
            }
        } catch (error) {
            console.error('Error loading schedule preview:', error);
            this.showError('Failed to load schedule preview');
        }
    }

    showSchedulePreview(queue) {
        const preview = queue.slice(0, 7).map(post => {
            const date = new Date(post.scheduled_for);
            return `${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${post.topic}`;
        }).join('\n');

        alert(`Upcoming posts:\n\n${preview}`);
    }

    async editQueueItem(id) {
        console.log('✏️ Edit queue item:', id);
        try {
            // First get the current queue item details
            const response = await fetch(`/api/automation/queue/${id}`, {
                credentials: 'include'
            });

            if (!response.ok) {
                this.showError('Failed to load post details');
                return;
            }

            const queueItem = await response.json();
            this.showEditQueueModal(queueItem);
        } catch (error) {
            console.error('❌ Error loading queue item for edit:', error);
            this.showError('Failed to load post details');
        }
    }

    showEditQueueModal(queueItem) {
        const modal = document.createElement('div');
        modal.id = 'editQueueModal';
        modal.innerHTML = `
            <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                <div class="bg-white rounded-lg p-6 w-full max-w-md mx-4">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-xl font-bold text-[#0d151c]">Edit Scheduled Post</h3>
                        <button onclick="closeEditQueueModal()" class="text-[#6b7280] hover:text-[#0d151c]">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                            </svg>
                        </button>
                    </div>
                    
                    <form id="editQueueForm">
                        <div class="space-y-4">
                            <div>
                                <label class="block text-sm font-medium text-[#0d151c] mb-1">Topic</label>
                                <input type="text" id="editTopic" value="${queueItem.topic || ''}" 
                                       class="w-full px-3 py-2 border border-[#e7edf4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0b80ee]">
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-[#0d151c] mb-1">Content Type</label>
                                <select id="editContentType" class="w-full px-3 py-2 border border-[#e7edf4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0b80ee]">
                                    <option value="standard" ${queueItem.content_type === 'standard' ? 'selected' : ''}>Standard Post</option>
                                    <option value="viral" ${queueItem.content_type === 'viral' ? 'selected' : ''}>Viral Post</option>
                                    <option value="news" ${queueItem.content_type === 'news' ? 'selected' : ''}>News-based</option>
                                </select>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-[#0d151c] mb-1">Tone</label>
                                <select id="editTone" class="w-full px-3 py-2 border border-[#e7edf4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0b80ee]">
                                    <option value="professional" ${queueItem.tone === 'professional' ? 'selected' : ''}>Professional</option>
                                    <option value="casual" ${queueItem.tone === 'casual' ? 'selected' : ''}>Casual</option>
                                    <option value="friendly" ${queueItem.tone === 'friendly' ? 'selected' : ''}>Friendly</option>
                                    <option value="thought-leader" ${queueItem.tone === 'thought-leader' ? 'selected' : ''}>Thought Leader</option>
                                </select>
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-[#0d151c] mb-1">Scheduled Date & Time</label>
                                <input type="datetime-local" id="editScheduledTime" 
                                       value="${new Date(queueItem.scheduled_for).toISOString().slice(0, 16)}"
                                       class="w-full px-3 py-2 border border-[#e7edf4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0b80ee]">
                            </div>
                            
                            <div>
                                <label class="block text-sm font-medium text-[#0d151c] mb-1">Status</label>
                                <select id="editStatus" class="w-full px-3 py-2 border border-[#e7edf4] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0b80ee]">
                                    <option value="pending" ${queueItem.status === 'pending' ? 'selected' : ''}>Pending</option>
                                    <option value="ready" ${queueItem.status === 'ready' ? 'selected' : ''}>Ready</option>
                                    <option value="paused" ${queueItem.status === 'paused' ? 'selected' : ''}>Paused</option>
                                </select>
                            </div>
                        </div>
                        
                        <div class="flex gap-3 mt-6">
                            <button type="submit" class="flex-1 bg-[#0b80ee] text-white px-4 py-2 rounded-lg font-medium hover:bg-[#0969da] transition-colors">
                                Save Changes
                            </button>
                            <button type="button" onclick="closeEditQueueModal()" class="px-4 py-2 border border-[#e7edf4] text-[#6b7280] rounded-lg font-medium hover:bg-[#f8fafc] transition-colors">
                                Cancel
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';

        // Handle form submission
        const form = document.getElementById('editQueueForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.saveQueueItemChanges(queueItem.id);
        });
    }

    async saveQueueItemChanges(id) {
        try {
            const topic = document.getElementById('editTopic').value;
            const contentType = document.getElementById('editContentType').value;
            const tone = document.getElementById('editTone').value;
            const scheduledTime = document.getElementById('editScheduledTime').value;
            const status = document.getElementById('editStatus').value;

            const response = await fetch(`/api/automation/queue/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    topic,
                    content_type: contentType,
                    tone,
                    scheduled_for: new Date(scheduledTime).toISOString(),
                    status
                })
            });

            if (response.ok) {
                this.showSuccess('Post updated successfully!');
                this.closeEditQueueModal();
                await this.loadAutomationQueue();
                await this.loadAutomationAnalytics();
            } else {
                const errorData = await response.text();
                console.error('❌ Update failed:', errorData);
                this.showError('Failed to update post');
            }
        } catch (error) {
            console.error('❌ Error updating queue item:', error);
            this.showError('Failed to update post');
        }
    }

    closeEditQueueModal() {
        const modal = document.getElementById('editQueueModal');
        if (modal) {
            modal.remove();
            document.body.style.overflow = '';
        }
    }

    async deleteQueueItem(id) {
        if (!confirm('Are you sure you want to delete this scheduled post?')) {
            return;
        }

        try {
            const response = await fetch(`/api/automation/queue/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                this.showSuccess('Post deleted successfully');
                await this.loadAutomationQueue();
                await this.loadAutomationAnalytics();
            } else {
                this.showError('Failed to delete post');
            }
        } catch (error) {
            console.error('Error deleting queue item:', error);
            this.showError('Failed to delete post');
        }
    }

    handleGlobalClicks(e) {
        const action = e.target.getAttribute('data-action');
        
        if (action) {
            e.preventDefault();
            console.log('🔄 Global action:', action);
            
            switch (action) {
                case 'logout':
                    this.handleLogout(e);
                    break;
                case 'save-settings':
                    this.handleSaveSettings(e);
                    break;
                case 'quick-schedule':
                    this.handleQuickSchedule(e);
                    break;
                case 'copy':
                    this.copyToClipboard();
                    break;
                case 'regenerate':
                    this.regeneratePost();
                    break;
                case 'post':
                    this.handlePostToLinkedIn();
                    break;
                case 'close-modal':
                    this.closeModal(e);
                    break;
                case 'activate-key':
                    activateAccessKey();
                    break;
                default:
                    // Check for plan selection
                    if (action.startsWith('select-plan-')) {
                        const planId = action.replace('select-plan-', '');
                        this.selectPlan(planId);
                    }
                    break;
            }
        }
        
        // Handle topic chip clicks
        if (e.target.closest('.topic-chip')) {
            const chip = e.target.closest('.topic-chip');
            const topic = chip.getAttribute('data-topic');
            if (topic && this.topicInput) {
                this.topicInput.value = topic;
                
                // Visual feedback
                document.querySelectorAll('.topic-chip').forEach(c => c.classList.remove('selected'));
                chip.classList.add('selected');
            }
        }
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
        console.log('🔍 [Navigation Debug] ========== AUTH CHECK ==========');
        console.log('🔍 [Navigation Debug] Checking authentication status...');
        console.log('🔍 [Navigation Debug] Current page:', this.currentPage);
        console.log('🔍 [Navigation Debug] Current section:', this.currentSection);
        console.log('🔍 [Navigation Debug] Token exists:', !!this.getAuthToken());
        console.log('🔍 [Navigation Debug] URL:', window.location.href);
        try {
            const response = await fetch('/api/auth-status');
            
            if (response.ok) {
                let authData;
                try {
                    const text = await response.text();
                    if (text && text !== "undefined" && text.trim() !== "") {
                        authData = JSON.parse(text);
                    } else {
                        console.warn("No valid auth data received");
                        return false;
                    }
                } catch (parseError) {
                    console.error("JSON parse failed for auth:", parseError);
                    console.error("Response text:", text);
                    return false;
                }
                console.log('📋 Auth response:', authData);
                
                if (authData.authenticated && authData.user) {
                    console.log('✅ User is authenticated:', authData.user.name);
                    this.currentUser = authData.user;
                    this.isLoggedIn = true;
                    this.showAuthenticatedState();
                    
                    // Update credit display with latest balance
                    this.updateCreditDisplay();
                    
                    // Check subscription status after authentication
                    setTimeout(async () => {
                        const hasAccess = await this.checkSubscriptionLimit();
                        if (!hasAccess) {
                            console.log('🎯 No subscription found - showing pricing modal');
                        }
                    }, 1000); // Delay to allow UI to settle
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
        console.log('🟢 [Navigation Debug] ========== AUTH STATE ==========');
        console.log('🟢 [Navigation Debug] Showing authenticated state');
        console.log('🟢 [Navigation Debug] User:', this.currentUser?.name);
        console.log('🟢 [Navigation Debug] Current page:', this.currentPage);
        console.log('🟢 [Navigation Debug] Current section:', this.currentSection);
        console.log('🟢 [Navigation Debug] URL:', window.location.href);
        
        if (this.loginSection) {
            console.log('🔸 Hiding login section');
            this.loginSection.style.display = 'none';
        } else {
            console.log('⚠️ Login section not found');
        }
        
        if (this.userSection) {
            console.log('🔸 Showing user section');
            this.userSection.style.display = 'flex';
        } else {
            console.log('⚠️ User section not found');
        }
        
        // Update user name in navigation header
        const userName = document.getElementById('userName');
        if (userName && this.currentUser?.name) {
            console.log('🔸 Setting user name:', this.currentUser.name);
            userName.textContent = this.currentUser.name;
        }
        
        // Update credit balance display
        this.updateCreditDisplay();
        
        // Update user profile picture
        const userProfilePic = document.getElementById('userProfilePic');
        if (userProfilePic) {
            if (this.currentUser?.profilePicture) {
                console.log('🔸 Setting user profile picture:', this.currentUser.profilePicture);
                userProfilePic.src = this.currentUser.profilePicture;
                userProfilePic.style.display = 'block';
            } else {
                // Show default avatar if no profile picture
                console.log('🔸 Using default avatar - no profile picture available');
                userProfilePic.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIGZpbGw9Im5vbmUiIHZpZXdCb3g9IjAgMCAzMiAzMiI+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTYiIGZpbGw9IiNkMWQ1ZGIiLz48cGF0aCBmaWxsPSIjZmZmIiBkPSJNMTYgMTZhNCA0IDAgMSAwIDAtOCA0IDQgMCAwIDAgMCA4em0wIDJjLTIuNjcgMC04IDEuMzQtOCA0djJoMTZ2LTJjMC0yLjY2LTUuMzMtNC04LTR6Ii8+PC9zdmc+';
                userProfilePic.style.display = 'block';
            }
        }
        
        // Update dashboard user name
        const dashboardUserName = document.getElementById('dashboardUserName');
        if (dashboardUserName && this.currentUser?.name) {
            dashboardUserName.textContent = this.currentUser.name;
        }
        
        // Show user status section in dashboard
        const userStatusSection = document.getElementById('userStatusSection');
        if (userStatusSection) {
            userStatusSection.style.display = 'block';
        }
        
        this.isLoggedIn = true;
        
        // Load and display subscription status
        this.loadSubscriptionStatus();
    }
    
    updateCreditDisplay() {
        if (!this.currentUser) return;
        
        const credits = this.currentUser.credits || 0;
        
        // Find or create credit display element
        let creditDisplay = document.getElementById('creditDisplay');
        if (!creditDisplay) {
            creditDisplay = document.createElement('div');
            creditDisplay.id = 'creditDisplay';
            creditDisplay.className = 'text-sm font-medium text-gray-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-200';
            
            // Insert next to user name
            const userSection = this.userSection;
            if (userSection) {
                userSection.appendChild(creditDisplay);
            }
        }
        
        creditDisplay.innerHTML = `💳 ${credits} credits`;
        creditDisplay.title = `You have ${credits} credits available for content generation`;
        
        console.log('💳 Updated credit display:', credits);
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

    async loadSubscriptionStatus() {
        console.log('📋 Loading subscription status...');
        try {
            const response = await fetch('/api/subscription/status', {
                credentials: 'include'
            });
            
            if (response.ok) {
                let data;
                try {
                    const text = await response.text();
                    if (text && text !== "undefined" && text.trim() !== "") {
                        data = JSON.parse(text);
                    } else {
                        console.warn("No valid subscription data received");
                        this.hideSubscriptionStatus();
                        return;
                    }
                } catch (parseError) {
                    console.error("JSON parse failed:", parseError);
                    console.error("Response text:", text);
                    this.hideSubscriptionStatus();
                    return;
                }
                
                console.log('📋 Subscription data:', data);
                this.displaySubscriptionStatus(data);
                return data;
            } else {
                console.log('⚠️ Subscription status not available:', response.status);
                this.hideSubscriptionStatus();
                return null;
            }
        } catch (error) {
            console.error('❌ Failed to load subscription status:', error);
            this.hideSubscriptionStatus();
            return null;
        }
    }

    // Force refresh subscription status and update all UI elements
    async forceRefreshSubscription() {
        console.log('🔄 Force refreshing subscription status...');
        const data = await this.loadSubscriptionStatus();
        if (data) {
            this.displaySubscriptionStatus(data);
            // Force refresh the posts remaining counter
            const postsRemaining = data.subscription && data.subscription.posts_limit !== -1 ? data.subscription.posts_limit : 'Unlimited';
            const remainingElement = document.getElementById('posts-remaining');
            if (remainingElement) {
                remainingElement.textContent = postsRemaining;
            }
            console.log('✅ Subscription status refreshed');
        }
        return data;
    }

    // Reset monthly usage (for subscription issues)
    async resetMonthlyUsage() {
        try {
            console.log('🔧 Resetting monthly usage...');
            const response = await fetch('/api/subscription/reset-usage', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                console.log('✅ Usage reset successful:', data);
                this.showSuccess('✅ Monthly usage has been reset! You now have full access to your plan.');
                // Force refresh the subscription status
                await this.forceRefreshSubscription();
                return data;
            } else {
                const error = await response.json();
                console.error('❌ Usage reset failed:', error);
                this.showError('Failed to reset usage: ' + (error.details || error.error));
                return null;
            }
        } catch (error) {
            console.error('❌ Usage reset error:', error);
            this.showError('Error resetting usage. Please try again.');
            return null;
        }
    }

    // Add edit button to the generated content
    addEditButton() {
        // Check if edit button already exists
        if (document.getElementById('edit-content-btn')) {
            document.getElementById('edit-content-btn').style.display = 'inline-flex';
            return;
        }

        // Find the button container (same parent as copy and regenerate buttons)
        const copyBtn = this.copyBtn;
        if (!copyBtn || !copyBtn.parentElement) return;

        const buttonContainer = copyBtn.parentElement;
        
        // Create edit button
        const editBtn = document.createElement('button');
        editBtn.id = 'edit-content-btn';
        editBtn.className = 'btn btn-outline-secondary me-2';
        editBtn.innerHTML = '✏️ Edit Content';
        editBtn.style.display = 'inline-flex';
        editBtn.onclick = () => this.startEditMode();
        
        // Insert edit button between copy and regenerate buttons
        buttonContainer.insertBefore(editBtn, this.regenerateBtn);
    }

    // Start edit mode for the generated content
    startEditMode() {
        if (!this.currentPost) {
            this.showError('No content to edit');
            return;
        }

        // Find the content div
        const contentDiv = document.querySelector('#output .bg-white .text-base');
        if (!contentDiv) {
            this.showError('Content not found for editing');
            return;
        }

        // Store original content
        this.originalContent = this.currentPost.post;
        
        // Create textarea for editing
        const textarea = document.createElement('textarea');
        textarea.id = 'content-editor';
        textarea.className = 'w-full p-4 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500';
        textarea.style.minHeight = '150px';
        textarea.style.fontSize = '16px';
        textarea.style.lineHeight = '1.5';
        textarea.value = this.currentPost.post;
        
        // Replace content with textarea
        contentDiv.innerHTML = '';
        contentDiv.appendChild(textarea);
        
        // Update buttons
        this.updateEditButtons(true);
        
        // Focus on textarea
        textarea.focus();
        
        console.log('📝 Edit mode started');
    }

    // Update button states for edit mode
    updateEditButtons(isEditing) {
        const editBtn = document.getElementById('edit-content-btn');
        const copyBtn = this.copyBtn;
        const regenerateBtn = this.regenerateBtn;
        
        if (isEditing) {
            // Change edit button to save/cancel
            editBtn.innerHTML = '💾 Save Changes';
            editBtn.onclick = () => this.saveEditedContent();
            
            // Add cancel button
            if (!document.getElementById('cancel-edit-btn')) {
                const cancelBtn = document.createElement('button');
                cancelBtn.id = 'cancel-edit-btn';
                cancelBtn.className = 'btn btn-secondary me-2';
                cancelBtn.innerHTML = '❌ Cancel';
                cancelBtn.onclick = () => this.cancelEdit();
                editBtn.parentElement.insertBefore(cancelBtn, editBtn.nextSibling);
            }
            
            // Disable other buttons during editing
            if (copyBtn) copyBtn.disabled = true;
            if (regenerateBtn) regenerateBtn.disabled = true;
        } else {
            // Restore normal edit button
            editBtn.innerHTML = '✏️ Edit Content';
            editBtn.onclick = () => this.startEditMode();
            
            // Remove cancel button
            const cancelBtn = document.getElementById('cancel-edit-btn');
            if (cancelBtn) cancelBtn.remove();
            
            // Re-enable other buttons
            if (copyBtn) copyBtn.disabled = false;
            if (regenerateBtn) regenerateBtn.disabled = false;
        }
    }

    // Save edited content
    saveEditedContent() {
        const textarea = document.getElementById('content-editor');
        if (!textarea) {
            this.showError('Editor not found');
            return;
        }

        const editedContent = textarea.value.trim();
        if (!editedContent) {
            this.showError('Content cannot be empty');
            return;
        }

        // Update current post with edited content
        this.currentPost.post = editedContent;
        
        // Restore the content display
        const contentDiv = textarea.parentElement;
        contentDiv.innerHTML = `<div class="text-[#0d151c] text-base font-normal leading-normal whitespace-pre-wrap mb-4">${this.formatPostText(editedContent)}</div>`;
        
        // Update buttons back to normal mode
        this.updateEditButtons(false);
        
        this.showSuccess('✅ Content updated successfully!');
        console.log('💾 Content saved');
    }

    // Cancel editing and restore original content
    cancelEdit() {
        if (!this.originalContent) {
            this.showError('Original content not found');
            return;
        }

        // Find the content div and restore original content
        const contentDiv = document.querySelector('#content-editor').parentElement;
        contentDiv.innerHTML = `<div class="text-[#0d151c] text-base font-normal leading-normal whitespace-pre-wrap mb-4">${this.formatPostText(this.originalContent)}</div>`;
        
        // Update buttons back to normal mode
        this.updateEditButtons(false);
        
        console.log('❌ Edit cancelled');
    }

    // Refresh image for the current generated content
    async refreshImage(topic) {
        if (!topic) {
            this.showError('Unable to refresh image - topic not found');
            return;
        }

        const imageElement = document.getElementById('generated-image');
        const refreshBtn = document.getElementById('refresh-image-btn');
        
        if (!imageElement || !refreshBtn) {
            this.showError('Unable to refresh image - elements not found');
            return;
        }

        try {
            console.log('🔄 Refreshing image for topic:', topic);
            
            // Show loading state
            refreshBtn.innerHTML = `
                <svg class="w-4 h-4 text-gray-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
            `;
            refreshBtn.disabled = true;

            const response = await fetch('/api/refresh-image', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ topic })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('✅ New image fetched:', data.image);
                
                // Update the image
                imageElement.src = data.image.url;
                
                // Update photographer credit if it exists
                const creditElement = imageElement.parentElement.parentElement.querySelector('.text-xs.text-gray-500');
                if (creditElement && data.image.photographer) {
                    creditElement.textContent = `Photo by ${data.image.photographer} on ${data.image.source || 'Pexels'}`;
                }
                
                // Update current post data if available
                if (this.currentPost && this.currentPost.image) {
                    this.currentPost.image = data.image;
                }
                
                this.showSuccess('✨ New image loaded!');
            } else {
                const error = await response.json();
                console.error('❌ Image refresh failed:', error);
                this.showError('Failed to get new image: ' + (error.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('❌ Image refresh error:', error);
            this.showError('Error refreshing image. Please try again.');
        } finally {
            // Restore refresh button
            refreshBtn.innerHTML = `
                <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
            `;
            refreshBtn.disabled = false;
        }
    }

    displaySubscriptionStatus(data) {
        // Support both old and new subscription layouts
        const subscriptionSection = document.getElementById('subscriptionStatusSection') || document.getElementById('subscriptionCard');
        const currentPlan = document.getElementById('currentPlan');
        const subscriptionStatus = document.getElementById('subscriptionStatus');
        const creditsRemaining = document.getElementById('creditsRemaining');
        const nextBilling = document.getElementById('nextBilling');
        const nextBillingRow = document.getElementById('nextBillingRow');
        const manageBillingBtn = document.getElementById('manageBillingBtn');
        const upgradeBtn = document.getElementById('upgradeBtn');

        if (!subscriptionSection) {
            console.log('⚠️ Subscription section not found');
            return;
        }

        // Show subscription section
        subscriptionSection.style.display = 'block';

        // Update plan information
        if (data.subscription) {
            const subscription = data.subscription;
            
            // Plan name
            if (currentPlan) {
                currentPlan.textContent = subscription.plan_name || 'Unknown Plan';
            }
            
            // Status with color coding
            if (subscriptionStatus) {
                const status = subscription.status;
                let statusText = status.charAt(0).toUpperCase() + status.slice(1);
                let statusColor = '#28a745'; // green for active
                
                if (status === 'cancelled') {
                    statusColor = '#dc3545'; // red
                } else if (status === 'past_due' || status === 'incomplete') {
                    statusColor = '#ffc107'; // yellow
                }
                
                subscriptionStatus.textContent = statusText;
                subscriptionStatus.style.color = statusColor;
            }
            
            // Next billing date
            if (subscription.current_period_end && nextBilling && nextBillingRow) {
                const billingDate = new Date(subscription.current_period_end).toLocaleDateString();
                nextBilling.textContent = billingDate;
                nextBillingRow.style.display = 'flex';
            }
            
            // Show manage subscription button for active subscriptions
            const manageSubBtn = document.getElementById('manageSubBtn');
            if (manageSubBtn && subscription.status === 'active') {
                manageSubBtn.style.display = 'inline-block';
            }
            if (manageBillingBtn && subscription.status === 'active') {
                manageBillingBtn.style.display = 'inline-block';
            }
        } else {
            // No subscription - show free plan
            if (currentPlan) {
                currentPlan.textContent = 'Free Plan';
            }
            if (subscriptionStatus) {
                subscriptionStatus.textContent = 'Active';
                subscriptionStatus.style.color = '#28a745';
            }
            if (nextBillingRow) {
                nextBillingRow.style.display = 'none';
            }
        }

        // Credits remaining
        if (creditsRemaining) {
            const credits = this.currentUser ? this.currentUser.credits || 0 : 0;
            creditsRemaining.textContent = `${credits} remaining`;
            creditsRemaining.style.color = credits > 10 ? '#28a745' : credits > 0 ? '#ffc107' : '#dc3545';
        }

        // Setup button event listeners
        this.setupSubscriptionButtons();
    }

    hideSubscriptionStatus() {
        const subscriptionSection = document.getElementById('subscriptionStatusSection');
        if (subscriptionSection) {
            subscriptionSection.style.display = 'none';
        }
    }

    setupSubscriptionButtons() {
        const manageBillingBtn = document.getElementById('manageBillingBtn');
        const upgradeBtn = document.getElementById('upgradeBtn');

        if (manageBillingBtn) {
            manageBillingBtn.onclick = async () => {
                try {
                    const response = await fetch('/api/subscription/billing-portal', {
                        method: 'POST',
                        credentials: 'include',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            returnUrl: window.location.href
                        })
                    });

                    if (response.ok) {
                        let data;
                        try {
                            const text = await response.text();
                            if (text && text !== "undefined" && text.trim() !== "") {
                                data = JSON.parse(text);
                            } else {
                                console.error('No valid billing portal data received');
                                this.showError('Unable to open billing portal. Please try again.');
                                return;
                            }
                        } catch (parseError) {
                            console.error("JSON parse failed for billing portal:", parseError);
                            console.error("Response text:", text);
                            this.showError('Unable to open billing portal. Please try again.');
                            return;
                        }
                        window.location.href = data.url;
                    } else {
                        console.error('Failed to create billing portal session');
                        this.showError('Unable to open billing portal. Please try again.');
                    }
                } catch (error) {
                    console.error('Error opening billing portal:', error);
                    this.showError('Unable to open billing portal. Please try again.');
                }
            };
        }

        if (upgradeBtn) {
            upgradeBtn.onclick = () => {
                window.location.href = '/subscribe';
            };
        }
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
            
            // Recent activity removed due to LinkedIn API restrictions
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
        // Support both old and new automation table
        const scheduledTableBody = this.scheduledPostsList || document.getElementById('automationTableBody');
        if (!scheduledTableBody) return;
        
        // Update scheduled posts count in dashboard
        const scheduledPostsCount = document.getElementById('scheduledPostsCount');
        if (scheduledPostsCount) {
            scheduledPostsCount.textContent = posts.length;
        }
        
        if (posts.length === 0) {
            scheduledTableBody.innerHTML = `
                <tr><td colspan="3" class="text-center py-8 text-[#49749c]">
                    <div class="text-4xl mb-2">📅</div>
                    <p>No scheduled posts yet. Use the content generator to create and schedule posts!</p>
                </td></tr>
            `;
            return;
        }
        
        const scheduledHtml = posts.map(post => `
            <tr class="border-t border-t-[#cedce8]">
                <td class="h-[72px] px-4 py-2 w-[400px] text-[#0d151c] text-sm font-normal leading-normal">
                    ${post.topic || (post.content ? post.content.substring(0, 50) + '...' : 'Generated Content')}
                </td>
                <td class="h-[72px] px-4 py-2 w-60 text-sm font-normal leading-normal">
                    <button class="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-8 px-4 ${
                        post.status === 'published' ? 'bg-[#d1fae5] text-[#065f46]' : 
                        post.status === 'scheduled' ? 'bg-[#e7edf4] text-[#0d151c]' : 
                        'bg-[#fef3c7] text-[#92400e]'
                    } text-sm font-medium leading-normal w-full">
                        <span class="truncate capitalize">${post.status}</span>
                    </button>
                </td>
                <td class="h-[72px] px-4 py-2 w-[400px] text-[#49749c] text-sm font-normal leading-normal">
                    ${new Date(post.scheduled_for).toLocaleDateString()}
                </td>
            </tr>
        `).join('');
        
        scheduledTableBody.innerHTML = scheduledHtml;
    }
    
    // loadRecentActivity function removed - LinkedIn API restrictions
    
    displayRecentActivity(posts) {
        // Support both old and new activity list elements
        const activityList = this.activityList || document.getElementById('dashboardActivityList');
        
        if (!activityList) {
            console.log('⚠️ Activity list element not found');
            return;
        }

        if (!posts || !posts.posts || posts.posts.length === 0) {
            activityList.innerHTML = '<div class="text-center py-8 text-[#6b7280]">No recent activity</div>';
            return;
        }

        const activityHtml = posts.posts.map(post => `
            <div class="border-b border-[#cedce8] pb-4 mb-4 last:border-b-0 last:mb-0">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <div class="text-[#0d151c] font-medium text-sm mb-1">${post.topic || 'Generated Content'}</div>
                        <div class="text-[#49749c] text-xs">${this.formatDate(post.created_at)}</div>
                    </div>
                    <div class="ml-3">
                        <span class="bg-[#d1fae5] text-[#065f46] px-2 py-1 rounded-full text-xs font-medium capitalize">${post.status || 'posted'}</span>
                    </div>
                </div>
            </div>
        `).join('');
        
        activityList.innerHTML = activityHtml;
        
        if (posts.length === 0) {
            activityList.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #6b7280;">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📝</div>
                    <p>No recent posts yet. Create your first post to see activity here!</p>
                </div>
            `;
            return;
        }
        
        const postsHtml = posts.map(post => `
            <div style="border-bottom: 1px solid #e5e7eb; padding: 1rem 0; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="font-weight: 500; color: #1f2937; margin-bottom: 0.25rem;">${post.topic}</div>
                    <div style="font-size: 0.875rem; color: #6b7280;">${new Date(post.posted_at || post.scheduled_for).toLocaleDateString()}</div>
                </div>
                <div style="background: ${post.status === 'published' ? '#d1fae5' : '#fef3c7'}; color: ${post.status === 'published' ? '#065f46' : '#92400e'}; padding: 0.25rem 0.75rem; border-radius: 1rem; font-size: 0.75rem; font-weight: 500; text-transform: capitalize;">
                    ${post.status}
                </div>
            </div>
        `).join('');
        
        activityList.innerHTML = postsHtml;
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
        
        // Show preview modal instead of posting directly
        this.showLinkedInPreview();
    }

    showLinkedInPreview() {
        // Get the selected post type
        const selectedPostType = document.querySelector('input[name="postType"]:checked')?.value || 'image';
        const useArticleLink = selectedPostType === 'link';
        
        // Clean and validate the article URL
        let cleanArticleUrl = null;
        if (this.currentPost.article?.url && this.currentPost.article.url !== '#') {
            cleanArticleUrl = this.cleanUrl(this.currentPost.article.url);
        }

        // Create preview modal
        const modal = document.createElement('div');
        modal.id = 'linkedinPreviewModal';
        modal.className = 'linkedin-preview-modal';
        
        const userProfilePic = this.currentUser?.profilePicture || 'https://via.placeholder.com/48x48?text=👤';
        const userName = this.currentUser?.name || 'Your Name';
        const userTitle = this.currentUser?.headline || 'Professional Title';
        
        modal.innerHTML = `
            <div class="linkedin-preview-backdrop" data-action="close-preview"></div>
            <div class="linkedin-preview-container">
                <div class="linkedin-preview-header">
                    <h2>Preview Your LinkedIn Post</h2>
                    <button class="close-preview-btn" data-action="close-preview">×</button>
                </div>
                
                <div class="linkedin-post-preview">
                    <div class="linkedin-post-header">
                        <img src="${userProfilePic}" alt="${userName}" class="linkedin-profile-pic" />
                        <div class="linkedin-user-info">
                            <div class="linkedin-user-name">${userName}</div>
                            <div class="linkedin-user-title">${userTitle}</div>
                            <div class="linkedin-post-time">Now</div>
                        </div>
                        <div class="linkedin-post-options">⋯</div>
                    </div>
                    
                    <div class="linkedin-post-content">
                        ${this.formatPostText(this.currentPost.post)}
                    </div>
                    
                    ${useArticleLink && cleanArticleUrl ? `
                        <div class="linkedin-article-preview">
                            <div class="article-preview-placeholder">
                                🔗 Article Link Preview
                                <div class="article-url">${cleanArticleUrl}</div>
                            </div>
                        </div>
                    ` : (this.currentPost.image?.url ? `
                        <div class="linkedin-post-image">
                            <img src="${this.currentPost.image.url}" alt="Post image" />
                        </div>
                    ` : '')}
                    
                    <div class="linkedin-post-actions">
                        <div class="linkedin-action">👍 Like</div>
                        <div class="linkedin-action">💬 Comment</div>
                        <div class="linkedin-action">🔄 Repost</div>
                        <div class="linkedin-action">📤 Send</div>
                    </div>
                </div>
                
                <div class="linkedin-preview-actions">
                    <button class="preview-cancel-btn" data-action="close-preview">Cancel</button>
                    <button class="preview-post-btn" data-action="confirm-post">
                        🚀 Post to LinkedIn
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
        
        // Add event delegation for preview modal buttons
        this.setupPreviewEventListeners(modal);
        
        // Add styles if not already added
        this.addLinkedInPreviewStyles();
    }

    setupPreviewEventListeners(modal) {
        modal.addEventListener('click', (e) => {
            const action = e.target.getAttribute('data-action');
            
            if (action === 'close-preview') {
                closeLinkedInPreview();
            } else if (action === 'confirm-post') {
                confirmLinkedInPost();
            }
        });
    }

    addLinkedInPreviewStyles() {
        if (document.getElementById('linkedinPreviewStyles')) return;
        
        const styles = document.createElement('style');
        styles.id = 'linkedinPreviewStyles';
        styles.textContent = `
            .linkedin-preview-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .linkedin-preview-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
            }
            
            .linkedin-preview-container {
                position: relative;
                background: white;
                border-radius: 12px;
                max-width: 600px;
                width: 90%;
                max-height: 90vh;
                overflow-y: auto;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            }
            
            .linkedin-preview-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 24px;
                border-bottom: 1px solid #e0e0e0;
            }
            
            .linkedin-preview-header h2 {
                margin: 0;
                font-size: 20px;
                font-weight: 600;
                color: #333;
            }
            
            .close-preview-btn {
                background: none;
                border: none;
                font-size: 24px;
                color: #666;
                cursor: pointer;
                padding: 0;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            
            .close-preview-btn:hover {
                background: #f0f0f0;
            }
            
            .linkedin-post-preview {
                margin: 24px;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                background: white;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            
            .linkedin-post-header {
                display: flex;
                align-items: flex-start;
                padding: 16px;
                gap: 12px;
            }
            
            .linkedin-profile-pic {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                object-fit: cover;
                border: 2px solid #0073b1;
            }
            
            .linkedin-user-info {
                flex: 1;
            }
            
            .linkedin-user-name {
                font-weight: 600;
                font-size: 14px;
                color: #000;
                margin-bottom: 2px;
            }
            
            .linkedin-user-title {
                font-size: 12px;
                color: #666;
                margin-bottom: 4px;
            }
            
            .linkedin-post-time {
                font-size: 12px;
                color: #666;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            
            .linkedin-post-time::before {
                content: "🌐";
                font-size: 10px;
            }
            
            .linkedin-post-options {
                color: #666;
                font-size: 20px;
                cursor: pointer;
                padding: 4px;
            }
            
            .linkedin-post-content {
                padding: 0 16px 16px 16px;
                font-size: 14px;
                line-height: 1.5;
                color: #000;
                white-space: pre-wrap;
            }
            
            .linkedin-post-image {
                margin: 0 16px 16px 16px;
                border-radius: 8px;
                overflow: hidden;
            }
            
            .linkedin-post-image img {
                width: 100%;
                height: auto;
                display: block;
            }
            
            .linkedin-article-preview {
                margin: 0 16px 16px 16px;
                border: 1px solid #e0e0e0;
                border-radius: 8px;
                padding: 16px;
                background: #f8f9fa;
            }
            
            .article-preview-placeholder {
                text-align: center;
                color: #666;
                font-size: 14px;
            }
            
            .article-url {
                font-size: 12px;
                color: #0073b1;
                margin-top: 8px;
                word-break: break-all;
            }
            
            .linkedin-post-actions {
                display: flex;
                justify-content: space-around;
                padding: 12px 16px;
                border-top: 1px solid #e0e0e0;
                background: #f8f9fa;
            }
            
            .linkedin-action {
                font-size: 14px;
                color: #666;
                cursor: pointer;
                padding: 8px 12px;
                border-radius: 4px;
                transition: background-color 0.2s;
            }
            
            .linkedin-action:hover {
                background: #e0e0e0;
            }
            
            .linkedin-preview-actions {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 20px 24px;
                border-top: 1px solid #e0e0e0;
                background: #f8f9fa;
            }
            
            .preview-cancel-btn, .preview-post-btn {
                padding: 12px 24px;
                border-radius: 6px;
                font-weight: 600;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
            }
            
            .preview-cancel-btn {
                background: white;
                color: #666;
                border: 1px solid #ccc;
            }
            
            .preview-cancel-btn:hover {
                background: #f0f0f0;
            }
            
            .preview-post-btn {
                background: #0073b1;
                color: white;
                border: none;
            }
            
            .preview-post-btn:hover {
                background: #005885;
            }
        `;
        
        document.head.appendChild(styles);
    }

    async confirmLinkedInPost() {
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
            
            // Close the preview modal
            closeLinkedInPreview();
            
            // Show loading state
            this.setLoadingState(true);
            
            const response = await fetch('/api/post-now', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(postData)
            });
            
            if (response.ok) {
                const result = await response.json();
                this.showSuccess(`Posted to LinkedIn successfully! ${useArticleLink ? '(with article link preview)' : '(with image)'}`);
                // Recent activity removed
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
        } finally {
            this.setLoadingState(false);
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
                const formGroup = e.target.closest('.form-group');
                if (formGroup) {
                    formGroup.classList.add('focused');
                }
            });
            
            input.addEventListener('blur', (e) => {
                const formGroup = e.target.closest('.form-group');
                if (formGroup) {
                    formGroup.classList.remove('focused');
                }
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

    setupContextPanel() {
        console.log('👤 Setting up context panel...');
        
        const contextToggle = document.getElementById('contextToggle');
        const contextPanel = document.getElementById('contextPanel');
        const toggleText = document.getElementById('toggleText');
        const saveContextBtn = document.getElementById('saveContext');
        
        if (contextToggle && contextPanel) {
            contextToggle.addEventListener('click', () => {
                const isHidden = contextPanel.style.display === 'none';
                if (isHidden) {
                    contextPanel.style.display = 'block';
                    toggleText.textContent = 'Hide';
                    contextToggle.innerHTML = '<span id="toggleText">Hide</span> ▲';
                } else {
                    contextPanel.style.display = 'none';
                    toggleText.textContent = 'Show';
                    contextToggle.innerHTML = '<span id="toggleText">Show</span> ▼';
                }
            });
        }
        
        if (saveContextBtn) {
            saveContextBtn.addEventListener('click', this.saveUserContext.bind(this));
        }
        
        // Load existing context on page load
        this.loadUserContext();
    }

    async saveUserContext() {
        const personalBackground = document.getElementById('personalBackground')?.value || '';
        const recentActivities = document.getElementById('recentActivities')?.value || '';
        const expertiseInterests = document.getElementById('expertiseInterests')?.value || '';
        
        try {
            const response = await fetch('/api/user/context', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    personalBackground,
                    recentActivities,
                    expertiseInterests
                })
            });
            
            if (response.ok) {
                const statusElement = document.getElementById('contextSaveStatus');
                statusElement.textContent = '✅ Context saved!';
                setTimeout(() => {
                    statusElement.textContent = '';
                }, 3000);
            } else {
                throw new Error('Failed to save context');
            }
        } catch (error) {
            console.error('Error saving context:', error);
            const statusElement = document.getElementById('contextSaveStatus');
            statusElement.textContent = '❌ Save failed';
            statusElement.className = 'text-sm text-red-600';
        }
    }

    async loadUserContext() {
        try {
            const response = await fetch('/api/user/context', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const context = await response.json();
                if (context) {
                    document.getElementById('personalBackground').value = context.personalBackground || '';
                    document.getElementById('recentActivities').value = context.recentActivities || '';
                    document.getElementById('expertiseInterests').value = context.expertiseInterests || '';
                }
            }
        } catch (error) {
            console.error('Error loading context:', error);
        }
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
        console.log('🚀 handleFormSubmit called!');
        e.preventDefault();
        
        // Get form values
        const topic = document.getElementById('topic')?.value?.trim() || '';
        const tone = document.getElementById('tone')?.value || 'professional';
        const length = document.getElementById('length')?.value || 'medium';
        const contentType = document.getElementById('contentType')?.value || 'news';
        
        // Get student context if student-professional tone is selected
        let studentContext = {};
        if (tone === 'student-professional') {
            studentContext = {
                field: document.getElementById('studentField')?.value?.trim() || '',
                industry: document.getElementById('targetIndustry')?.value?.trim() || '',
                focus: document.getElementById('currentFocus')?.value?.trim() || ''
            };
        }
        
        // Get engagement options
        const engagementOptions = this.getEngagementOptions();
        
        console.log('📝 Form values:', { topic, tone, length, contentType, engagementOptions });
        
        // Validate based on content type
        if (contentType === 'news' || contentType === 'viral' || contentType === 'research') {
            if (!topic) {
                this.showError('Please enter a topic or select from popular topics');
                return;
            }
        } else if (contentType === 'tweet') {
            const tweetText = document.getElementById('tweetText')?.value?.trim() || '';
            if (!tweetText) {
                this.showError('Please paste the tweet content you want to repurpose');
                return;
            }
        } else if (contentType === 'manual') {
            const customContent = document.getElementById('customContent')?.value?.trim() || '';
            if (!customContent) {
                this.showError('Please enter your content idea');
                return;
            }
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
            switch (contentType) {
                case 'news':
                    console.log(`🎯 Generating news-based content for: ${topic}`);
                    await this.generatePost(topic, tone, length, engagementOptions, studentContext);
                    break;
                case 'research':
                    const keywords = document.getElementById('keywords')?.value?.trim() || '';
                    console.log(`🔍 Generating research-based content for: ${topic} with keywords: ${keywords}`);
                    try {
                        await this.generateResearchPost(topic, tone, length, engagementOptions, keywords, studentContext);
                    } catch (researchError) {
                        console.log('🔄 Research generation failed, falling back to news-based content...');
                        
                        // Reset loading state first
                        this.setLoadingState(false);
                        
                        // Show explanation popup
                        this.showResearchFallbackPopup(topic, researchError.message);
                        
                        // Automatically fall back to news-based generation
                        console.log(`🔍 Fallback: Generating news-based content for: ${topic}`);
                        this.setLoadingState(true); // Re-enable loading for fallback
                        await this.generatePost(topic, tone, length, engagementOptions, studentContext);
                        return; // Exit to avoid double error handling
                    }
                    break;
                case 'viral':
                    const viralFormat = document.getElementById('viralFormat')?.value || 'open-loop';
                    console.log(`🔥 Generating viral content for: ${topic} with format: ${viralFormat}`);
                    await this.generateViralPost(topic, tone, length, viralFormat, engagementOptions, studentContext);
                    break;
                case 'tweet':
                    const tweetText = document.getElementById('tweetText')?.value?.trim() || '';
                    console.log(`🔄 Repurposing tweet: ${tweetText.substring(0, 50)}...`);
                    await this.generateRepurposedTweet(tweetText, topic, tone, length, engagementOptions, studentContext);
                    break;
                case 'manual':
                    const customContent = document.getElementById('customContent')?.value?.trim() || '';
                    console.log(`🧠 Generating manual content from: ${customContent.substring(0, 50)}...`);
                    await this.generateManualPost(customContent, tone, length, engagementOptions, studentContext);
                    break;
                default:
                    console.log(`🎯 Fallback to news-based content for: ${topic}`);
                    await this.generatePost(topic, tone, length, engagementOptions, studentContext);
            }
        } catch (error) {
            console.error('❌ Generation failed:', error);
            
            // Check if it's a credit error
            if (error.message.includes('Insufficient credits') || error.message.includes('credits')) {
                // Credit modal already shown by the individual functions
                return;
            }
            
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
    
    handleContentTypeChange() {
        const contentType = document.getElementById('contentType')?.value || 'news';
        
        // Hide all content-specific sections
        const viralTemplates = document.getElementById('viralTemplates');
        const tweetInput = document.getElementById('tweetInput');
        const manualInput = document.getElementById('manualInput');
        const researchExplanation = document.getElementById('researchExplanation');
        const requiredKeywords = document.getElementById('requiredKeywords');
        
        if (viralTemplates) viralTemplates.style.display = 'none';
        if (tweetInput) tweetInput.style.display = 'none';
        if (manualInput) manualInput.style.display = 'none';
        if (researchExplanation) researchExplanation.style.display = 'none';
        if (requiredKeywords) requiredKeywords.style.display = 'none';
        
        // Show relevant section based on content type
        switch (contentType) {
            case 'research':
                if (researchExplanation) researchExplanation.style.display = 'block';
                if (requiredKeywords) requiredKeywords.style.display = 'block';
                break;
            case 'viral':
                if (viralTemplates) viralTemplates.style.display = 'block';
                break;
            case 'tweet':
                if (tweetInput) tweetInput.style.display = 'block';
                break;
            case 'manual':
                if (manualInput) manualInput.style.display = 'block';
                break;
            default:
                // 'news' - no additional sections needed
                break;
        }
    }

    handleToneChange() {
        const tone = document.getElementById('tone')?.value || 'professional';
        const studentContext = document.getElementById('studentContext');
        
        // Show student context panel only when "Student Professional" tone is selected
        if (studentContext) {
            if (tone === 'student-professional') {
                studentContext.style.display = 'block';
            } else {
                studentContext.style.display = 'none';
            }
        }
    }
    
    async checkSubscriptionLimit() {
        try {
            console.log('🔍 Checking subscription limit...');
            const response = await fetch('/api/subscription/status', {
                credentials: 'include', // Include cookies for authentication
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('📊 Subscription status response:', response.status);
        
            if (!response.ok) {
                console.error('❌ Failed to check subscription status:', response.status, response.statusText);
                
                // If it's just a 401, user might need to re-login
                if (response.status === 401) {
                    console.log('🔄 Authentication required - user needs to login');
                    // Don't show modal for auth issues, let them continue to login
                    return true;
                }
                
                await this.showSubscriptionModal();
                return false;
            }
        
            let data;
            try {
                const text = await response.text();
                console.log('📊 Subscription response text length:', text?.length || 0);
                console.log('📊 Subscription response preview:', text?.substring(0, 100) + '...');
                
                if (text && text !== "undefined" && text.trim() !== "" && text !== "null") {
                    data = JSON.parse(text);
                    console.log('✅ Subscription data parsed successfully');
                } else {
                    console.warn("❌ No valid subscription data received, text:", text);
                    await this.showSubscriptionModal();
                    return false;
                }
            } catch (parseError) {
                console.error("❌ Subscription JSON parse failed:", parseError);
                console.error("❌ Response text:", text);
                await this.showSubscriptionModal();
                return false;
            }
            
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

    // Show credit purchase modal
    async showCreditPurchaseModal(currentCredits = 0) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-8 max-w-md w-full mx-4">
                <h2 class="text-2xl font-bold mb-4 text-gray-800">Insufficient Credits</h2>
                <p class="text-gray-600 mb-6">You need credits to generate content. Current balance: <strong>${currentCredits} credits</strong></p>
                
                <div class="space-y-4 mb-6">
                    <div class="border rounded-lg p-4 text-center">
                        <div class="text-lg font-semibold">30 Credits - $0.49</div>
                        <div class="text-sm text-gray-600">Perfect for getting started</div>
                        <a href="/pricing" class="mt-2 bg-blue-600 text-white px-4 py-2 rounded-lg inline-block hover:bg-blue-700">
                            Buy Now
                        </a>
                    </div>
                    <div class="border rounded-lg p-4 text-center bg-blue-50">
                        <div class="text-lg font-semibold">100 Credits - $1.49</div>
                        <div class="text-sm text-gray-600">Best value for professionals</div>
                        <a href="/pricing" class="mt-2 bg-blue-600 text-white px-4 py-2 rounded-lg inline-block hover:bg-blue-700">
                            Buy Now
                        </a>
                    </div>
                </div>
                
                <div class="flex gap-4">
                    <button onclick="this.closest('.fixed').remove()" class="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                        Cancel
                    </button>
                    <a href="/pricing" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-center hover:bg-blue-700">
                        View All Plans
                    </a>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
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
            console.log('🔄 Loading modal plans...');
            const response = await fetch('/api/subscription/plans', {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('📋 Plans response status:', response.status);
            
            if (!response.ok) {
                console.error('❌ Plans request failed:', response.status, response.statusText);
                plansGrid.innerHTML = '<div class="loading">Failed to load pricing plans</div>';
                return;
            }
            
            let plans;
            try {
                const text = await response.text();
                console.log('📋 Plans response text length:', text?.length || 0);
                console.log('📋 Plans response preview:', text?.substring(0, 100) + '...');
                
                if (text && text !== "undefined" && text.trim() !== "" && text !== "null") {
                    plans = JSON.parse(text);
                    console.log('✅ Plans parsed successfully:', plans?.length || 0, 'plans');
                } else {
                    console.warn("❌ No valid plans data received, text:", text);
                    plansGrid.innerHTML = '<div class="loading">Unable to load pricing plans</div>';
                    return;
                }
            } catch (parseError) {
                console.error("❌ JSON parse failed for plans:", parseError);
                console.error("❌ Response text:", text);
                plansGrid.innerHTML = '<div class="loading">Error loading pricing plans</div>';
                return;
            }
            
            plansGrid.innerHTML = '';

            // Include all plans for the modal
            const allPlans = plans;

            allPlans.forEach((plan, index) => {
                const planCard = document.createElement('div');
                planCard.className = 'plan-card-modal';
                if (index === 1) planCard.classList.add('popular'); // Make Professional popular
                
                const regularPrice = plan.launch_price ? (plan.launch_price * 2).toFixed(2) : null;
                const features = plan.features?.features || ['AI-powered content', 'News integration', 'Multiple tones'];
                
                planCard.innerHTML = `
                    <div class="plan-name-modal">${plan.name}</div>
                    <div class="plan-price-modal">
                        ${plan.price === 0 ? 'FREE' : `${regularPrice ? `<span class="crossed">$${regularPrice}</span>` : ''}$${plan.launch_price || plan.price}/mo`}
                    </div>
                    <div class="plan-posts-modal">${plan.posts_limit === -1 ? 'Unlimited' : plan.posts_limit} posts/month</div>
                    <ul class="plan-features-modal">
                        ${features.slice(0, 3).map(feature => `<li>${feature}</li>`).join('')}
                    </ul>
                `;
                
                planCard.addEventListener('click', () => {
                    if (plan.price === 0) {
                        // Free trial - user already has it, just close modal
                        closeSubscriptionModal();
                    } else {
                        window.location.href = '/pricing';
                    }
                });
                
                plansGrid.appendChild(planCard);
            });
        } catch (error) {
            console.error('Error loading plans:', error);
            plansGrid.innerHTML = '<div class="error">Failed to load subscription plans. Please refresh the page.</div>';
        }
    }

    async loadMainPagePricing() {
        const mainPricingGrid = document.getElementById('mainPricingGrid');
        if (!mainPricingGrid) return; // Main pricing section might not exist on all pages
        
        try {
            const response = await fetch('/api/subscription/plans');
            let plans;
            try {
                const text = await response.text();
                if (text && text !== "undefined" && text.trim() !== "") {
                    plans = JSON.parse(text);
                } else {
                    console.warn("No valid plans data received");
                    mainPricingGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Unable to load pricing plans</div>';
                    return;
                }
            } catch (parseError) {
                console.error("JSON parse failed for plans:", parseError);
                console.error("Response text:", text);
                mainPricingGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Error loading pricing plans</div>';
                return;
            }
            
            mainPricingGrid.innerHTML = '';

            // Include all plans including free trial for the main page
            const allPlans = plans;

            allPlans.forEach((plan, index) => {
                const planCard = document.createElement('div');
                planCard.className = 'pricing-card';
                if (index === 1) planCard.classList.add('popular'); // Make Professional popular
                
                const regularPrice = plan.launch_price ? (plan.launch_price * 2).toFixed(2) : null;
                const features = plan.features?.features || [
                    'AI-powered content generation',
                    'Real-time news integration', 
                    'Multiple tone options',
                    'LinkedIn direct posting',
                    'Content analytics',
                    'Hashtag optimization'
                ];
                
                planCard.innerHTML = `
                    <h3>${plan.name}</h3>
                    <div class="price">
                        ${plan.price === 0 ? 'FREE' : `${regularPrice ? `<span class="crossed">$${regularPrice}</span>` : ''}$${plan.launch_price || plan.price}<span style="font-size: 18px;">/mo</span>`}
                    </div>
                    <div class="posts">${plan.posts_limit === -1 ? 'Unlimited' : plan.posts_limit} posts per month</div>
                    <ul class="features">
                        ${features.slice(0, 6).map(feature => `<li>${feature}</li>`).join('')}
                    </ul>
                    <button class="cta-button" data-action="${plan.price === 0 ? 'free-trial' : 'subscribe'}">
                        ${plan.price === 0 ? 'Already Active' : 'Get Started'}
                    </button>
                `;
                
                mainPricingGrid.appendChild(planCard);
            });
        } catch (error) {
            console.error('Error loading main page pricing:', error);
            mainPricingGrid.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">Failed to load pricing plans. Please refresh the page.</div>';
        }
    }


    
    async generatePost(topic, tone = 'professional', length = 'medium', engagementOptions = {}, studentContext = {}) {
        try {
            // Store current topic for image refresh
            this.currentTopic = topic;
            
            // Get auth token from localStorage or cookie
            const authToken = this.getAuthToken();
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header if token is available
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            const requestData = {
                topic,
                tone,
                length,
                engagement_options: engagementOptions,
                student_context: studentContext
            };
            
            console.log('📤 Sending request to generate post:', requestData);
            
            const response = await fetch('/api/generate-post', {
                method: 'POST',
                headers,
                credentials: 'include', // Still include cookies as fallback
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                let errorData = {};
                try {
                    const text = await response.text();
                    if (text && text !== "undefined" && text.trim() !== "") {
                        errorData = JSON.parse(text);
                    }
                } catch (parseError) {
                    console.warn('Failed to parse error response:', parseError);
                    errorData = { error: 'Server error occurred' };
                }
                
                // Check if it's a credit or subscription limit error
                if (response.status === 403 && (errorData.needsUpgrade || errorData.needsCredits)) {
                    if (errorData.needsCredits) {
                        await this.showCreditPurchaseModal(errorData.creditsRemaining || 0);
                    } else {
                        await this.showSubscriptionModal();
                    }
                    throw new Error(errorData.error || 'Credits or subscription required');
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            let data;
            try {
                const text = await response.text();
                if (text && text !== "undefined" && text.trim() !== "") {
                    data = JSON.parse(text);
                } else {
                    throw new Error('Empty or invalid response from server');
                }
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                throw new Error('Invalid response from server');
            }
            
            if (data.post) {
                this.currentPost = {
                    post: data.post,
                    image: data.image,
                    article: data.article
                };
                this.currentImageUrl = data.image?.url;
                this.currentArticleData = data.article;
                
                // Update credit balance if provided
                if (data.credits && this.currentUser) {
                    this.currentUser.credits = data.credits.remaining;
                    this.updateCreditDisplay();
                }
                
                this.displayGeneratedContent(data);
                this.showSuccess(`Content generated successfully! ${data.credits ? `(${data.credits.remaining} credits remaining)` : ''}`);
                
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
        console.log('🎨 displayGeneratedContent called with:', data);
        console.log('🎯 Output element:', this.output);
        
        if (!this.output) {
            console.error('❌ Output element not found!');
            return;
        }
        
        // Build the content HTML with Tailwind styling
        let contentHTML = '';
        
        // Extract title from post for image overlay
        const title = this.extractTitle(data.post);
        
        // Post content with text first, then image below
        contentHTML += `
            <div class="bg-white rounded-xl border border-[#cedce8] p-6 mb-4">
                <div class="text-[#0d151c] text-base font-normal leading-normal whitespace-pre-wrap mb-4">${this.formatPostText(data.post)}</div>
                ${data.image && data.image.url ? `
                    <div class="mt-4">
                        <div class="relative max-w-md mx-auto">
                            <img id="generated-image" src="${data.image.url}" alt="Generated content image" 
                                 class="w-full rounded-lg shadow-md object-cover"
                                 style="max-height: 300px;" />
                            <button id="refresh-image-btn" 
                                    class="absolute top-2 right-2 bg-white bg-opacity-90 hover:bg-opacity-100 rounded-full p-2 shadow-lg transition-all duration-200 hover:scale-110"
                                    title="Get a different image"
                                    onclick="window.employment.refreshImage('${data.topic || this.currentTopic}')">
                                <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                                </svg>
                            </button>
                        </div>
                        ${data.image.photographer ? `
                            <div class="text-center mt-2 text-xs text-gray-500">
                                Photo by ${data.image.photographer} on ${data.image.source || 'Pexels'}
                            </div>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
        
        // Post metadata
        const wordCount = data.post.split(' ').length;
        contentHTML += `
            <div class="bg-white rounded-xl border border-[#cedce8] p-4 mb-4">
                <div class="flex justify-between items-center text-sm">
                    <div class="flex gap-4">
                        <span class="text-[#49749c]">📝 ${wordCount} words</span>
                        <span class="text-[#49749c]">🎭 ${this.capitalizeFirst(this.toneSelect.value)}</span>
                        <span class="text-[#49749c]">📏 ${this.capitalizeFirst(this.lengthSelect.value)}</span>
                    </div>
                    <span class="text-[#49749c]">✨ ${new Date().toLocaleDateString()}</span>
                </div>
            </div>
        `;
        
        // Add type-specific information with Tailwind styling
        if (data.post_type === 'viral_format' && data.viral_format) {
            contentHTML += `
                <div class="bg-white rounded-xl border border-[#cedce8] p-4 mb-4">
                    <h3 class="text-[#0d151c] text-lg font-bold leading-tight mb-3">🔥 Viral Format Used</h3>
                    <div class="bg-[#f8fafc] rounded-lg p-4">
                        <h4 class="text-[#0d151c] font-semibold mb-2">${data.viral_format.label}</h4>
                        <p class="text-[#49749c] text-sm">${data.viral_format.description}</p>
                    </div>
                </div>
            `;
        } else if (data.post_type === 'repurposed_tweet' && data.original_tweet) {
            contentHTML += `
                <div class="bg-white rounded-xl border border-[#cedce8] p-4 mb-4">
                    <h3 class="text-[#0d151c] text-lg font-bold leading-tight mb-3">🐦 Original Tweet</h3>
                    <div class="bg-[#f8fafc] rounded-lg p-4">
                        <p class="text-[#0d151c] italic border-l-4 border-[#1DA1F2] pl-4 mb-2">
                            "${data.original_tweet}"
                        </p>
                        <p class="text-[#49749c] text-sm">
                            Adapted for LinkedIn's professional audience
                        </p>
                    </div>
                </div>
            `;
        } else if (data.post_type === 'manual' && data.custom_content) {
            contentHTML += `
                <div class="bg-white rounded-xl border border-[#cedce8] p-4 mb-4">
                    <h3 class="text-[#0d151c] text-lg font-bold leading-tight mb-3">✍️ Original Content</h3>
                    <div class="bg-[#f8fafc] rounded-lg p-4">
                        <p class="text-[#0d151c] italic border-l-4 border-[#0077B5] pl-4 mb-2">
                            "${data.custom_content.substring(0, 200)}${data.custom_content.length > 200 ? '...' : ''}"
                        </p>
                        <p class="text-[#49749c] text-sm">
                            Transformed into professional LinkedIn format
                        </p>
                    </div>
                </div>
            `;
        } else if (data.post_type === 'research_based' && data.research_sources) {
            // Research-based content with multiple sources
            contentHTML += `
                <div class="bg-white rounded-xl border border-[#cedce8] p-4 mb-4">
                    <h3 class="text-[#0d151c] text-lg font-bold leading-tight mb-3">🔍 Research Sources (${data.research_sources.length})</h3>
                    <div class="space-y-3">
                        ${data.research_sources.slice(0, 3).map((source, index) => `
                            <div class="bg-[#f8fafc] rounded-lg p-3">
                                <div class="flex items-start gap-3">
                                    <div class="text-blue-600 font-bold text-sm">${index + 1}</div>
                                    <div class="flex-1">
                                        <h4 class="text-[#0d151c] font-semibold text-sm mb-1">${source.title}</h4>
                                        <p class="text-[#49749c] text-xs mb-2">${source.summary.substring(0, 120)}...</p>
                                        <a href="${source.url}" target="_blank" rel="noopener" class="text-[#0b80ee] hover:underline text-xs">
                                            ${source.source} →
                                        </a>
                                    </div>
                                </div>
                            </div>
                        `).join('')}
                        ${data.research_sources.length > 3 ? `
                            <div class="text-center">
                                <span class="text-[#49749c] text-sm">+ ${data.research_sources.length - 3} more sources analyzed</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        } else if (data.article) {
            // Traditional news-based article
            contentHTML += `
                <div class="bg-white rounded-xl border border-[#cedce8] p-4 mb-4">
                    <h3 class="text-[#0d151c] text-lg font-bold leading-tight mb-3">📰 Source Article</h3>
                    <div class="bg-[#f8fafc] rounded-lg p-4">
                        <h4 class="text-[#0d151c] font-semibold mb-2">${data.article.title}</h4>
                        <p class="text-[#49749c] text-sm mb-3">${data.article.snippet || 'Recent news article'}</p>
                        <a href="${data.article.url}" target="_blank" rel="noopener" class="text-[#0b80ee] hover:underline text-sm">Read full article →</a>
                    </div>
                </div>
            `;
        }

        // Add engagement options used with Tailwind styling
        if (data.engagement_options) {
            const usedOptions = Object.entries(data.engagement_options)
                .filter(([key, value]) => value)
                .map(([key, value]) => {
                    const labels = {
                        curiosity_hook: '🧠 Curiosity Hook',
                        strong_opinion: '🔥 Strong Opinion',
                        soft_cta: '📣 Engagement CTA',
                        include_image: '📷 Relevant Image'
                    };
                    return labels[key] || key;
                });

            if (usedOptions.length > 0) {
                contentHTML += `
                    <div class="bg-white rounded-xl border border-[#cedce8] p-4 mb-4">
                        <h4 class="text-[#0d151c] text-sm font-semibold mb-3">🚀 Engagement Boosters Applied</h4>
                        <div class="flex flex-wrap gap-2">
                            ${usedOptions.map(option => 
                                `<span class="bg-[#E3F2FD] text-[#1976D2] px-3 py-1 rounded-full text-xs font-medium">${option}</span>`
                            ).join('')}
                        </div>
                    </div>
                `;
            }
        }
        
        console.log('🖼️ Setting output innerHTML to:', contentHTML.substring(0, 200) + '...');
        this.output.innerHTML = contentHTML;
        console.log('✅ Content set to output element');
        
        // Show action buttons and post options
        console.log('🔘 Showing action buttons...');
        const actionButtons = document.getElementById('actionButtons');
        if (actionButtons) {
            actionButtons.style.display = 'block';
            console.log('✅ Action buttons container shown');
        }
        
        // Add edit button if it doesn't exist
        this.addEditButton();
        
        if (this.postOptions) {
            this.postOptions.style.display = 'block';
            console.log('✅ Post options shown');
        }
        
        // Update post button state
        this.updatePostButtonState();
        
        // Scroll to output
        this.output.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    extractTitle(text) {
        // Extract first line or first sentence as title
        const lines = text.split('\n');
        const firstLine = lines[0].trim();
        
        // If first line is short and doesn't end with punctuation, use it as title
        if (firstLine.length < 80 && !firstLine.match(/[.!?]$/)) {
            return firstLine;
        }
        
        // Otherwise, extract first sentence
        const sentences = text.split(/[.!?]/);
        const firstSentence = sentences[0].trim();
        return firstSentence.length > 80 ? firstSentence.substring(0, 80) + '...' : firstSentence;
    }

    formatPostText(text) {
        if (!text) return '';
        return text
            .replace(/#(\w+)/g, '<span class="text-[#0b80ee] font-medium">#$1</span>')
            .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener" class="text-[#0b80ee] hover:underline">$1</a>')
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

    showResearchLoadingAnimation(topic) {
        if (this.generateBtn) {
            this.generateBtn.disabled = true;
            this.generateBtn.querySelector('.btn-text').textContent = '🔍 Researching...';
        }
        
        if (this.loader) {
            this.loader.style.display = 'block';
            this.loader.innerHTML = `
                <div class="research-loading">
                    <div class="loading-spinner"></div>
                    <div class="loading-steps">
                        <div class="loading-step active" data-step="search">
                            <span class="step-icon">📡</span>
                            <span class="step-text">Searching Google News RSS for "${topic.substring(0, 40)}${topic.length > 40 ? '...' : ''}"</span>
                        </div>
                        <div class="loading-step" data-step="extract">
                            <span class="step-icon">📄</span>
                            <span class="step-text">Extracting full article content...</span>
                        </div>
                        <div class="loading-step" data-step="generate">
                            <span class="step-icon">✨</span>
                            <span class="step-text">Generating research-based post...</span>
                        </div>
                    </div>
                    <div class="loading-note">
                        Using reliable RSS feeds for fast, accurate news discovery
                    </div>
                </div>
            `;
        }
        
        // Add CSS for research loading animation
        if (!document.getElementById('research-loading-styles')) {
            const style = document.createElement('style');
            style.id = 'research-loading-styles';
            style.textContent = `
                .research-loading {
                    text-align: center;
                    padding: 20px;
                    background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
                    border-radius: 12px;
                    margin: 20px 0;
                }
                
                .loading-spinner {
                    width: 40px;
                    height: 40px;
                    border: 4px solid #e2e8f0;
                    border-top: 4px solid #0b80ee;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                
                .loading-steps {
                    max-width: 400px;
                    margin: 0 auto;
                }
                
                .loading-step {
                    display: flex;
                    align-items: center;
                    padding: 8px 0;
                    opacity: 0.5;
                    transition: opacity 0.3s ease;
                }
                
                .loading-step.active {
                    opacity: 1;
                    animation: pulse 2s ease-in-out infinite;
                }
                
                .step-icon {
                    font-size: 18px;
                    margin-right: 12px;
                    width: 24px;
                }
                
                .step-text {
                    font-size: 14px;
                    color: #374151;
                    text-align: left;
                }
                
                .loading-note {
                    font-size: 12px;
                    color: #6b7280;
                    margin-top: 15px;
                    font-style: italic;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.7; }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Simulate progression through steps
        setTimeout(() => {
            const steps = this.loader.querySelectorAll('.loading-step');
            if (steps.length >= 2) {
                steps[0].classList.remove('active');
                steps[1].classList.add('active');
            }
        }, 5000);
        
        setTimeout(() => {
            const steps = this.loader.querySelectorAll('.loading-step');
            if (steps.length >= 3) {
                steps[1].classList.remove('active');
                steps[2].classList.add('active');
            }
        }, 12000);
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
                    <button class="regenerate-and-post-btn" data-action="regenerate-and-post">
                        🔄 Generate New Content & Post
                    </button>
                    <button class="modify-and-post-btn" data-action="modify-content">
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

    // Show research fallback popup
    showResearchFallbackPopup(topic, errorMessage) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.innerHTML = `
            <div class="bg-white rounded-lg p-8 max-w-md w-full mx-4">
                <div class="flex items-center mb-4">
                    <div class="text-3xl mr-3">🔄</div>
                    <h2 class="text-2xl font-bold text-gray-800">Switched to News-Based</h2>
                </div>
                
                <div class="mb-6 space-y-3">
                    <p class="text-gray-600">
                        <strong>Research mode couldn't find enough specific data for "${topic}"</strong>
                    </p>
                    <p class="text-sm text-gray-500 bg-gray-50 p-3 rounded">
                        💡 <strong>Tip:</strong> Research mode works best with specific, trending topics like:
                        <br>• "AI in workplace productivity"
                        <br>• "Remote team leadership strategies"  
                        <br>• "LinkedIn algorithm changes 2025"
                    </p>
                    <p class="text-gray-600">
                        <strong>We've automatically generated news-based content instead!</strong>
                    </p>
                </div>
                
                <div class="flex gap-4">
                    <button onclick="this.closest('.fixed').remove()" class="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                        Got it!
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Auto-close after 8 seconds
        setTimeout(() => {
            if (modal.parentNode) {
                modal.remove();
            }
        }, 8000);
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
            
            // Get form values
            const topic = this.topicInput.value.trim();
            const tone = this.toneSelect.value;
            const length = this.lengthSelect.value;
            const contentType = document.getElementById('contentType')?.value || 'news';
            const engagementOptions = this.getEngagementOptions();
            
            // Regenerate based on content type
            switch (contentType) {
                case 'news':
                    if (!topic) {
                        this.showError('Please enter a topic first');
                        return;
                    }
                    await this.generatePost(topic, tone, length, engagementOptions);
                    break;
                case 'viral':
                    if (!topic) {
                        this.showError('Please enter a topic first');
                        return;
                    }
                    const viralFormat = document.getElementById('viralFormat')?.value || 'open-loop';
                    await this.generateViralPost(topic, tone, length, viralFormat, engagementOptions);
                    break;
                case 'tweet':
                    const tweetText = document.getElementById('tweetText')?.value?.trim() || '';
                    if (!tweetText) {
                        this.showError('Please paste the tweet content first');
                        return;
                    }
                    await this.generateRepurposedTweet(tweetText, topic, tone, length, engagementOptions);
                    break;
                case 'manual':
                    const customContent = document.getElementById('customContent')?.value?.trim() || '';
                    if (!customContent) {
                        this.showError('Please enter your content idea first');
                        return;
                    }
                    await this.generateManualPost(customContent, tone, length, engagementOptions);
                    break;
                default:
                    if (!topic) {
                        this.showError('Please enter a topic first');
                        return;
                    }
                    await this.generatePost(topic, tone, length, engagementOptions);
            }
            
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
                        <button class="save-and-post-btn" data-action="save-modified">
                            💾 Save & Post
                        </button>
                        <button class="cancel-modifier-btn" data-action="cancel-modified">
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

    // Get engagement booster options from checkboxes
    getEngagementOptions() {
        return {
            curiosity_hook: document.getElementById('curiosityHook')?.checked || false,
            strong_opinion: document.getElementById('strongOpinion')?.checked || false,
            soft_cta: document.getElementById('softCTA')?.checked || false,
            include_image: document.getElementById('includeImage')?.checked || false
        };
    }



    // Generate manual post (like ChatGPT, without news API)
    async generateManualPost(topic, tone = 'professional', length = 'medium', engagementOptions = {}, studentContext = {}) {
        try {
            // Get auth token from localStorage or cookie
            const authToken = this.getAuthToken();
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header if token is available
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            const requestData = {
                custom_content: topic, // Use topic as custom content
                tone,
                length,
                post_type: 'manual',
                engagement_options: engagementOptions,
                student_context: studentContext
            };
            
            console.log('📤 Sending manual post request:', requestData);
            
            const response = await fetch('/api/generate-post', {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                let errorData = {};
                try {
                    const text = await response.text();
                    if (text && text !== "undefined" && text.trim() !== "") {
                        errorData = JSON.parse(text);
                    }
                } catch (parseError) {
                    console.warn('Failed to parse error response:', parseError);
                    errorData = { error: 'Server error occurred' };
                }
                
                // Check if it's a subscription limit error
                if (response.status === 403 && errorData.needsUpgrade) {
                    await this.showSubscriptionModal();
                    throw new Error(errorData.error || 'Subscription limit reached');
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            let data;
            try {
                const text = await response.text();
                if (text && text !== "undefined" && text.trim() !== "") {
                    data = JSON.parse(text);
                } else {
                    throw new Error('Empty or invalid response from server');
                }
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                throw new Error('Invalid response from server');
            }
            
            if (data.post) {
                this.currentPost = {
                    post: data.post,
                    image: data.image,
                    article: null, // No article for manual posts
                    post_type: 'manual'
                };
                this.currentImageUrl = data.image?.url;
                this.currentArticleData = null;
                
                this.displayGeneratedContent(data);
                this.showSuccess('Manual content generated successfully!');
                
                console.log('✅ Manual content generated successfully');
            } else {
                throw new Error(data.error || 'Failed to generate manual content');
            }
        } catch (error) {
            console.error('❌ Error generating manual post:', error);
            throw error;
        }
    }

    // Generate viral format post
    async generateViralPost(topic, tone = 'professional', length = 'medium', viralFormat = 'open-loop', engagementOptions = {}, studentContext = {}) {
        try {
            const authToken = this.getAuthToken();
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            const requestData = {
                topic,
                tone,
                length,
                post_type: 'viral',
                viral_format: viralFormat,
                engagement_options: engagementOptions,
                student_context: studentContext
            };
            
            console.log('📤 Sending viral post request:', requestData);
            
            const response = await fetch('/api/generate-post', {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                let errorData = {};
                try {
                    const text = await response.text();
                    if (text && text !== "undefined" && text.trim() !== "") {
                        errorData = JSON.parse(text);
                    }
                } catch (parseError) {
                    errorData = { error: 'Server error occurred' };
                }
                
                if (response.status === 403 && errorData.needsUpgrade) {
                    await this.showSubscriptionModal();
                    throw new Error(errorData.error || 'Subscription limit reached');
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            let data;
            try {
                const text = await response.text();
                if (text && text !== "undefined" && text.trim() !== "") {
                    data = JSON.parse(text);
                } else {
                    throw new Error('Empty or invalid response from server');
                }
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                throw new Error('Invalid response from server');
            }
            
            if (data.post) {
                this.currentPost = {
                    post: data.post,
                    image: data.image,
                    article: null,
                    post_type: 'viral',
                    viral_format: viralFormat
                };
                this.currentImageUrl = data.image?.url;
                this.currentArticleData = null;
                
                this.displayGeneratedContent(data);
                this.showSuccess('Viral content generated successfully!');
                
                console.log('✅ Viral content generated successfully');
            } else {
                throw new Error(data.error || 'Failed to generate viral content');
            }
        } catch (error) {
            console.error('❌ Error generating viral post:', error);
            throw error;
        }
    }

    // Generate repurposed tweet
    async generateRepurposedTweet(tweetText, topic, tone = 'professional', length = 'medium', engagementOptions = {}) {
        try {
            const authToken = this.getAuthToken();
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            const requestData = {
                tweet_text: tweetText,
                topic: topic || 'General',
                tone,
                length,
                post_type: 'tweet',
                engagement_options: engagementOptions
            };
            
            console.log('📤 Sending tweet repurpose request:', requestData);
            
            const response = await fetch('/api/generate-post', {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                let errorData = {};
                try {
                    const text = await response.text();
                    if (text && text !== "undefined" && text.trim() !== "") {
                        errorData = JSON.parse(text);
                    }
                } catch (parseError) {
                    errorData = { error: 'Server error occurred' };
                }
                
                if (response.status === 403 && errorData.needsUpgrade) {
                    await this.showSubscriptionModal();
                    throw new Error(errorData.error || 'Subscription limit reached');
                }
                
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            let data;
            try {
                const text = await response.text();
                if (text && text !== "undefined" && text.trim() !== "") {
                    data = JSON.parse(text);
                } else {
                    throw new Error('Empty or invalid response from server');
                }
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                throw new Error('Invalid response from server');
            }
            
            if (data.post) {
                this.currentPost = {
                    post: data.post,
                    image: data.image,
                    article: null,
                    post_type: 'tweet',
                    original_tweet: tweetText
                };
                this.currentImageUrl = data.image?.url;
                this.currentArticleData = null;
                
                this.displayGeneratedContent(data);
                this.showSuccess('Tweet repurposed successfully!');
                
                console.log('✅ Tweet repurposed successfully');
            } else {
                throw new Error(data.error || 'Failed to repurpose tweet');
            }
        } catch (error) {
            console.error('❌ Error repurposing tweet:', error);
            throw error;
        }
    }

    async generateResearchPost(topic, tone = 'professional', length = 'medium', engagementOptions = {}, keywords = '') {
        try {
            // Store current topic for image refresh
            this.currentTopic = topic;
            
            // Get auth token from localStorage or cookie
            const authToken = this.getAuthToken();
            
            const headers = {
                'Content-Type': 'application/json'
            };
            
            // Add authorization header if token is available
            if (authToken) {
                headers['Authorization'] = `Bearer ${authToken}`;
            }
            
            const requestData = {
                topic,
                tone,
                length,
                engagement_options: engagementOptions,
                required_keywords: keywords
            };
            
            console.log('📤 Sending request to generate research post:', requestData);
            
            // Show enhanced loading animation for research
            this.showResearchLoadingAnimation(topic);
            
            const response = await fetch('/api/generate-research-post', {
                method: 'POST',
                headers,
                credentials: 'include',
                body: JSON.stringify(requestData)
            });
            
            if (!response.ok) {
                let errorData = {};
                try {
                    const text = await response.text();
                    if (text && text !== "undefined" && text.trim() !== "") {
                        errorData = JSON.parse(text);
                    }
                } catch (parseError) {
                    console.warn('Failed to parse error response:', parseError);
                    errorData = { error: 'Server error occurred' };
                }
                
                // Check if it's a credit error
                if (response.status === 403 && errorData.needsCredits) {
                    await this.showCreditPurchaseModal(errorData.creditsRemaining || 0);
                    throw new Error(errorData.error || 'Insufficient credits');
                }
                
                // Check if it's a subscription limit error
                if (response.status === 403 && errorData.needsUpgrade) {
                    await this.showSubscriptionModal();
                    throw new Error(errorData.error || 'Subscription limit reached');
                }
                
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error || 'Unknown error'}`);
            }
            
            let data;
            try {
                const text = await response.text();
                if (text && text !== "undefined" && text.trim() !== "") {
                    data = JSON.parse(text);
                } else {
                    throw new Error('Empty or invalid response from server');
                }
            } catch (parseError) {
                console.error('Failed to parse response:', parseError);
                throw new Error('Invalid response from server');
            }
            
            if (data.success && data.data) {
                this.currentPost = {
                    post: data.data.post,
                    image: data.data.image,
                    article: data.data.article,
                    research_sources: data.data.research_sources
                };
                this.currentImageUrl = data.data.image?.url;
                this.currentArticleData = data.data.article;
                
                this.displayGeneratedContent(data.data);
                this.showSuccess(`Research-based content generated from ${data.research_stats.sources_found} sources!`);
                
                console.log('✅ Research post generated successfully');
                console.log(`📊 Research stats:`, data.research_stats);
            } else {
                throw new Error(data.error || 'Failed to generate research-based content');
            }
        } catch (error) {
            console.error('❌ Error generating research post:', error);
            throw error;
        }
    }
}

// Global functions for HTML onclick handlers
function copyToClipboard() {
    if (window.employment) {
        window.employment.copyToClipboard();
    }
}

function regeneratePost() {
    if (window.employment) {
        window.employment.regeneratePost();
    }
}

function postToLinkedIn() {
    if (window.employment) {
        window.employment.handlePostToLinkedIn();
    }
}

async function logout() {
    try {
        const response = await fetch('/auth/logout', { method: 'POST' });
        let data;
        try {
            const text = await response.text();
            if (text && text !== "undefined" && text.trim() !== "") {
                data = JSON.parse(text);
            } else {
                console.warn("No valid logout data received");
                data = { success: true }; // Assume success if no data
            }
        } catch (parseError) {
            console.error("JSON parse failed for logout:", parseError);
            console.error("Response text:", text);
            data = { success: true }; // Assume success if parsing fails
        }
        
        if (data.success) {
                if (window.employment) {
        window.employment.isLoggedIn = false;
        window.employment.currentUser = null;
        window.employment.showUnauthenticatedState();
        window.employment.updatePostButtonState();
            }
            console.log('✅ User logged out');
        } else {
            throw new Error('Logout failed');
        }
    } catch (error) {
        console.error('❌ Error logging out:', error);
        if (window.employment) {
            window.employment.showError('Failed to logout');
        }
    }
}

// LinkedIn Preview Modal Functions
function closeLinkedInPreview() {
    const modal = document.getElementById('linkedinPreviewModal');
    if (modal) {
        modal.remove();
        document.body.style.overflow = '';
    }
}

function confirmLinkedInPost() {
    if (window.employment) {
        window.employment.confirmLinkedInPost();
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
                'Content-Type': 'application/json'
            },
            credentials: 'include', // Include cookies for authentication
            body: JSON.stringify({ keyCode })
        });

        let result;
        try {
            const text = await response.text();
            if (text && text !== "undefined" && text.trim() !== "") {
                result = JSON.parse(text);
            } else {
                console.warn("No valid access key response received");
                showAccessKeyMessage('Invalid response from server', 'error');
                return;
            }
        } catch (parseError) {
            console.error("JSON parse failed for access key:", parseError);
            console.error("Response text:", text);
            showAccessKeyMessage('Invalid response format', 'error');
            return;
        }

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

// Automation queue management functions
function editQueueItem(id) {
    if (window.employment) {
        window.employment.editQueueItem(id);
    }
}

function deleteQueueItem(id) {
    if (window.employment) {
        window.employment.deleteQueueItem(id);
    }
}

function closeEditQueueModal() {
    if (window.employment) {
        window.employment.closeEditQueueModal();
    }
}

// Add custom topic to automation topic pool
function addCustomTopic() {
    const input = document.getElementById('customTopicInput');
    if (!input) return;
    
    const customTopic = input.value.trim();
    if (!customTopic) {
        alert('Please enter a topic name');
        return;
    }
    
    // Check if topic already exists
    const existingTopics = Array.from(document.querySelectorAll('#topicPool input[type="checkbox"]'))
        .map(cb => cb.value.toLowerCase());
    
    if (existingTopics.includes(customTopic.toLowerCase())) {
        alert('This topic already exists in the pool');
        return;
    }
    
    // Create new topic checkbox
    const topicPool = document.getElementById('topicPool');
    const label = document.createElement('label');
    label.className = 'flex items-center gap-2 bg-[#f8fafc] border border-[#e7edf4] rounded-lg px-3 py-2 cursor-pointer hover:bg-[#e7edf4] custom-topic';
    
    label.innerHTML = `
        <input type="checkbox" value="${customTopic}" class="text-[#0b80ee]" checked>
        <span class="text-[#0d151c] text-sm font-medium">✏️ ${customTopic}</span>
        <button type="button" onclick="removeCustomTopic(this)" 
                class="ml-auto text-red-500 hover:text-red-700 text-xs p-1"
                title="Remove custom topic">
            ✕
        </button>
    `;
    
    topicPool.appendChild(label);
    
    // Clear input
    input.value = '';
    
    // Show success message
    if (window.employment) {
        window.employment.showSuccess(`✅ Added "${customTopic}" to topic pool`);
    }
    
    console.log('✅ Custom topic added:', customTopic);
}

// Remove custom topic from automation topic pool
function removeCustomTopic(button) {
    const label = button.closest('label');
    const topicName = label.querySelector('input').value;
    
    if (confirm(`Remove "${topicName}" from topic pool?`)) {
        label.remove();
        
        if (window.employment) {
            window.employment.showSuccess(`🗑️ Removed "${topicName}" from topic pool`);
        }
        
        console.log('🗑️ Custom topic removed:', topicName);
    }
}

// Handle Enter key in custom topic input
document.addEventListener('DOMContentLoaded', function() {
    const customTopicInput = document.getElementById('customTopicInput');
    if (customTopicInput) {
        customTopicInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addCustomTopic();
            }
        });
    }
});

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎬 DOM Content Loaded - Initializing Employment...');
try {
    window.employment = new EmploymentApp();
    console.log('✅ Employment initialized successfully!');
} catch (error) {
    console.error('❌ Failed to initialize Employment:', error);
}
});

// Console welcome message
console.log(`
🚀 Employment - AI-Driven LinkedIn Content Platform
✨ Ready to create amazing content!

Keyboard shortcuts:
• Ctrl/Cmd + Enter: Generate content
• Ctrl/Cmd + C: Copy content (when generated)

Need help? Check the console for detailed logs.
`);