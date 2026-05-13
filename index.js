const express = require('express');
const { google } = require('googleapis');
const admin = require('firebase-admin');
const axios = require('axios');
const app = express();

app.use(express.json());

// Firebase Initialization
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (e) { console.error("LUME LOG: Firebase Init Error"); }
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
    prompt: 'consent select_account',
    scope: [
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
      'openid', 'profile', 'email'
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
  } catch (e) { res.redirect('lume://auth?status=error'); }
});

// ✅ 3. THE FINAL STREAMER (Fixed Session UUID Error)
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

    // STEP A: Create the Picker Session
    const sessionRes = await axios.post('https://photospicker.googleapis.com/v1/sessions', {}, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const sessionId = sessionRes.data.id; // Get the UUID

    // STEP B: Use the Session ID to fetch items
    // If no items are picked yet, this will return an empty list [], which is better than a 400 error
    const photosResponse = await axios.get('https://photospicker.googleapis.com/v1/mediaItems', {
      params: { sessionId: sessionId }, // Pass the valid UUID
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const items = photosResponse.data.mediaItems || [];
    const formatted = items.map(item => ({
      id: item.id,
      baseUrl: item.mediaFileUri,
      mimeType: item.mimeType,
      creationTime: item.mediaMetadata?.creationTime || new Date().toISOString(), 
      type: item.mimeType?.startsWith('video') ? 'video' : 'photo'
    }));

    res.json(formatted);
  } catch (error) {
    const errorData = error.response ? error.response.data : error.message;
    console.error("LUME LOG Error:", JSON.stringify(errorData));
    res.status(500).json({ error: "Stream Failed", details: errorData });
  }
});

app.get('/', (req, res) => res.send("LUME Backend Ready!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LUME active on ${PORT}`));