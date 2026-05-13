const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();

app.use(express.json());

/**
 * ✅ FIREBASE INITIALIZATION
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
 * Strictly using the 2026 Picker Scopes to ensure production access.
 */
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', 
    prompt: 'consent',     
    scope: [
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
      'openid',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email'
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
    
    if (tokens.refresh_token) {
      await db.collection('settings').doc('google_auth').set({
        refresh_token: tokens.refresh_token,
        admin_email: "mutindabismark23@gmail.com",
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      
      console.log("✅ SUCCESS: Refresh Token saved to Firestore.");
    }

    res.redirect('lume://auth?status=success'); 
  } catch (error) {
    console.error("LUME LOG: Auth Error:", error.message);
    res.redirect('lume://auth?status=error');
  }
});

/**
 * ✅ 3. THE PHOTO & VIDEO STREAMER (2026 Picker API Only)
 */
app.get('/photos', async (req, res) => {
  console.log("LUME LOG: Incoming request for /photos...");
  
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    if (!doc.exists) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const refreshToken = doc.data().refresh_token;

    // 1. Refresh Access Token
    const responseRefresh = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const accessToken = responseRefresh.data.access_token;

    // 2. Fetch using modern Picker API Endpoint
    const photosResponse = await axios.get('https://photospicker.googleapis.com/v1/mediaItems', {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    const items = photosResponse.data.mediaItems || [];

    // 3. Map items for Flutter UI
    const formattedMedia = items.map(item => ({
      id: item.id,
      baseUrl: item.mediaFileUri, // Modern endpoint uses mediaFileUri
      mimeType: item.mimeType,
      creationTime: item.mediaMetadata ? item.mediaMetadata.creationTime : new Date().toISOString(), 
      type: item.mimeType?.startsWith('video') ? 'video' : 'photo'
    }));

    console.log(`✅ SUCCESS: Streaming ${formattedMedia.length} items.`);
    res.json(formattedMedia);

  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("LUME LOG Error details:", JSON.stringify(errorData));
    
    res.status(500).json({ 
      error: "Failed to stream media",
      details: errorData 
    });
  }
});

/**
 * ✅ 4. THE STATUS CHECK
 */
app.get('/auth/status', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    const isLinked = doc.exists && !!doc.data().refresh_token;
    res.json({ isLinked: isLinked });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * ✅ 5. DISCONNECT
 */
app.post('/auth/disconnect', async (req, res) => {
  try {
    await db.collection('settings').doc('google_auth').delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => res.send("LUME Backend is Active!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`LUME Server active on port ${PORT}`);
});