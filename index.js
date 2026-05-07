const express = require('express');
const { google } = require('googleapis');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

/**
 * ✅ Environment Variables
 * Pulling these from Render's "Environment" tab.
 */
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// ✅ This must be EXACTLY: https://lume-backend-zalz.onrender.com/auth/google/callback
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI; 

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

/**
 * ✅ 1. THE REDIRECTOR
 * This route starts the handshake. It takes the user to the Google Consent Screen.
 */
app.get('/auth/google', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // ✅ CRITICAL: Gets the permanent Refresh Token for Admin Sync
    prompt: 'consent',      // ✅ CRITICAL: Forces Google to provide a new Refresh Token
    scope: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'profile',
      'email'
    ],
  });
  
  console.log("LUME LOG: Initiating OAuth flow. Redirecting to Google...");
  res.redirect(authUrl);
});

/**
 * ✅ 2. THE CALLBACK (The Bridge)
 * Handles the redirect back from Google. 
 * Swaps the 'code' for tokens and snaps back to the app.
 */
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code) {
    console.error("LUME LOG: No code returned from Google.");
    return res.redirect('lume://auth?status=error');
  }

  try {
    // Exchange the temporary code for permanent tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    /**
     * ✅ MKU PROJECT TASK:
     * Save 'tokens.refresh_token' to your database (e.g., Firestore).
     * This is the key to your "invisible" photo streaming.
     */
    if (tokens.refresh_token) {
      console.log("✅ SUCCESS: Admin Refresh Token Captured:", tokens.refresh_token);
    } else {
      console.warn("⚠️ WARNING: No Refresh Token received. Try revoking app access and signing in again.");
    }

    // ✅ DEEP LINK: Uses app_links to snap the user back to the LUME Cloud Tab
    res.redirect('lume://auth?status=success'); 

  } catch (error) {
    console.error("LUME LOG: Token exchange failed:", error.message);
    res.redirect('lume://auth?status=error');
  }
});

// Root route to verify the server is live
app.get('/', (req, res) => {
  res.send("LUME Backend is Active and Running!");
});

// Use the dynamic port provided by Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LUME Server active on port ${PORT}`);
});