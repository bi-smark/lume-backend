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
    console.log("LUME LOG: Firebase Ready.");
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

// ✅ 1. THE REDIRECTOR (Forced for 2026 Security)
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account', 
    scope: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/userinfo.email',
      'openid'
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
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    res.redirect('lume://auth?status=success'); 
  } catch (error) {
    res.redirect('lume://auth?status=error');
  }
});

// ✅ 3. THE PHOTO STREAMER
app.get('/photos', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    if (!doc.exists) return res.status(401).json({ error: "Unauthorized" });

    const refreshToken = doc.data().refresh_token;

    const refresh = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const accessToken = refresh.data.access_token;

    const response = await axios.get('https://photoslibrary.googleapis.com/v1/mediaItems', {
      params: { pageSize: 100 },
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const items = response.data.mediaItems || [];
    const formatted = items.map(item => ({
      id: item.id,
      baseUrl: item.baseUrl,
      creationTime: item.mediaMetadata ? item.mediaMetadata.creationTime : new Date().toISOString(), 
      type: item.mimeType.startsWith('video') ? 'video' : 'photo'
    }));

    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: "Failed to stream", details: error.response?.data || error.message });
  }
});

app.get('/', (req, res) => res.send("LUME Backend Active!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LUME active on ${PORT}`));