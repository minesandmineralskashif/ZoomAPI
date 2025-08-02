require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const { getTokens, saveTokens } = require("./supabaseClient");

const app = express();
app.use(express.json());
app.use(express.static("."));

async function refreshTokenIfNeeded(branch) {
  const tokens = await getTokens(branch);
  if (!tokens) throw new Error("No tokens found for branch " + branch);

  const { refresh_token, expires_at } = tokens;
  const now = Math.floor(Date.now() / 1000);

  if (expires_at - 60 > now) return; // not expired

  const basicAuth = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
    }),
  });

  const json = await res.json();
  if (!json.access_token) throw new Error("Failed to refresh token");

  const newExpiresAt = Math.floor(Date.now() / 1000) + json.expires_in;
  await saveTokens(branch, json.access_token, json.refresh_token, newExpiresAt);
}

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
      body.duration = 60;
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
    if (data.join_url) res.json({ join_url: data.join_url });
    else res.status(500).json({ error: "Zoom API error", details: data });
  } catch (err) {
    console.error(`Meeting error for ${branch}:`, err);
    res.status(500).json({ error: err.message });
  }
}

app.post("/create-meeting-a", (req, res) =>
  createMeetingFor("A", res, req.body.start_time)
);
app.post("/create-meeting-b", (req, res) =>
  createMeetingFor("B", res, req.body.start_time)
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
