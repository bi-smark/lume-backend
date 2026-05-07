const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const axios = require('axios'); // ✅ Added for easier API calls
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
 * ✅ 3. THE PHOTO & VIDEO STREAMER (The Missing Door)
 * This route fetches media and includes the creationTime for your date sorter.
 */
app.get('/photos', async (req, res) => {
  console.log("LUME LOG: Fetching media items...");
  
  try {
    // 1. Retrieve the refresh token from Firestore
    const doc = await db.collection('settings').doc('google_auth').get();
    if (!doc.exists) return res.status(401).json({ error: "Unauthorized" });

    const refreshToken = doc.data().refresh_token;
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    // 2. Get a fresh Access Token
    const accessTokenResponse = await oauth2Client.getAccessToken();
    const token = accessTokenResponse.token;

    // 3. Call Google Photos API via REST (includes photos and videos by default)
    const response = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
      params: { pageSize: 100 },
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const items = response.data.mediaItems || [];

    // 4. Map data to include timestamp and type for Flutter
    const formattedMedia = items.map(item => ({
      id: item.id,
      baseUrl: item.baseUrl,
      mimeType: item.mimeType,
      // creationTime is critical for your CloudSorter.groupByDate logic
      creationTime: item.mediaMetadata.creationTime, 
      type: item.mimeType.startsWith('video') ? 'video' : 'photo'
    }));

    console.log(`✅ SUCCESS: Streaming ${formattedMedia.length} items to LUME.`);
    res.json(formattedMedia);

  } catch (error) {
    console.error("LUME LOG: Fetch Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to stream media" });
  }
});

/**
 * ✅ 4. THE STATUS CHECK
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`LUME Server active on port ${PORT}`);
});