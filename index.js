// index.js
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const path = require("path");
const { getTokens, saveTokens } = require("./supabaseClient");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // serve html, css, logo, etc.

const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI;

// Zoom credentials per branch
function getZoomCredentials(branch) {
  if (branch === "B") {
    return {
      clientId: process.env.ZOOM2_CLIENT_ID,
      clientSecret: process.env.ZOOM2_CLIENT_SECRET,
    };
  }
  return {
    clientId: process.env.ZOOM_CLIENT_ID,
    clientSecret: process.env.ZOOM_CLIENT_SECRET,
  };
}

// Serve main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve scheduler page
app.get("/schedule.html", (req, res) => {
  res.sendFile(path.join(__dirname, "schedule.html"));
});

// Redirect to Zoom for OAuth
app.get("/zoom/auth/:branch", (req, res) => {
  const branch = req.params.branch.toUpperCase();
  const { clientId } = getZoomCredentials(branch);
  const state = branch;
  const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&state=${state}`;
  res.redirect(authUrl);
});

// OAuth callback
app.get("/zoom/callback", async (req, res) => {
  const { code, state: branch } = req.query;
  if (!code || !branch) return res.status(400).send("Missing code or branch");

  const { clientId, clientSecret } = getZoomCredentials(branch);
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  try {
    const tokenResponse = await fetch(
      `https://zoom.us/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(
        REDIRECT_URI
      )}`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token)
      return res.status(500).send("Token exchange failed");

    await saveTokens(
      branch,
      tokenData.access_token,
      tokenData.refresh_token,
      Date.now() + tokenData.expires_in * 1000
    );
    res.send(
      `<h3>Zoom Connected for Branch ${branch}</h3><p>You can close this window.</p>`
    );
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).send("OAuth token exchange error");
  }
});

// Refresh tokens
async function refreshTokenIfNeeded(branch) {
  const tokenSet = await getTokens(branch);
  if (!tokenSet) throw new Error(`No token for branch ${branch}`);

  if (Date.now() < tokenSet.expires_at - 60000) return;

  const { clientId, clientSecret } = getZoomCredentials(branch);
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

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

  await saveTokens(
    branch,
    data.access_token,
    data.refresh_token,
    Date.now() + data.expires_in * 1000
  );
}

// Create instant meeting
app.post("/create-meeting-a", async (req, res) => {
  await createMeeting("A", req, res);
});
app.post("/create-meeting-b", async (req, res) => {
  await createMeeting("B", req, res);
});

// Shared logic for meetings (instant or scheduled)
async function createMeeting(branch, req, res) {
  const { start_time, topic } = req.body || {};
  try {
    await refreshTokenIfNeeded(branch);
    const { access_token } = await getTokens(branch);

    const payload = {
      topic: topic || `Meeting for ${branch}`,
      type: start_time ? 2 : 1,
      settings: { join_before_host: true },
    };
    if (start_time) {
      payload.start_time = new Date(start_time).toISOString();
      payload.duration = 60;
    }

    const apiRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await apiRes.json();
    if (data.join_url) return res.json({ join_url: data.join_url });
    return res.status(500).json({ error: "Zoom API failed", details: data });
  } catch (err) {
    console.error(`Error meeting (${branch}):`, err);
    res.status(500).json({ error: err.message });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server live on port ${PORT}`));
