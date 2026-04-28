const express = require('express');
const { google } = require('googleapis');
const app = express();

// This allows your server to read JSON data sent from your Flutter app
app.use(express.json());

/**
 * These variables are pulled from Render's "Environment Variables" 
 * to keep your project secure.
 */
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "postmessage"; // 'postmessage' is required for Flutter/Mobile flow

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

/**
 * THE TRAP ROUTE: 
 * Your Flutter app (LUME) will send the 'serverAuthCode' here.
 */
app.post('/auth/google/callback', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).send("No authorization code provided.");
  }

  try {
    // Exchange the one-time code for permanent tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    /**
     * TO-DO for your MKU Project:
     * In a real deployment, you would save tokens.refresh_token to 
     * Firestore here so you can access photos even when the user is offline.
     */
    console.log("SUCCESS: Captured Tokens:", tokens);

    res.status(200).json({
      message: "LUME Bridge connected successfully!",
      details: "Check your Render logs to see the captured tokens."
    });
  } catch (error) {
    console.error("Authentication Error:", error.message);
    res.status(500).send("Failed to exchange code for tokens.");
  }
});

// Root route to check if your server is alive
app.get('/', (req, res) => {
  res.send("LUME Backend is Running!");
});

// Use the port Render gives you, or 3000 locally
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`LUME Server active on port ${PORT}`);
});