#!/usr/bin/env node

// LinkedIn OAuth Configuration Checker
// Run with: node check-linkedin-config.js

require('dotenv').config();

console.log('🔍 LinkedIn OAuth Configuration Check\n');

// Check environment variables
const requiredVars = {
    'LINKEDIN_CLIENT_ID': process.env.LINKEDIN_CLIENT_ID,
    'LINKEDIN_CLIENT_SECRET': process.env.LINKEDIN_CLIENT_SECRET,
    'LINKEDIN_CALLBACK_URL': process.env.LINKEDIN_CALLBACK_URL
};

console.log('📋 Environment Variables:');
Object.entries(requiredVars).forEach(([key, value]) => {
    if (value) {
        if (key === 'LINKEDIN_CLIENT_SECRET') {
            console.log(`✅ ${key}: ${'*'.repeat(value.length)} (hidden)`);
        } else {
            console.log(`✅ ${key}: ${value}`);
        }
    } else {
        console.log(`❌ ${key}: NOT SET`);
    }
});

console.log('\n🌐 Expected Configuration:');
console.log('• LinkedIn Developer Console should have:');
console.log('  - Redirect URL: http://localhost:3000/auth/linkedin/callback');
console.log('  - App should be in "Development" or "Live" status');

console.log('\n🧪 Test LinkedIn OAuth:');
console.log('1. Start your server: npm start');
console.log('2. Visit: http://localhost:3000');
console.log('3. Click "Connect LinkedIn Account"');
console.log('4. Check browser network tab for any errors');

console.log('\n🔗 Useful Links:');
console.log('• LinkedIn Developer Console: https://www.linkedin.com/developers/apps');
console.log('• Your App Settings: https://www.linkedin.com/developers/apps/' + (process.env.LINKEDIN_CLIENT_ID || 'YOUR_CLIENT_ID'));

const allConfigured = Object.values(requiredVars).every(v => v);
console.log(`\n${allConfigured ? '✅' : '❌'} Configuration Status: ${allConfigured ? 'READY' : 'NEEDS SETUP'}`); 