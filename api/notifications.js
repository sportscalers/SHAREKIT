import { handleCors, json, errorResponse } from '../lib/cors.js';
import { getUserFromRequest, getProfile, supabaseAdmin } from '../lib/supabase.js';
import { sendPush } from '../lib/fcm.js';

export default async function handler(request) {
  const cors = handleCors(request);
  if (cors) return cors;
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const user = await getUserFromRequest(request);
  if (!user) return errorResponse('Unauthorized', 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'register';

  if (action === 'register') {
    const { fcmToken } = body;
    if (!fcmToken) return errorResponse('Missing "fcmToken"', 400);
    await supabaseAdmin.from('profiles').update({ fcm_token: fcmToken }).eq('id', user.id);
    return json({ registered: true });
  }

  if (action === 'send') {
    // Smart Reminder Notifications are Pro-only, matching the feature matrix.
    const profile = await getProfile(user.id);
    if ((profile?.plan || 'free') !== 'pro') {
      return errorResponse('Smart Reminders are a Pro feature.', 403);
    }
    if (!profile?.fcm_token) return errorResponse('No notification token registered on this device.', 400);

    const result = await sendPush(
      profile.fcm_token,
      body.title || 'ShareKit Reminder',
      body.body || 'Time to post on ShareChat!'
    );
    if (!result.success) return errorResponse(result.error, 500);
    return json({ sent: true });
  }

  return errorResponse('Unknown action', 400);
}
