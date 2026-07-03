import { createClient } from '@supabase/supabase-js';

// Service-role client — used ONLY in backend functions, never sent to the browser.
// It bypasses Row Level Security, which is required for the cron job and the
// Razorpay webhook (neither has a logged-in user's session).
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Verifies the Supabase access token sent by the frontend in the
// "Authorization: Bearer <token>" header. Returns the user or null.
export async function getUserFromRequest(request) {
  const authHeader = request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function getProfile(userId) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  return data;
}

const FREE_DAILY_LIMIT = 5;

// Free-tier gate: 5 total AI creations per day, enforced server-side so it
// can't be bypassed by editing frontend JS. Pro users always pass this check.
export async function checkDailyLimit(userId, plan) {
  if (plan === 'pro') return { allowed: true };

  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from('daily_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle();

  const used = data?.count || 0;
  if (used >= FREE_DAILY_LIMIT) {
    return { allowed: false, remaining: 0, limit: FREE_DAILY_LIMIT };
  }
  return { allowed: true, remaining: FREE_DAILY_LIMIT - used, limit: FREE_DAILY_LIMIT };
}

export async function incrementDailyUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from('daily_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .maybeSingle();

  await supabaseAdmin
    .from('daily_usage')
    .upsert({ user_id: userId, usage_date: today, count: (data?.count || 0) + 1 });
}

// Pro-tier monthly metering — matches the ₹30–40/user budget plan:
// 100 video analyses, 1000+ image analyses, 30 image generations, 500+ chat messages.
export const MONTHLY_LIMITS = {
  video_analysis: 100,
  image_analysis: 1000,
  image_generation: 30,
  chat_messages: 500,
  speech_to_text: 200,
};

export async function checkMonthlyLimit(userId, metric) {
  const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const limit = MONTHLY_LIMITS[metric];
  if (!limit) return { allowed: true };

  const { data } = await supabaseAdmin
    .from('monthly_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('usage_month', month)
    .eq('metric', metric)
    .maybeSingle();

  const used = data?.count || 0;
  if (used >= limit) {
    return { allowed: false, remaining: 0, limit };
  }
  return { allowed: true, remaining: limit - used, limit };
}

export async function incrementMonthlyUsage(userId, metric) {
  const month = new Date().toISOString().slice(0, 7);
  const { data } = await supabaseAdmin
    .from('monthly_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('usage_month', month)
    .eq('metric', metric)
    .maybeSingle();

  await supabaseAdmin
    .from('monthly_usage')
    .upsert({ user_id: userId, usage_month: month, metric, count: (data?.count || 0) + 1 });
}

export async function saveGeneration(userId, tool, input, output) {
  await supabaseAdmin.from('generations').insert({ user_id: userId, tool, input, output });
}
