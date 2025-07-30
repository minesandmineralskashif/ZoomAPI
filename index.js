// index.js
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const { getTokens, saveTokens } = require("./supabaseClient");

const app = express();
app.use(express.json());
app.use(cors());

const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI;

// Zoom OAuth URL
app.get("/auth-url", (req, res) => {
  const branch = req.query.branch;
  if (!branch) return res.status(400).json({ error: "Missing 'branch'" });

  const url = `https://zoom.us/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&state=${branch}`;
  res.json({ url });
});
app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Zoom Integration</title>
      </head>
      <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
        <h1>Zoom OAuth Demo</h1>
        
        <div>
          <button onclick="window.location.href='/auth-url?branch=A'">
            Authenticate Zoom (Branch A)
          </button>
        </div>
        
        <br/>

        <div>
          <button onclick="createMeeting()">Create Zoom Meeting (Branch A)</button>
        </div>

        <script>
          async function createMeeting() {
            const res = await fetch('/create-meeting-a', { method: 'POST' });
            const data = await res.json();
            if (data.join_url) {
              window.open(data.join_url, '_blank');
            } else {
              alert("Error creating meeting: " + (data.error || "Unknown error"));
            }
          }
        </script>
      </body>
    </html>
  `);
});
// Callback to exchange code for token
app.get("/zoom/callback", async (req, res) => {
  const { code, state: branch } = req.query;
  if (!code || !branch) return res.status(400).send("Missing code or branch");

  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

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

    console.error("Token exchange failed:", tokenData);
    res.status(500).json(tokenData);
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).send("OAuth token exchange error");
  }
});

// Refresh token if expired
async function refreshTokenIfNeeded(branch) {
  const tokenSet = await getTokens(branch);
  if (!tokenSet) throw new Error(`No token for branch "${branch}"`);

  if (Date.now() < tokenSet.expires_at - 60000) return;

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

  await saveTokens(
    branch,
    data.access_token,
    data.refresh_token,
    Date.now() + data.expires_in * 1000
  );
}
app.post("/create-meeting-a", (req, res) => createMeetingFor("A", res));
app.post("/create-meeting-b", (req, res) => createMeetingFor("B", res));
app.post("/create-meeting-c", (req, res) => createMeetingFor("C", res));

async function createMeetingFor(branch, res) {
  try {
    await refreshTokenIfNeeded(branch);
    const { access_token } = await getTokens(branch);

    const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ topic: `Meeting for ${branch}`, type: 1 }),
    });

    const data = await response.json();
    if (data.join_url) res.json({ join_url: data.join_url });
    else res.status(500).json({ error: "Zoom API failed", details: data });
  } catch (err) {
    console.error(`Meeting error for ${branch}:`, err);
    res.status(500).json({ error: err.message });
  }
}
// So just call the following from each device once:

// GET http://<your-backend>/auth-url?branch=A
// GET http://<your-backend>/auth-url?branch=B
// GET http://<your-backend>/auth-url?branch=C
// Each will redirect to Zoom and save tokens separately.

// Create meeting
// app.post("/create-meeting", async (req, res) => {
//   const { branch } = req.body;
//   if (!branch) return res.status(400).json({ error: "Missing 'branch'" });

//   const tokenSet = await getTokens(branch);
//   if (!tokenSet)
//     return res
//       .status(401)
//       .json({ error: `Branch "${branch}" is not authorized.` });

//   try {
//     await refreshTokenIfNeeded(branch);
//     const { access_token } = await getTokens(branch);

//     const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${access_token}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         topic: `Meeting for ${branch}`,
//         type: 1,
//       }),
//     });

//     const data = await response.json();
//     if (data.join_url) {
//       res.json({ join_url: data.join_url });
//     } else {
//       res.status(500).json({ error: "Zoom API failed", details: data });
//     }
//   } catch (err) {
//     console.error("Create meeting failed:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// Optional: Debug token route (only for dev)
// app.get("/tokens/:branch", async (req, res) => {
//   const branch = req.params.branch;
//   const tokenSet = await getTokens(branch);
//   if (tokenSet) res.json(tokenSet);
//   else res.status(404).json({ error: "No token for this branch" });
// });
app.get("/tokens/:branch", async (req, res) => {
  const branch = req.params.branch;
  const tokenSet = await getTokens(branch);
  if (tokenSet) res.json(tokenSet);
  else res.status(404).json({ error: "No token for this branch" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(
    `🚀 Use this link ot generate Token: https://zoomapi.onrender.com/auth-url?branch=A`
  );
});
