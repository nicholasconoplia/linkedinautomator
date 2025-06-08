const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { SubscriptionDB, UserDB } = require('./database');

class StripeService {
  constructor() {
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
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
      if (!subscription || !subscription.stripe_customer_id) {
        throw new Error('No active subscription found');
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: subscription.stripe_customer_id,
        return_url: returnUrl,
      });

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
      const userId = parseInt(session.metadata.user_id);
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      
      console.log('✅ Checkout completed for user:', userId);
      
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

      console.log('✅ Subscription updated in database');
    } catch (error) {
      console.error('❌ Error handling checkout completion:', error);
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