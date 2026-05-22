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
    console.log("LUME LOG: Firebase Ready.");
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
 * ✅ 1. STATUS CHECK
 * Checks if a valid refresh token exists in the database.
 */
app.get('/auth/status', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    const isLinked = doc.exists && !!doc.data().refresh_token;
    res.json({ isLinked: isLinked });
  } catch (error) {
    res.status(500).json({ isLinked: false });
  }
});

/**
 * ✅ 2. OAUTH REDIRECT
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
 * ✅ 3. OAUTH CALLBACK
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
 * ✅ 4. THE PICKER SESSION (Configured Exclusively for Album Selection)
 */
app.get('/picker-session', async (req, res) => {
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

    // Strict 2026 Photos Picker Schema payload configuration
    const sessionRes = await axios.post('https://photospicker.googleapis.com/v1/sessions', {
      "albumSelectionConfig": {
        "maxSelections": 50
      }
    }, {
      headers: { 
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const pickerUri = sessionRes.data.pickerUri;
    
    await db.collection('settings').doc('google_auth').update({
      current_picker_uri: pickerUri,
      current_session_id: sessionRes.data.id,
      session_created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ pickerUri: pickerUri });
  } catch (error) {
    console.error("PICKER ERROR:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to generate picker link", details: error.response?.data || error.message });
  }
});

/**
 * ✅ 5. THE PHOTO STREAMER
 */
app.get('/photos', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('google_auth').get();
    const data = doc.data();
    
    if (!data || !data.current_session_id) {
      return res.status(400).json({ error: "No active session." });
    }

    const refresh = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: data.refresh_token,
      grant_type: 'refresh_token'
    });

    const response = await axios.get('https://photospicker.googleapis.com/v1/mediaItems', {
      params: { sessionId: data.current_session_id },
      headers: { 'Authorization': `Bearer ${refresh.data.access_token}` }
    });

    const items = response.data.mediaItems || [];
    res.json(items.map(item => ({
      id: item.id,
      baseUrl: item.mediaFileUri,
      mimeType: item.mimeType,
      creationTime: item.mediaMetadata?.creationTime || new Date().toISOString(),
      type: item.mimeType?.startsWith('video') ? 'video' : 'photo'
    })));
  } catch (error) {
    res.status(400).json({ error: "PENDING_ACTION", details: error.response?.data || error.message });
  }
});

app.get('/', (req, res) => res.send("LUME Active!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));