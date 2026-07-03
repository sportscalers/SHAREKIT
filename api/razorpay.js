import crypto from 'crypto';
import Razorpay from 'razorpay';
import { handleCors, json, errorResponse } from '../lib/cors.js';
import { getUserFromRequest, supabaseAdmin } from '../lib/supabase.js';

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export default async function handler(request) {
  const cors = handleCors(request);
  if (cors) return cors;
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Read the body ONCE as raw text. Razorpay's webhook signature is computed
  // over the exact raw bytes, so it must never be JSON-parsed-then-reserialized
  // before verification (that would silently break the signature check).
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (signature) {
    return handleWebhook(rawBody, signature);
  }
  return handleCreateSubscription(request, rawBody);
}

// ============================================================
// Webhook — Razorpay calls this directly, no user session involved.
// ============================================================
async function handleWebhook(rawBody, signature) {
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  const valid =
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));

  if (!valid) return errorResponse('Invalid webhook signature', 400);

  const event = JSON.parse(rawBody);
  const sub = event.payload?.subscription?.entity;

  try {
    switch (event.event) {
      case 'subscription.activated':
      case 'subscription.charged': {
        if (!sub) break;
        await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'active',
            current_period_end: sub.current_end ? new Date(sub.current_end * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq('razorpay_subscription_id', sub.id);

        const { data: row } = await supabaseAdmin
          .from('subscriptions')
          .select('user_id')
          .eq('razorpay_subscription_id', sub.id)
          .maybeSingle();
        if (row?.user_id) {
          await supabaseAdmin.from('profiles').update({ plan: 'pro' }).eq('id', row.user_id);
        }
        break;
      }

      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.expired':
      case 'subscription.halted': {
        if (!sub) break;
        await supabaseAdmin
          .from('subscriptions')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('razorpay_subscription_id', sub.id);

        const { data: row } = await supabaseAdmin
          .from('subscriptions')
          .select('user_id')
          .eq('razorpay_subscription_id', sub.id)
          .maybeSingle();
        if (row?.user_id) {
          await supabaseAdmin.from('profiles').update({ plan: 'free' }).eq('id', row.user_id);
        }
        break;
      }

      default:
        // payment.failed and other events are logged but don't change plan
        // state on their own — Razorpay retries failed charges automatically.
        break;
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Still return 200 so Razorpay doesn't retry forever on our bug; the
    // event is logged above for manual reconciliation.
  }

  return json({ received: true });
}

// ============================================================
// Create subscription — called by the logged-in user from the
// Subscription Plan screen, right before opening Razorpay Checkout.
// ============================================================
async function handleCreateSubscription(request, rawBody) {
  const user = await getUserFromRequest(request);
  if (!user) return errorResponse('Unauthorized', 401);

  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    body = {};
  }

  try {
    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID,
      customer_notify: 1,
      total_count: 120, // 10 years of monthly cycles; user can cancel anytime
      notes: { supabase_user_id: user.id, email: user.email || '' },
    });

    await supabaseAdmin.from('subscriptions').upsert({
      user_id: user.id,
      razorpay_subscription_id: subscription.id,
      razorpay_plan_id: process.env.RAZORPAY_PLAN_ID,
      status: 'created',
    });

    return json({
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error('Subscription creation error:', err);
    return errorResponse('Could not start checkout. Please try again.', 500);
  }
}
