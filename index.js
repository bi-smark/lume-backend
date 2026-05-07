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
 */
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Gets the refresh token
    prompt: 'consent',     // Forces a new refresh token
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
    
    // We only get the refresh_token on the first "Consent" screen
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
 * ✅ 3. THE PHOTO & VIDEO STREAMER
 * Fetches media and includes the creationTime for your Flutter date sorter.
 */
app.get('/photos', async (req, res) => {
  console.log("LUME LOG: Incoming request for /photos...");
  
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    if (!doc.exists) {
      console.warn("LUME LOG: Request failed - No token in DB.");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const refreshToken = doc.data().refresh_token;
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // Automatically refreshes the access token if expired
    const accessTokenResponse = await oauth2Client.getAccessToken();
    const token = accessTokenResponse.token;

    const response = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
      params: { pageSize: 100 },
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const items = response.data.mediaItems || [];

    // Format for Flutter CloudSorter.groupByDate
    const formattedMedia = items.map(item => ({
      id: item.id,
      baseUrl: item.baseUrl,
      mimeType: item.mimeType,
      creationTime: item.mediaMetadata ? item.mediaMetadata.creationTime : new Date().toISOString(), 
      type: item.mimeType.startsWith('video') ? 'video' : 'photo'
    }));

    console.log(`✅ SUCCESS: Streaming ${formattedMedia.length} items.`);
    res.json(formattedMedia);

  } catch (error) {
    console.error("LUME LOG: Fetch Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to stream media" });
  }
});

/**
 * ✅ 4. THE STATUS CHECK (App Startup)
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
 * ✅ 5. DISCONNECT (Optional)
 * Useful for testing or if you want to switch accounts
 */
app.post('/auth/disconnect', async (req, res) => {
  try {
    await db.collection('settings').doc('google_auth').delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => res.send("LUME Backend is Active and Running!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`LUME Server active on port ${PORT}`);
});