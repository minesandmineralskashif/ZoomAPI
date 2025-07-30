const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const Database = require('better-sqlite3');
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI;

const db = new Database('tokens.db');
db.prepare(`
  CREATE TABLE IF NOT EXISTS tokens (
    branch TEXT PRIMARY KEY,
    access_token TEXT,
    refresh_token TEXT,
    expires_at INTEGER
  )
`).run();

// Helper to get tokens from DB by branch
function getTokens(branch) {
  return db.prepare("SELECT * FROM tokens WHERE branch = ?").get(branch);
}

// Helper to save tokens to DB
function saveTokens(branch, access_token, refresh_token, expires_at) {
  db.prepare(`
    INSERT INTO tokens (branch, access_token, refresh_token, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(branch) DO UPDATE SET
      access_token=excluded.access_token,
      refresh_token=excluded.refresh_token,
      expires_at=excluded.expires_at
  `).run(branch, access_token, refresh_token, expires_at);
}

// Generate Zoom OAuth URL for a branch
app.get("/auth-url", (req, res) => {
  const branch = req.query.branch;
  if (!branch) return res.status(400).json({ error: "Missing 'branch' parameter" });

  const url = `https://zoom.us/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&state=${branch}`;

  res.json({ url });
});

// OAuth callback to get tokens and save in DB
app.get("/zoom/callback", async (req, res) => {
  const { code, state: branch } = req.query;
  if (!code || !branch) return res.status(400).send("Missing code or branch");

  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  try {
    const tokenResponse = await fetch(
      `https://zoom.us/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const tokenData = await tokenResponse.json();

    if (tokenData.access_token) {
      saveTokens(branch, tokenData.access_token, tokenData.refresh_token, Date.now() + tokenData.expires_in * 1000);

      console.log(`🔐 Tokens stored for branch "${branch}"`);
      return res.send(`<h2>Zoom connected for branch "${branch}"</h2><p>You can close this window.</p>`);
    }

    console.error("❌ Token exchange failed:", tokenData);
    res.status(500).json(tokenData);
  } catch (err) {
    console.error("❌ Error in callback:", err);
    res.status(500).send("OAuth token exchange error");
  }
});

// Refresh tokens if expired
async function refreshTokenIfNeeded(branch) {
  const tokenSet = getTokens(branch);
  if (!tokenSet) throw new Error(`No tokens found for branch "${branch}"`);

  if (Date.now() < tokenSet.expires_at - 60000) return; // Token still valid

  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${tokenSet.refresh_token}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const data = await response.json();

  if (!data.access_token) throw new Error("Failed to refresh token");

  saveTokens(branch, data.access_token, data.refresh_token, Date.now() + data.expires_in * 1000);

  console.log(`🔄 Token refreshed for branch "${branch}"`);
}

// Create Zoom meeting
app.post("/create-meeting", async (req, res) => {
  const { branch } = req.body;
  if (!branch) return res.status(400).json({ error: "Missing 'branch' in request body" });

  const tokenSet = getTokens(branch);
  if (!tokenSet) return res.status(401).json({ error: `Branch "${branch}" is not authorized yet.` });

  try {
    await refreshTokenIfNeeded(branch);

    const refreshedTokenSet = getTokens(branch);

    const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${refreshedTokenSet.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: `Meeting for ${branch}`,
        type: 1, // Instant meeting
      }),
    });

    const data = await response.json();

    if (data.join_url) {
      res.json({ join_url: data.join_url });
    } else {
      res.status(500).json({ error: "Zoom API error", details: data });
    }
  } catch (err) {
    console.error("❌ Meeting creation failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// Debug route to view tokens for a branch (only for dev!)
app.get("/tokens/:branch", (req, res) => {
  const branch = req.params.branch;
  const tokenSet = getTokens(branch);
  if (tokenSet) {
    res.json(tokenSet);
  } else {
    res.status(404).json({ error: "No tokens for this branch" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Zoom backend running on http://localhost:${PORT} , use  http://localhost:3000/auth-url?branch=branchA for token`);
  console.log(`🔗 Set your Zoom redirect URI to: ${REDIRECT_URI}`);
});
