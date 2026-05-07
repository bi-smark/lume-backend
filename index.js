const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin'); // ✅ Firebase Admin SDK
const app = express();

app.use(express.json());

/**
 * ✅ FIREBASE INITIALIZATION
 * Uses the Service Account JSON stored in your Render Environment Variables
 */
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("LUME LOG: Firebase Admin initialized successfully.");
  } catch (error) {
    console.error("LUME LOG: Firebase Init Error:", error.message);
  }
} else {
  console.error("LUME LOG: FIREBASE_SERVICE_ACCOUNT environment variable is missing!");
}

const db = admin.firestore();

/**
 * ✅ GOOGLE OAUTH CONFIG
 */
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * ✅ 1. THE REDIRECTOR (Start Auth)
 */
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'profile',
      'email'
    ],
  });
  console.log("LUME LOG: Redirecting to Google Consent screen...");
  res.redirect(authUrl);
});

/**
 * ✅ 2. THE CALLBACK (Capture & Save)
 */
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('lume://auth?status=error');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    
    // ✅ SAVE TO FIRESTORE: This is what makes it "Seamless"
    if (tokens.refresh_token) {
      await db.collection('settings').doc('google_auth').set({
        refresh_token: tokens.refresh_token,
        admin_email: "mutindabismark23@gmail.com",
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }); // Merge ensures we don't overwrite other fields
      
      console.log("✅ SUCCESS: Refresh Token saved to Firestore.");
    }

    res.redirect('lume://auth?status=success'); 
  } catch (error) {
    console.error("LUME LOG: Auth Error:", error.message);
    res.redirect('lume://auth?status=error');
  }
});

/**
 * ✅ 3. THE STATUS CHECK (For Flutter App Startup)
 * Your Flutter app calls this to see if it should show the "Login" button or not.
 */
app.get('/auth/status', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    if (doc.exists && doc.data().refresh_token) {
      return res.json({ isLinked: true });
    }
    res.json({ isLinked: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => res.send("LUME Backend is Active and Running!"));

const PORT = process.env.PORT || 10000; // Render uses 10000 by default
app.listen(PORT, () => {
  console.log(`LUME Server active on port ${PORT}`);
});