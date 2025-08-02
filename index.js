require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { getTokens, saveTokens } = require("./supabaseClient");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(".")); // Serve index.html + assets

const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI;

// 🔐 Get Zoom credentials per branch
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

// 📡 OAuth redirect to Zoom
app.get("/auth-url", (req, res) => {
  const branch = req.query.branch;
  if (!branch) return res.status(400).json({ error: "Missing 'branch'" });

  const { clientId } = getZoomCredentials(branch);
  const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&state=${branch}`;

  res.json({ url: authUrl });
});

// 🔁 OAuth callback from Zoom
app.get("/zoom/callback", async (req, res) => {
  const { code, state: branch } = req.query;
  if (!code || !branch) return res.status(400).send("Missing code or branch");

  const { clientId, clientSecret } = getZoomCredentials(branch);
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(
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

  const tokenData = await response.json();

  if (tokenData.access_token) {
    await saveTokens(
      branch,
      tokenData.access_token,
      tokenData.refresh_token,
      Date.now() + tokenData.expires_in * 1000
    );
    return res.send(
      `<h2>Zoom connected for branch "${branch}"</h2><p>You can close this window.</p>`
    );
  }

  res.status(500).json(tokenData);
});

// 🔄 Refresh token if expired
async function refreshTokenIfNeeded(branch) {
  const tokenSet = await getTokens(branch);
  if (!tokenSet) throw new Error("No tokens found for branch " + branch);

  if (Date.now() < tokenSet.expires_at - 60 * 1000) return;

  const { clientId, clientSecret } = getZoomCredentials(branch);
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${tokenSet.refresh_token}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const json = await res.json();
  if (!json.access_token) throw new Error("Failed to refresh token");

  await saveTokens(
    branch,
    json.access_token,
    json.refresh_token,
    Date.now() + json.expires_in * 1000
  );
}

// 🎯 Create Zoom Meeting
async function createMeetingFor(branch, res, start_time) {
  try {
    await refreshTokenIfNeeded(branch);
    const { access_token } = await getTokens(branch);

    const body = {
      topic: `Meeting for ${branch}`,
      type: start_time ? 2 : 1,
      settings: {
        join_before_host: true,
        host_video: true,
        participant_video: true,
        approval_type: 0,
        waiting_room: false,
      },
    };

    if (start_time) {
      body.start_time = new Date(start_time).toISOString();
      body.duration = 60; // in minutes
    }

    const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (data.join_url) {
      res.json({ join_url: data.join_url });
    } else {
      res.status(500).json({ error: "Zoom API error", details: data });
    }
  } catch (err) {
    console.error(`Meeting error for ${branch}:`, err);
    res.status(500).json({ error: err.message });
  }
}

// 🎬 Meeting creation endpoints
app.post("/create-meeting-a", (req, res) =>
  createMeetingFor("A", res, req.body.start_time)
);
app.post("/create-meeting-b", (req, res) =>
  createMeetingFor("B", res, req.body.start_time)
);

// ✅ Test route
app.get("/tokens/:branch", async (req, res) => {
  const branch = req.params.branch;
  const tokenSet = await getTokens(branch);
  if (tokenSet) res.json(tokenSet);
  else res.status(404).json({ error: "No token for this branch" });
});

// 🚀 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ Server running: http://localhost:${PORT}/`)
);
