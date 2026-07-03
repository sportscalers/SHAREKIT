import { handleCors, json, errorResponse } from '../lib/cors.js';
import { getUserFromRequest, getProfile, checkDailyLimit, incrementDailyUsage,
         checkMonthlyLimit, incrementMonthlyUsage, saveGeneration } from '../lib/supabase.js';
import { chatCompletion, buildMediaMessage, MODELS } from '../lib/openrouter.js';

// Actions that only cost a few hundred tokens of text — gated by the free
// daily limit only. Media actions are gated by the Pro monthly budget too.
const TEXT_ACTIONS = new Set(['caption', 'hashtags', 'keywords', 'viral-title', 'content-score']);
const MEDIA_ACTIONS = new Set(['image-analysis', 'video-analysis', 'ocr']);

function buildPrompt(action, { topic, contentType, tone, language }) {
  const lang = language && language !== 'English' ? ` Write the output in ${language}.` : '';
  switch (action) {
    case 'caption':
      return `You are a social media expert for Indian creators on ShareChat. Write 3 short, engaging captions (under 280 characters each) about: "${topic}". Content type: ${contentType || 'general'}. Tone: ${tone || 'positive'}.${lang} Respond ONLY as JSON: {"captions": ["...", "...", "..."]}`;
    case 'hashtags':
      return `Generate 15 relevant hashtags for a ShareChat post about: "${topic}". Content type: ${contentType || 'general'}. Mix broad and niche tags.${lang} Respond ONLY as JSON: {"hashtags": ["#...", "..."]}`;
    case 'keywords':
      return `Generate 12 SEO keywords/phrases to help a ShareChat post about "${topic}" get discovered. Content type: ${contentType || 'general'}.${lang} Respond ONLY as JSON: {"keywords": ["...", "..."]}`;
    case 'viral-title':
      return `Generate 5 viral, curiosity-driven titles for short-form content about: "${topic}". Content type: ${contentType || 'general'}.${lang} Respond ONLY as JSON: {"titles": ["...", "..."]}`;
    case 'content-score':
      return `Act as a ShareChat content strategist. Score this content idea from 0-100 on viral potential and give feedback: "${topic}".${lang} Respond ONLY as JSON: {"score": 0, "strengths": ["...", "..."], "improvements": ["...", "..."]}`;
    default:
      throw new Error('Unknown action');
  }
}

function buildMediaPrompt(action) {
  switch (action) {
    case 'image-analysis':
      return 'Analyze this image for a ShareChat creator. Respond ONLY as JSON: {"description": "...", "objects": ["...", "..."], "suggestedCaption": "...", "suggestedTags": ["...", "..."]}';
    case 'video-analysis':
      return 'Analyze this video for a ShareChat creator. Respond ONLY as JSON: {"summary": "...", "keyMoments": ["...", "..."], "suggestedCaption": "...", "suggestedTags": ["...", "..."]}';
    case 'ocr':
      return 'Extract all visible text from this image exactly as written. Respond ONLY as JSON: {"text": "the extracted text, or empty string if none found"}';
    default:
      throw new Error('Unknown action');
  }
}

function safeParseJson(text) {
  try {
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
    return JSON.parse(cleaned);
  } catch {
    return { raw: text };
  }
}

export default async function handler(request) {
  const cors = handleCors(request);
  if (cors) return cors;
  if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

  const user = await getUserFromRequest(request);
  if (!user) return errorResponse('Unauthorized', 401);

  const profile = await getProfile(user.id);
  const plan = profile?.plan || 'free';

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { action, topic, contentType, tone, language, mediaBase64, mimeType } = body;
  if (!action) return errorResponse('Missing "action"', 400);

  // Free plan: English only, output-language locked server-side too
  // (not just in the UI) so the restriction can't be bypassed.
  const effectiveLanguage = plan === 'free' ? 'English' : (language || 'English');

  try {
    if (TEXT_ACTIONS.has(action)) {
      const gate = await checkDailyLimit(user.id, plan);
      if (!gate.allowed) {
        return errorResponse(`Daily limit reached (${gate.limit}/day on Free). Upgrade to Pro for unlimited access.`, 429);
      }
      if (!topic) return errorResponse('Missing "topic"', 400);

      const prompt = buildPrompt(action, { topic, contentType, tone, language: effectiveLanguage });
      const raw = await chatCompletion(MODELS.GEMINI_FLASH, [{ role: 'user', content: prompt }], {
        responseFormat: { type: 'json_object' },
      });
      const result = safeParseJson(raw);

      if (plan === 'free') await incrementDailyUsage(user.id);
      await saveGeneration(user.id, action, { topic, contentType, tone, language: effectiveLanguage }, result);

      return json({ result });
    }

    if (MEDIA_ACTIONS.has(action)) {
      if (plan !== 'pro') {
        return errorResponse('Media analysis is a Pro feature. Upgrade to Pro to unlock it.', 403);
      }
      if (!mediaBase64 || !mimeType) return errorResponse('Missing "mediaBase64" or "mimeType"', 400);

      const metric = action === 'video-analysis' ? 'video_analysis' : 'image_analysis';
      const gate = await checkMonthlyLimit(user.id, metric);
      if (!gate.allowed) {
        return errorResponse(`Monthly ${metric.replace('_', ' ')} limit reached (${gate.limit}). Resets next month.`, 429);
      }

      const kind = action === 'video-analysis' ? 'video' : 'image';
      const messages = buildMediaMessage(buildMediaPrompt(action), mediaBase64, mimeType, kind);
      const raw = await chatCompletion(MODELS.GEMINI_FLASH, messages, {
        responseFormat: { type: 'json_object' },
        maxTokens: 1500,
      });
      const result = safeParseJson(raw);

      await incrementMonthlyUsage(user.id, metric);
      await saveGeneration(user.id, action, { mimeType }, result);

      return json({ result });
    }

    return errorResponse(`Unknown action "${action}"`, 400);
  } catch (err) {
    console.error('AI handler error:', err);
    return errorResponse('AI generation failed. Please try again.', 500);
  }
}
