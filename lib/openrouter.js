const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://sharekit.in',
    'X-Title': process.env.OPENROUTER_SITE_NAME || 'ShareKit',
    ...extra,
  };
}

// Models used across ShareKit (all billed through the one OpenRouter key)
export const MODELS = {
  GEMINI_FLASH: 'google/gemini-2.5-flash',
  WHISPER_TURBO: 'openai/whisper-large-v3-turbo',
  FLUX_KLEIN: 'black-forest-labs/flux.2-klein-4b',
  OWL_ALPHA: 'openrouter/owl-alpha',
};

// Generic chat completion — used for text generation AND multimodal
// (image_url / video_url content parts) analysis with Gemini 2.5 Flash.
export async function chatCompletion(model, messages, opts = {}) {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 1024,
      ...(opts.responseFormat ? { response_format: opts.responseFormat } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter chat error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// Speech-to-text via the dedicated OpenRouter transcription endpoint.
// audioBase64 must NOT include the "data:audio/...;base64," prefix.
export async function transcribeAudio(audioBase64, format = 'wav') {
  const res = await fetch(`${OPENROUTER_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: MODELS.WHISPER_TURBO,
      input_audio: { data: audioBase64, format },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter transcription error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  return data.text ?? data.transcript ?? '';
}

// Image generation via OpenRouter's unified Images API.
export async function generateImage(prompt, opts = {}) {
  const res = await fetch(`${OPENROUTER_BASE}/images`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: MODELS.FLUX_KLEIN,
      prompt,
      resolution: opts.resolution || '1K',
      aspect_ratio: opts.aspectRatio || '1:1',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter image generation error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  // Response shape can vary slightly; normalize to a single image URL/base64.
  const img = data.data?.[0] || data.images?.[0] || {};
  return {
    url: img.url || null,
    b64: img.b64_json || img.b64 || null,
    raw: data,
  };
}

// Builds a Gemini multimodal message: instruction text + an image or video.
// mediaBase64 must NOT include the "data:...;base64," prefix.
export function buildMediaMessage(instruction, mediaBase64, mimeType, kind) {
  const dataUrl = `data:${mimeType};base64,${mediaBase64}`;
  const mediaPart =
    kind === 'video'
      ? { type: 'video_url', video_url: { url: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } };

  return [
    {
      role: 'user',
      content: [mediaPart, { type: 'text', text: instruction }],
    },
  ];
}
