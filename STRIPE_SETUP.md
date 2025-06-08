# 💳 Stripe Payment Setup Guide for PostPilot

This guide will help you set up Stripe for subscription payments and access key management in PostPilot.

## 📋 Prerequisites

1. **Stripe Account**: Create a free account at [stripe.com](https://stripe.com)
2. **PostPilot Application**: Fully functional with database
3. **Domain**: Required for webhooks (localhost works for development)

## 🚀 Step 1: Create Stripe Account & Get API Keys

### 1.1 Sign Up for Stripe
1. Go to [stripe.com](https://stripe.com)
2. Click "Start now" and create your account
3. Complete the verification process
4. Activate your account for live payments

### 1.2 Get API Keys
1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Navigate to **Developers > API keys**
3. Copy your keys:
   - **Publishable key** (starts with `pk_`)
   - **Secret key** (starts with `sk_`)

⚠️ **Important**: Use test keys for development, live keys for production!

## 🏗️ Step 2: Create Products and Prices in Stripe

### 2.1 Create Products
Go to **Products** in Stripe Dashboard and create these products:

```
1. PostPilot Starter
   - Description: Perfect for individuals
   - Price: $2.99/month

2. PostPilot Professional  
   - Description: For active professionals
   - Price: $9.99/month

3. PostPilot Business
   - Description: For businesses and teams
   - Price: $19.99/month

4. PostPilot Enterprise
   - Description: Unlimited posting
   - Price: $49.99/month
```

### 2.2 Get Price IDs
After creating products, copy the **Price IDs** (start with `price_`). You'll need these for your database.

## 🔧 Step 3: Configure Environment Variables

Add these variables to your `.env` file:

```env
# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# For production, use live keys:
# STRIPE_SECRET_KEY=sk_live_your_live_secret_key
# STRIPE_PUBLISHABLE_KEY=pk_live_your_live_publishable_key
```

## 🔗 Step 4: Set Up Webhooks

### 4.1 Create Webhook Endpoint
1. In Stripe Dashboard, go to **Developers > Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL:
   - **Development**: `https://your-ngrok-url.ngrok.io/api/webhooks/stripe`
   - **Production**: `https://your-domain.com/api/webhooks/stripe`

### 4.2 Select Events
Select these webhook events:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

### 4.3 Get Webhook Secret
After creating the webhook:
1. Click on your webhook endpoint
2. Go to **Signing secret**
3. Click **Reveal** and copy the secret (starts with `whsec_`)
4. Add it to your `.env` file as `STRIPE_WEBHOOK_SECRET`

## 🗄️ Step 5: Update Database with Price IDs

Update your subscription plans in the database with the Stripe price IDs:

```sql
UPDATE subscription_plans SET stripe_price_id = 'price_your_starter_price_id' WHERE name = 'Starter';
UPDATE subscription_plans SET stripe_price_id = 'price_your_professional_price_id' WHERE name = 'Professional';
UPDATE subscription_plans SET stripe_price_id = 'price_your_business_price_id' WHERE name = 'Business';
UPDATE subscription_plans SET stripe_price_id = 'price_your_enterprise_price_id' WHERE name = 'Enterprise';
```

## 🧪 Step 6: Testing

### 6.1 Install Dependencies
```bash
npm install
```

### 6.2 Test Stripe Connection
Start your server and test the endpoints:

```bash
# Get subscription plans
curl http://localhost:3000/api/subscription/plans

# Should return plans with stripe_price_id populated
```

### 6.3 Test Payment Flow
1. Use Stripe test cards:
   - **Success**: `4242 4242 4242 4242`
   - **Declined**: `4000 0000 0000 0002`
   - **Requires 3D Secure**: `4000 0027 6000 3184`

2. Use any future expiry date (e.g., 12/34)
3. Use any 3-digit CVC (e.g., 123)

## 🌐 Step 7: Frontend Integration (What You Need to Implement)

### 7.1 Add Stripe JS to Your HTML
```html
<script src="https://js.stripe.com/v3/"></script>
```

### 7.2 Subscription Flow Example
```javascript
// Initialize Stripe
const stripe = Stripe('pk_test_your_publishable_key');

// Create checkout session
async function subscribeToPlan(priceId) {
  const response = await fetch('/api/subscription/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ priceId })
  });
  
  const { sessionId } = await response.json();
  
  // Redirect to Stripe Checkout
  await stripe.redirectToCheckout({ sessionId });
}
```

## 🔑 Step 8: Access Key Management

### 8.1 Create Access Keys (Admin)
```javascript
// Admin endpoint to create access keys
const createAccessKey = async (name, postsLimit, validUntil) => {
  const response = await fetch('/api/admin/access-key/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, postsLimit, validUntil })
  });
  
  const result = await response.json();
  console.log('Access Key:', result.accessKey.key_code);
};
```

### 8.2 Use Access Keys (Users)
```javascript
// User activates an access key
const activateAccessKey = async (keyCode) => {
  const response = await fetch('/api/access-key/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyCode })
  });
  
  return await response.json();
};
```

## 🚦 Step 9: Going Live

### 9.1 Activate Live Payments
1. Complete Stripe account verification
2. Provide business information
3. Set up bank account for payouts

### 9.2 Switch to Live Keys
1. Replace test keys with live keys in `.env`
2. Update webhook endpoint URLs
3. Test with real (small amount) transactions

### 9.3 Production Checklist
- ✅ SSL certificate installed
- ✅ Webhook endpoints working
- ✅ Error handling implemented
- ✅ Usage limits properly enforced
- ✅ Customer support process defined

## 💡 Step 10: Advanced Features (Optional)

### 10.1 Usage-Based Billing
```javascript
// Track overage charges
const trackOverage = async (userId, extraPosts) => {
  await stripe.invoiceItems.create({
    customer: customerId,
    amount: extraPosts * 50, // $0.50 per extra post
    currency: 'usd',
    description: `${extraPosts} additional posts`
  });
};
```

### 10.2 Proration Handling
```javascript
// Handle plan upgrades/downgrades
const changePlan = async (subscriptionId, newPriceId) => {
  await stripe.subscriptions.update(subscriptionId, {
    items: [{ id: subscriptionItemId, price: newPriceId }],
    proration_behavior: 'create_prorations'
  });
};
```

## 🆘 Troubleshooting

### Common Issues:

1. **Webhook Signature Verification Failed**
   - Check webhook secret is correct
   - Ensure raw body is passed to webhook handler

2. **"No such price" Error**
   - Verify price IDs in database match Stripe
   - Check if using test vs live price IDs

3. **Customer Not Found**
   - Ensure customer creation happens before checkout
   - Check customer ID storage in database

4. **Subscription Status Not Updating**
   - Verify webhook endpoints are reachable
   - Check webhook event types are selected

### Getting Help:
- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Discord Community](https://discord.gg/stripe)
- [PostPilot Support](mailto:support@postpilot.com) (when live)

## 📊 Revenue Tracking

Monitor your success in Stripe Dashboard:
- **Revenue**: Track monthly recurring revenue (MRR)
- **Churn**: Monitor subscription cancellations
- **Growth**: Analyze new customer acquisition
- **Analytics**: Use Stripe's built-in reporting

---

🎉 **Congratulations!** You've successfully set up Stripe payments for PostPilot. Your users can now subscribe to plans and you can start generating revenue from your AI-powered LinkedIn content platform! 