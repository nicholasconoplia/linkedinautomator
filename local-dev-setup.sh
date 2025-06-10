#!/bin/bash

# Employment Local Development Setup Script
echo "🚀 Employment Local Development Environment"
echo "=========================================="

# Check if PostgreSQL is running
if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    echo "🔧 Starting PostgreSQL..."
    brew services start postgresql@15
    sleep 3
fi

# Check if database exists
if ! psql -h localhost -d linkedin_posts -c '\q' >/dev/null 2>&1; then
    echo "🔧 Creating database..."
    createdb linkedin_posts
fi

# Sync files to public directory
echo "📁 Syncing files to public directory..."
cp index.html public/index.html
cp styles.css public/styles.css
cp script.js public/script.js
cp subscribe.html public/subscribe.html
cp admin.html public/admin.html
cp test-subscription.html public/test-subscription.html

# Add PostgreSQL to PATH
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"

echo "✅ Local development environment ready!"
echo ""
echo "📋 Available pages:"
echo "  Main App:          http://localhost:3000"
echo "  Test Subscription: http://localhost:3000/test-subscription.html"
echo "  Admin Panel:       http://localhost:3000/admin.html"
echo "  Subscribe Page:    http://localhost:3000/subscribe.html"
echo ""
echo "🔧 To start the server:"
echo "  npm start"
echo ""
echo "🧪 To run tests:"
echo "  # Test authentication and subscription features"
echo "  open http://localhost:3000/test-subscription.html"
echo ""
echo "💡 Features to test:"
echo "  ✓ Post generation with AI"
echo "  ✓ Real-time news integration"  
echo "  ✓ Image generation"
echo "  ✓ Subscription status display"
echo "  ✓ Usage tracking"
echo "  ✓ User preferences"
echo "  ✓ Automated scheduling"
echo ""
echo "🎯 Test user credentials:"
echo "  LinkedIn ID: test-user-123"
echo "  Name: Nick Conoplia"
echo "  Plan: Starter (Active)"
echo "  Posts remaining: 28/30" 