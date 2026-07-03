import admin from 'firebase-admin';

// Lazily initialize so this file can be imported without crashing
// in environments where Firebase env vars aren't set yet.
function getApp() {
  if (admin.apps.length) return admin.app();

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel env vars store \n as literal backslash-n — convert back to real newlines.
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

export async function sendPush(token, title, body, data = {}) {
  const app = getApp();
  try {
    await admin.messaging(app).send({
      token,
      notification: { title, body },
      data,
      webpush: {
        fcmOptions: { link: 'https://sharekit.in/' },
      },
    });
    return { success: true };
  } catch (err) {
    // Token expired/invalid — caller should remove it from the DB.
    return { success: false, error: err.message, code: err.code };
  }
}
