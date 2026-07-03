import { handleCors, json } from '../lib/cors.js';

// These are all values that are SAFE to expose in a browser by design:
// Supabase anon key (protected by Row Level Security), Razorpay key_id
// (public half of the key pair), and Firebase Web config (protected by
// Firebase Security Rules + domain restrictions). No secrets live here.
export default async function handler(request) {
  const cors = handleCors(request);
  if (cors) return cors;

  return json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
    firebase: {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      projectId: process.env.FIREBASE_PROJECT_ID,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
    },
  });
}
