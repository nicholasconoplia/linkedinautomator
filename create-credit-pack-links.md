# Stripe Payment Links Setup for Credit Packs

## Credit Pack Pricing
- **Small Pack**: 25 credits for $0.99
- **Medium Pack**: 75 credits for $2.49  
- **Large Pack**: 200 credits for $5.99

## Steps to Create Payment Links

### 1. Go to Stripe Dashboard
- Navigate to **Products** → **Payment Links**
- Click **Create payment link**

### 2. Small Pack Setup
**Product Details:**
- Name: `Employment Small Credit Pack`
- Description: `25 credits for Employment - Never expire, use anytime`
- Price: `$0.99 USD` (one-time)

**Metadata to Add:**
```
plan_type: credit_pack
credit_amount: 25
pack_type: small
```

**Settings:**
- ✅ Collect customer information
- ✅ Allow promotion codes
- Success URL: `https://employment.vercel.app/subscription/success`
- Cancel URL: `https://employment.vercel.app/pricing`

### 3. Medium Pack Setup
**Product Details:**
- Name: `Employment Medium Credit Pack`
- Description: `75 credits for Employment - Never expire, use anytime`
- Price: `$2.49 USD` (one-time)

**Metadata to Add:**
```
plan_type: credit_pack
credit_amount: 75
pack_type: medium
```

### 4. Large Pack Setup
**Product Details:**
- Name: `Employment Large Credit Pack`
- Description: `200 credits for Employment - Never expire, use anytime`
- Price: `$5.99 USD` (one-time)

**Metadata to Add:**
```
plan_type: credit_pack
credit_amount: 200
pack_type: large
```

## After Creating Payment Links

### Update pricing.html
Replace the placeholder URLs in the JavaScript:

```javascript
case 'small':
    stripeUrl = `https://buy.stripe.com/YOUR_SMALL_PACK_LINK?${params.toString()}`;
    break;
case 'medium':
    stripeUrl = `https://buy.stripe.com/YOUR_MEDIUM_PACK_LINK?${params.toString()}`;
    break;
case 'large':
    stripeUrl = `https://buy.stripe.com/YOUR_LARGE_PACK_LINK?${params.toString()}`;
    break;
```

## Webhook Events to Monitor
Make sure your webhook at `https://employment.vercel.app/api/webhooks/stripe` is set up to handle:
- ✅ `checkout.session.completed`
- ✅ `customer.subscription.created`
- ✅ `customer.subscription.updated`
- ✅ `customer.subscription.deleted`
- ✅ `invoice.payment_succeeded`
- ✅ `invoice.payment_failed`

## Testing
1. Create the payment links in Stripe
2. Update the URLs in pricing.html
3. Test each credit pack purchase
4. Verify credits are added to user accounts
5. Check webhook logs for successful processing 