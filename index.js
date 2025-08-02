// index.js
import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
);

const zoomApps = {
  A: {
    client_id: process.env.ZOOM_CLIENT_ID,
    client_secret: process.env.ZOOM_CLIENT_SECRET,
    redirect_uri: process.env.ZOOM_REDIRECT_URI,
    token_table: "tokens_branch_a",
  },
  B: {
    client_id: process.env.ZOOM2_CLIENT_ID,
    client_secret: process.env.ZOOM2_CLIENT_SECRET,
    redirect_uri: process.env.ZOOM_REDIRECT_URI,
    token_table: "tokens_branch_b",
  },
};

function getZoomApp(branch) {
  return zoomApps[branch];
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/schedule", (req, res) => {
  res.sendFile(path.join(__dirname, "schedule.html"));
});

app.get("/zoom/auth/:branch", (req, res) => {
  const { branch } = req.params;
  const { client_id, redirect_uri } = getZoomApp(branch);
  const authUrl = `https://zoom.us/oauth/authorize?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}`;
  res.redirect(authUrl);
});

app.get("/zoom/callback", async (req, res) => {
  const { code } = req.query;
  const branch = req.query.state || "A"; // fallback to A
  const { client_id, client_secret, redirect_uri, token_table } =
    getZoomApp(branch);

  const tokenRes = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${client_id}:${client_secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri,
    }),
  });

  const tokens = await tokenRes.json();
  await supabase.from(token_table).delete().neq("id", 0); // clear table
  await supabase.from(token_table).insert(tokens);
  res.send("Zoom Auth Successful. You may close this tab.");
});

async function getTokens(branch) {
  const { token_table } = getZoomApp(branch);
  const { data } = await supabase.from(token_table).select("*").single();
  return data;
}

async function refreshTokenIfNeeded(branch) {
  const tokens = await getTokens(branch);
  const { client_id, client_secret, redirect_uri, token_table } =
    getZoomApp(branch);

  if (!tokens)
    throw new Error("Tokens not found. Please authenticate Zoom first.");

  const newTokenRes = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(`${client_id}:${client_secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  const newTokens = await newTokenRes.json();
  await supabase.from(token_table).delete().neq("id", 0);
  await supabase.from(token_table).insert(newTokens);
  return newTokens;
}

app.post("/create-meeting", async (req, res) => {
  const { branch } = req.body;

  try {
    await refreshTokenIfNeeded(branch);
    const { access_token } = await getTokens(branch);

    const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: `Instant Meeting for Branch ${branch}`,
        type: 1,
      }),
    });

    const data = await zoomRes.json();
    res.json({ join_url: data.join_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/schedule-meeting", async (req, res) => {
  const { branch, datetime } = req.body;
  if (!branch || !datetime)
    return res.status(400).json({ error: "Missing branch or datetime" });

  try {
    await refreshTokenIfNeeded(branch);
    const { access_token } = await getTokens(branch);

    const zoomRes = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        topic: `Scheduled Meeting for Branch ${branch}`,
        type: 2,
        start_time: new Date(datetime).toISOString(),
        settings: {
          join_before_host: true,
        },
      }),
    });

    const data = await zoomRes.json();
    res.json({ join_url: data.join_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
