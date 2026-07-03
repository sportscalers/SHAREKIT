import { handleCors, json, errorResponse } from '../lib/cors.js';
import { getUserFromRequest, getProfile, checkMonthlyLimit, incrementMonthlyUsage,
         saveGeneration } from '../lib/supabase.js';
import { chatCompletion, MODELS } from '../lib/openrouter.js';

// Scope is intentionally narrow: growth coaching, content strategy, and app
// support only. It must NOT generate captions/hashtags/keywords itself —
// those live in the dedicated tools — and must not explain internal feature
// mechanics. This keeps usage predictable and on-topic.
const SYSTEM_PROMPT = `You are ShareKit's AI Support Assistant for ShareChat creators.
Your role is strictly limited to:
1. Growth coaching (posting frequency, engagement habits, audience building)
2. Content strategy advice (what kinds of content tend to perform well, general trends)
3. General app support (how to use ShareKit, account/billing questions)

You must NOT:
- Write or generate actual captions, hashtags, keywords, titles, or any finished content
  (if asked, redirect the person to the Caption Generator / Keywords & Hashtags tool in the app)
- Explain internal implementation details of how ShareKit's features work technically

Keep answers concise, encouraging, and specific to ShareChat and Indian creator audiences.`;

export default async function handler(request) {
  const cors = handleCors(request);
  if (cors) return cors;
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const user = await getUserFromRequest(request);
  if (!user) return errorResponse('Unauthorized', 401);

  const profile = await getProfile(user.id);
  if ((profile?.plan || 'free') !== 'pro') {
    return errorResponse('AI Support Assistant is a Pro feature. Upgrade to Pro to unlock it.', 403);
  }

  const gate = await checkMonthlyLimit(user.id, 'chat_messages');
  if (!gate.allowed) {
    return errorResponse(`Monthly chat message limit reached (${gate.limit}). Resets next month.`, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { message, history } = body;
  if (!message) return errorResponse('Missing "message"', 400);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: 'user', content: message },
  ];

  try {
    const reply = await chatCompletion(MODELS.OWL_ALPHA, messages, { temperature: 0.6, maxTokens: 500 });
    await incrementMonthlyUsage(user.id, 'chat_messages');
    await saveGeneration(user.id, 'assistant', { message }, { reply });
    return json({ reply });
  } catch (err) {
    console.error('Assistant error:', err);
    return errorResponse('Assistant is temporarily unavailable. Please try again.', 500);
  }
}
