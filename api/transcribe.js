import { handleCors, json, errorResponse } from '../lib/cors.js';
import { getUserFromRequest, getProfile, checkMonthlyLimit, incrementMonthlyUsage,
         saveGeneration } from '../lib/supabase.js';
import { transcribeAudio } from '../lib/openrouter.js';

export default async function handler(request) {
  const cors = handleCors(request);
  if (cors) return cors;
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const user = await getUserFromRequest(request);
  if (!user) return errorResponse('Unauthorized', 401);

  const profile = await getProfile(user.id);
  if ((profile?.plan || 'free') !== 'pro') {
    return errorResponse('Speech-to-text is a Pro feature. Upgrade to Pro to unlock it.', 403);
  }

  const gate = await checkMonthlyLimit(user.id, 'speech_to_text');
  if (!gate.allowed) {
    return errorResponse(`Monthly transcription limit reached (${gate.limit}). Resets next month.`, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { audioBase64, format } = body;
  if (!audioBase64) return errorResponse('Missing "audioBase64"', 400);

  try {
    const text = await transcribeAudio(audioBase64, format || 'wav');
    await incrementMonthlyUsage(user.id, 'speech_to_text');
    await saveGeneration(user.id, 'speech-to-text', { format }, { text });
    return json({ text });
  } catch (err) {
    console.error('Transcription error:', err);
    return errorResponse('Transcription failed. Please try again.', 500);
  }
}
