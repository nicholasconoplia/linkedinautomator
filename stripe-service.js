const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { SubscriptionDB, UserDB } = require('./database');

class StripeService {
  constructor() {
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    // Validate Stripe configuration
    if (!process.env.STRIPE_SECRET_KEY) {
      console.error('❌ STRIPE_SECRET_KEY environment variable is not set');
      throw new Error('Stripe configuration missing: STRIPE_SECRET_KEY');
    }
    
    console.log('✅ Stripe service initialized with secret key');
  }

  // Create a Stripe customer
  async createCustomer(user) {
    try {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          linkedin_id: user.linkedin_id,
          user_id: user.id.toString()
        }
      });

      console.log('✅ Stripe customer created:', customer.id);
      return customer;
    } catch (error) {
      console.error('❌ Error creating Stripe customer:', error);
      throw error;
    }
  }

  // Create a checkout session for subscription
  async createCheckoutSession(userId, priceId, successUrl, cancelUrl) {
    try {
      const user = await UserDB.getUserById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if customer already exists
      let customerId = null;
      const existingSubscription = await SubscriptionDB.getUserSubscription(userId);
      
      if (existingSubscription && existingSubscription.stripe_customer_id) {
        customerId = existingSubscription.stripe_customer_id;
      } else {
        // Create new customer
        const customer = await this.createCustomer(user);
        customerId = customer.id;
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          user_id: userId.toString()
        }
      });

      console.log('✅ Checkout session created:', session.id);
      return session;
    } catch (error) {
      console.error('❌ Error creating checkout session:', error);
      throw error;
    }
  }

  // Create a billing portal session
  async createBillingPortalSession(userId, returnUrl) {
    try {
      const subscription = await SubscriptionDB.getUserSubscription(userId);
      console.log('🔧 Subscription data for billing portal:', subscription);
      
      if (!subscription || !subscription.stripe_customer_id) {
        throw new Error('No active subscription or customer ID found. Please contact support.');
      }

      console.log('🔧 Creating billing portal for customer:', subscription.stripe_customer_id);
      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripe_customer_id,
        return_url: returnUrl,
      });

      console.log('✅ Billing portal session created successfully');
      return session;
    } catch (error) {
      console.error('❌ Error creating billing portal session:', error);
      throw error;
    }
  }

  // Handle Stripe webhook events
  async handleWebhook(requestBody, signature) {
    try {
      const event = stripe.webhooks.constructEvent(
        requestBody,
        signature,
        this.webhookSecret
      );

      console.log('🔔 Stripe webhook received:', event.type);

      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutCompleted(event.data.object);
          break;

        case 'customer.subscription.created':
          await this.handleSubscriptionCreated(event.data.object);
          break;

        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;

        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object);
          break;

        default:
          console.log('⚠️ Unhandled webhook event:', event.type);
      }

      return { received: true };
    } catch (error) {
      console.error('❌ Webhook error:', error);
      throw error;
    }
  }

  // Handle successful checkout
  async handleCheckoutCompleted(session) {
    try {
      console.log('🔔 Processing checkout completion:', session.id);
      console.log('🔔 Session mode:', session.mode);
      console.log('🔔 Session metadata:', session.metadata);
      console.log('🔔 Session customer_details:', session.customer_details);
      console.log('🔔 Session customer:', session.customer);
      console.log('🔔 Session subscription:', session.subscription);
      
      // Check if this is a one-time credit purchase
      if (session.metadata?.plan_type === 'credit_pack' && session.metadata?.credit_amount) {
        console.log('📦 Detected credit pack purchase');
        await this.handleCreditPurchase(session);
        return;
      }
      
      // Also check for credit purchases in payment link format (without explicit plan_type)
      if (session.metadata?.credit_amount && !session.subscription) {
        console.log('📦 Detected credit purchase (payment link format)');
        await this.handleCreditPurchase(session);
        return;
      }
      
      // If it's a subscription mode, handle as subscription
      if (session.mode === 'subscription' || session.subscription) {
        console.log('📋 Detected subscription purchase');
        // Continue with subscription handling below
      } else {
        console.log('❓ Unknown payment type - defaulting to credit purchase handling');
        // For Payment Links that might not have explicit metadata, try to handle as credit purchase
        await this.handleCreditPurchase(session);
        return;
      }
      
      // Get subscription if this is a subscription payment
      let subscription = null;
      if (session.subscription) {
        subscription = await stripe.subscriptions.retrieve(session.subscription);
      }
      
      // Try to get user ID from metadata (for regular checkout sessions)
      let userId = session.metadata?.user_id ? parseInt(session.metadata.user_id) : null;
      
      // For Payment Links, metadata might not be available
      // Try to find user by customer email or existing customer record
      if (!userId && session.customer_details?.email) {
        console.log('🔧 No user metadata found, trying to find user by email:', session.customer_details.email);
        
        // Try to find user by email in our database
        const UserDB = require('./database').UserDB;
        const user = await UserDB.getUserByEmail(session.customer_details.email);
        if (user) {
          userId = user.id;
          console.log('✅ Found user by email:', userId);
        }
      }
      
      // If still no user found, try by existing stripe customer ID
      if (!userId && session.customer) {
        console.log('🔧 Trying to find user by Stripe customer ID:', session.customer);
        const existingSubscription = await SubscriptionDB.getUserSubscriptionByCustomer(session.customer);
        if (existingSubscription) {
          userId = existingSubscription.user_id;
          console.log('✅ Found user by existing customer record:', userId);
        }
      }
      
      if (!userId) {
        console.error('❌ Could not determine user ID for checkout session:', session.id);
        console.error('❌ Session customer_details:', session.customer_details);
        console.error('❌ Session metadata:', session.metadata);
        return;
      }
      
      console.log('✅ Checkout completed for user:', userId);
      
      // Handle subscription payments
      if (subscription) {
        // Get the plan from the price ID
        const priceId = subscription.items.data[0].price.id;
        const plans = await SubscriptionDB.getPlans();
        const plan = plans.find(p => p.stripe_price_id === priceId);
        
        if (!plan) {
          console.error('❌ Plan not found for price ID:', priceId);
          return;
        }

        // Update user subscription in database
        await SubscriptionDB.upsertSubscription(userId, {
          plan_id: plan.id,
          stripe_customer_id: session.customer,
          stripe_subscription_id: subscription.id,
          status: 'active',
          current_period_start: new Date(subscription.current_period_start * 1000),
          current_period_end: new Date(subscription.current_period_end * 1000)
        });

        console.log('✅ Subscription updated in database for user:', userId);
        
        // Add monthly credits for new subscription
        try {
          const CreditDB = require('./database').CreditDB;
          let creditsToAdd = plan.posts_limit || 30; // Default to 30 if not specified
          
          // Map subscription plans to credit amounts
          if (plan.name && plan.name.toLowerCase().includes('starter')) {
            creditsToAdd = 30;
          } else if (plan.name && plan.name.toLowerCase().includes('professional')) {
            creditsToAdd = 100;
          } else if (plan.name && plan.name.toLowerCase().includes('business')) {
            creditsToAdd = 300;
          }
          
          await CreditDB.addCredits(
            userId, 
            creditsToAdd, 
            `Monthly credits for ${plan.name} subscription`
          );
          
          console.log(`✅ Added ${creditsToAdd} monthly credits for ${plan.name} subscription`);
        } catch (creditError) {
          console.error('⚠️ Failed to add monthly credits:', creditError);
          // Don't fail the entire process if credit addition fails
        }
        
        // Reset monthly usage for new subscription
        try {
          const UsageDB = require('./database').UsageDB;
          await UsageDB.resetMonthlyUsage(userId);
          console.log('✅ Monthly usage reset for new subscription');
        } catch (resetError) {
          console.error('⚠️ Failed to reset monthly usage:', resetError);
          // Don't fail the entire process if usage reset fails
        }
      } else {
        console.log('ℹ️ Non-subscription payment completed for user:', userId);
      }
    } catch (error) {
      console.error('❌ Error handling checkout completion:', error);
    }
  }

  // Handle credit purchase from payment links
  async handleCreditPurchase(session) {
    try {
      console.log('💳 Processing credit purchase:', session.id);
      console.log('💳 Credit purchase metadata:', session.metadata);
      
      let userId = session.metadata?.user_id ? parseInt(session.metadata.user_id) : null;
      let creditAmount = parseInt(session.metadata?.credit_amount || 0);
      let planName = session.metadata?.plan_name || session.metadata?.pack_type || 'Credit Purchase';
      
      // If no credit amount in metadata, try to determine from price/amount
      if (!creditAmount && session.amount_total) {
        const amountInDollars = session.amount_total / 100; // Convert from cents
        console.log('💳 Payment amount:', amountInDollars);
        
        // Map common payment amounts to credit amounts based on our pricing
        if (amountInDollars === 0.99) {
          creditAmount = 25;
          planName = 'Small Credit Pack';
        } else if (amountInDollars === 2.49) {
          creditAmount = 75;
          planName = 'Medium Credit Pack';
        } else if (amountInDollars === 5.99) {
          creditAmount = 200;
          planName = 'Large Credit Pack';
        } else {
          console.log('⚠️ Unknown payment amount for credit purchase:', amountInDollars);
          // Default to a reasonable amount based on price
          creditAmount = Math.floor(amountInDollars * 25); // Roughly 25 credits per dollar
        }
        
        console.log(`💳 Determined credit amount from payment: ${creditAmount} credits for $${amountInDollars}`);
      }
      
      // For Payment Links, try to find user by customer email
      if (!userId && session.customer_details?.email) {
        console.log('🔧 Finding user by email for credit purchase:', session.customer_details.email);
        
        const UserDB = require('./database').UserDB;
        const user = await UserDB.getUserByEmail(session.customer_details.email);
        if (user) {
          userId = user.id;
          console.log('✅ Found user by email for credit purchase:', userId);
        }
      }
      
      // If still no user found, try by existing stripe customer ID
      if (!userId && session.customer) {
        console.log('🔧 Trying to find user by Stripe customer ID for credit purchase:', session.customer);
        const SubscriptionDB = require('./database').SubscriptionDB;
        const existingSubscription = await SubscriptionDB.getUserSubscriptionByCustomer(session.customer);
        if (existingSubscription) {
          userId = existingSubscription.user_id;
          console.log('✅ Found user by existing customer record for credit purchase:', userId);
        }
      }
      
      if (!userId) {
        console.error('❌ Could not determine user ID for credit purchase:', session.id);
        console.error('❌ Session details:', {
          customer_email: session.customer_details?.email,
          customer_id: session.customer,
          metadata: session.metadata
        });
        return;
      }
      
      if (!creditAmount || creditAmount <= 0) {
        console.error('❌ Invalid credit amount for purchase:', creditAmount);
        return;
      }
      
      // Add credits to user account
      const CreditDB = require('./database').CreditDB;
      const newBalance = await CreditDB.addCredits(userId, creditAmount, `${planName} purchase via Stripe`);
      
      console.log(`✅ Credit purchase completed for user ${userId}: +${creditAmount} credits, new balance: ${newBalance}`);
      
      // Sync the credit balance to the users table for consistency
      try {
        const { Pool } = require('pg');
        const dbPool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        await dbPool.query('UPDATE users SET credits = $1 WHERE id = $2', [newBalance, userId]);
        console.log(`✅ User table credit balance synced: ${newBalance} credits`);
      } catch (syncError) {
        console.error('⚠️ Failed to sync credit balance to users table:', syncError);
      }
      
    } catch (error) {
      console.error('❌ Error handling credit purchase:', error);
    }
  }

  // Handle subscription creation
  async handleSubscriptionCreated(subscription) {
    try {
      console.log('✅ Subscription created:', subscription.id);
      // Additional logic if needed
    } catch (error) {
      console.error('❌ Error handling subscription creation:', error);
    }
  }

  // Handle subscription updates
  async handleSubscriptionUpdated(subscription) {
    try {
      console.log('🔄 Subscription updated:', subscription.id);
      
      // Find user by stripe subscription ID
      const userSub = await SubscriptionDB.getUserSubscription(subscription.customer);
      if (!userSub) {
        console.error('❌ User subscription not found for customer:', subscription.customer);
        return;
      }

      // Update subscription status
      let status = 'active';
      if (subscription.status === 'canceled') status = 'cancelled';
      else if (subscription.status === 'past_due') status = 'past_due';
      else if (subscription.status === 'unpaid') status = 'unpaid';

      await SubscriptionDB.updateSubscriptionStatus(userSub.user_id, status);
      console.log('✅ Subscription status updated:', status);
    } catch (error) {
      console.error('❌ Error handling subscription update:', error);
    }
  }

  // Handle subscription deletion
  async handleSubscriptionDeleted(subscription) {
    try {
      console.log('🗑️ Subscription deleted:', subscription.id);
      
      // Find user and update status to cancelled
      const userSub = await SubscriptionDB.getUserSubscription(subscription.customer);
      if (userSub) {
        await SubscriptionDB.updateSubscriptionStatus(userSub.user_id, 'cancelled');
        console.log('✅ Subscription marked as cancelled');
      }
    } catch (error) {
      console.error('❌ Error handling subscription deletion:', error);
    }
  }

  // Handle successful payment
  async handlePaymentSucceeded(invoice) {
    try {
      console.log('💰 Payment succeeded:', invoice.id);
      // Could add logic for usage-based billing, credits, etc.
    } catch (error) {
      console.error('❌ Error handling payment success:', error);
    }
  }

  // Handle failed payment
  async handlePaymentFailed(invoice) {
    try {
      console.log('❌ Payment failed:', invoice.id);
      
      // Find user and update status
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const userSub = await SubscriptionDB.getUserSubscription(subscription.customer);
      
      if (userSub) {
        await SubscriptionDB.updateSubscriptionStatus(userSub.user_id, 'past_due');
        console.log('⚠️ Subscription marked as past due');
      }
    } catch (error) {
      console.error('❌ Error handling payment failure:', error);
    }
  }

  // Handle PaymentIntent succeeded (for Payment Element subscriptions)
  async handlePaymentIntentSucceeded(paymentIntent) {
    try {
      console.log('✅ PaymentIntent succeeded:', paymentIntent.id);
      
      // For subscription payments, activate the subscription
      if (paymentIntent.invoice) {
        const invoice = await stripe.invoices.retrieve(paymentIntent.invoice);
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          
          // Find user by customer ID
          const userSub = await SubscriptionDB.getUserSubscriptionByCustomer(subscription.customer);
          if (userSub) {
            // Update subscription status to active
            await SubscriptionDB.updateSubscriptionStatus(userSub.user_id, 'active');
            console.log('✅ Subscription activated for user:', userSub.user_id);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling PaymentIntent success:', error);
    }
  }

  // Handle PaymentIntent failed (for Payment Element subscriptions)
  async handlePaymentIntentFailed(paymentIntent) {
    try {
      console.log('❌ PaymentIntent failed:', paymentIntent.id);
      
      // Update subscription status if applicable
      if (paymentIntent.invoice) {
        const invoice = await stripe.invoices.retrieve(paymentIntent.invoice);
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          
          // Find user by customer ID
          const userSub = await SubscriptionDB.getUserSubscriptionByCustomer(subscription.customer);
          if (userSub) {
            // Update subscription status to incomplete
            await SubscriptionDB.updateSubscriptionStatus(userSub.user_id, 'incomplete');
            console.log('⚠️ Subscription marked incomplete for user:', userSub.user_id);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error handling PaymentIntent failure:', error);
    }
  }

  // Get pricing information
  async getPrices() {
    try {
      const prices = await stripe.prices.list({
        active: true,
        expand: ['data.product'],
      });

      return prices.data.map(price => ({
        id: price.id,
        amount: price.unit_amount,
        currency: price.currency,
        interval: price.recurring?.interval,
        product: {
          id: price.product.id,
          name: price.product.name,
          description: price.product.description
        }
      }));
    } catch (error) {
      console.error('❌ Error fetching prices:', error);
      throw error;
    }
  }

  // Create a subscription with incomplete status (for Payment Element)
  async createSubscription(customerId, priceId) {
    try {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{
          price: priceId,
        }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent']
      });

      console.log('✅ Subscription created with incomplete status:', subscription.id);
      return subscription;
    } catch (error) {
      console.error('❌ Error creating subscription:', error);
      throw error;
    }
  }

  // Cancel a subscription
  async cancelSubscription(subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.cancel(subscriptionId);
      console.log('✅ Subscription cancelled:', subscription.id);
      return subscription;
    } catch (error) {
      console.error('❌ Error cancelling subscription:', error);
      throw error;
    }
  }

  // Update subscription (for plan changes)
  async updateSubscription(subscriptionId, newPriceId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      
      const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
        items: [{
          id: subscription.items.data[0].id,
          price: newPriceId,
        }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent']
      });

      console.log('✅ Subscription updated:', updatedSubscription.id);
      return updatedSubscription;
    } catch (error) {
      console.error('❌ Error updating subscription:', error);
      throw error;
    }
  }
}

module.exports = StripeService; 