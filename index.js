const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();

app.use(express.json());

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log("LUME LOG: Firebase Admin Ready.");
  } catch (error) {
    console.error("LUME LOG: Firebase Init Error:", error.message);
  }
}

const db = admin.firestore();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// ✅ 1. THE REDIRECTOR
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
  res.redirect(authUrl);
});

// ✅ 2. THE CALLBACK
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (tokens.refresh_token) {
      await db.collection('settings').doc('google_auth').set({
        refresh_token: tokens.refresh_token,
        admin_email: "mutindabismark23@gmail.com",
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    res.redirect('lume://auth?status=success'); 
  } catch (error) {
    res.redirect('lume://auth?status=error');
  }
});

// ✅ 3. THE PHOTO STREAMER (Back to Library API with Fix)
app.get('/photos', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    if (!doc.exists) return res.status(401).json({ error: "Unauthorized" });

    const refreshToken = doc.data().refresh_token;

    // Refresh Token
    const refresh = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const accessToken = refresh.data.access_token;

    // Call the Library API (list all items)
    const response = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
      params: { pageSize: 100 },
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const items = response.data.mediaItems || [];
    const formattedMedia = items.map(item => ({
      id: item.id,
      baseUrl: item.baseUrl,
      mimeType: item.mimeType,
      creationTime: item.mediaMetadata ? item.mediaMetadata.creationTime : new Date().toISOString(), 
      type: item.mimeType.startsWith('video') ? 'video' : 'photo'
    }));

    res.json(formattedMedia);
  } catch (error) {
    console.error("LUME Error:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to stream media", details: error.response?.data });
  }
});

app.get('/auth/status', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    res.json({ isLinked: doc.exists && !!doc.data().refresh_token });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/', (req, res) => res.send("LUME Backend Ready!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LUME active on ${PORT}`));