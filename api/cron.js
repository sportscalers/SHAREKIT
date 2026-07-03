import { json, errorResponse } from '../lib/cors.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendPush } from '../lib/fcm.js';

// Vercel automatically sends "Authorization: Bearer <CRON_SECRET>" when it
// triggers this on schedule (see vercel.json). This check stops anyone else
// from hitting the public URL and spamming notifications.
export default async function handler(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse('Unauthorized', 401);
  }

  const now = new Date().toISOString();

  const { data: duePosts, error } = await supabaseAdmin
    .from('calendar_posts')
    .select('id, user_id, title, scheduled_at')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now)
    .limit(100);

  if (error) {
    console.error('Cron query error:', error);
    return errorResponse('Query failed', 500);
  }

  let sent = 0;
  let skipped = 0;

  for (const post of duePosts || []) {
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('fcm_token, plan')
      .eq('id', post.user_id)
      .maybeSingle();

    // Smart Reminders are a Pro feature — Free users' posts are marked done
    // without a push, so they don't pile up and get re-checked every 15 min.
    if (profile?.fcm_token && profile.plan === 'pro') {
      const result = await sendPush(
        profile.fcm_token,
        'Time to post! 🎯',
        post.title ? `"${post.title}" is scheduled for right now.` : 'Your ShareChat post is scheduled for right now.'
      );
      if (result.success) sent++;
      else skipped++;
    } else {
      skipped++;
    }

    await supabaseAdmin
      .from('calendar_posts')
      .update({ status: 'notified', notified_at: now })
      .eq('id', post.id);
  }

  return json({ checked: duePosts?.length || 0, sent, skipped });
}
