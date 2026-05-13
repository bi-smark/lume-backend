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
    console.log("LUME LOG: Firebase Admin initialized.");
  } catch (error) {
    console.error("LUME LOG: Firebase Error:", error.message);
  }
}

const db = admin.firestore();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

/**
 * ✅ 1. OAUTH REDIRECT
 */
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
      'openid', 'profile', 'email'
    ],
  });
  res.redirect(authUrl);
});

/**
 * ✅ 2. OAUTH CALLBACK
 */
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

/**
 * ✅ 3. THE PICKER LINK GENERATOR (Manual Trigger)
 */
app.get('/picker-session', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    if (!doc.exists) return res.status(401).json({ error: "Auth doc not found. Run /auth/google first." });

    const refreshToken = doc.data().refresh_token;

    const refresh = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });

    const accessToken = refresh.data.access_token;

    const sessionRes = await axios.post('https://photospicker.googleapis.com/v1/sessions', {}, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    await db.collection('settings').doc('google_auth').update({
      current_session_id: sessionRes.data.id
    });

    res.json({ 
      pickerUri: sessionRes.data.pickerUri, 
      sessionId: sessionRes.data.id 
    });
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message });
  }
});

/**
 * ✅ 4. THE PHOTO STREAMER (With Auto-Session Recovery)
 */
app.get('/photos', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    if (!doc.exists) return res.status(401).json({ error: "Unauthorized" });

    let data = doc.data();
    let sessionId = data.current_session_id;

    // Refresh Token
    const refresh = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token'
    });
    const accessToken = refresh.data.access_token;

    // IF SESSION IS MISSING, CREATE ONE ON THE FLY
    if (!sessionId) {
      const sessionRes = await axios.post('https://photospicker.googleapis.com/v1/sessions', {}, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      sessionId = sessionRes.data.id;
      await db.collection('settings').doc('google_auth').update({ current_session_id: sessionId });
    }

    // Fetch Items
    const photosResponse = await axios.get('https://photospicker.googleapis.com/v1/mediaItems', {
      params: { sessionId: sessionId },
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
    // If the session expired, clear it in DB so the next hit creates a new one
    if (error.response?.status === 400) {
      await db.collection('settings').doc('google_auth').update({ current_session_id: null });
    }
    res.status(500).json({ error: "Stream Failed", details: error.response?.data || error.message });
  }
});

app.get('/', (req, res) => res.send("LUME Picker Backend Active!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`LUME active on ${PORT}`));