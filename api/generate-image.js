import { handleCors, json, errorResponse } from '../lib/cors.js';
import { getUserFromRequest, getProfile, checkMonthlyLimit, incrementMonthlyUsage,
         saveGeneration } from '../lib/supabase.js';
import { generateImage } from '../lib/openrouter.js';

export default async function handler(request) {
  const cors = handleCors(request);
  if (cors) return cors;
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const user = await getUserFromRequest(request);
  if (!user) return errorResponse('Unauthorized', 401);

  const profile = await getProfile(user.id);
  if ((profile?.plan || 'free') !== 'pro') {
    return errorResponse('AI image generation is a Pro feature. Upgrade to Pro to unlock it.', 403);
  }

  const gate = await checkMonthlyLimit(user.id, 'image_generation');
  if (!gate.allowed) {
    return errorResponse(`Monthly image generation limit reached (${gate.limit}). Resets next month.`, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { prompt, aspectRatio, resolution } = body;
  if (!prompt) return errorResponse('Missing "prompt"', 400);

  try {
    const image = await generateImage(prompt, { aspectRatio, resolution });
    await incrementMonthlyUsage(user.id, 'image_generation');
    await saveGeneration(user.id, 'image-generation', { prompt, aspectRatio, resolution }, { url: image.url });
    return json({ url: image.url, b64: image.b64 });
  } catch (err) {
    console.error('Image generation error:', err);
    return errorResponse('Image generation failed. Please try again.', 500);
  }
}
