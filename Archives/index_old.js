const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI;

const TOKEN_FILE = "./tokens.json";

// Load tokens from file or initialize empty
let tokens = {};
if (fs.existsSync(TOKEN_FILE)) {
  try {
    tokens = JSON.parse(fs.readFileSync(TOKEN_FILE));
    console.log("🔐 Loaded tokens from file");
  } catch (e) {
    console.error("❌ Failed to parse token file:", e);
  }
}

// Save tokens to file helper
function saveTokens() {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

/**
 * GET /auth-url?branch=branchA
 * Generates Zoom OAuth URL for the specified branch
 */
app.get("/auth-url", (req, res) => {
  const branch = req.query.branch;
  if (!branch) return res.status(400).json({ error: "Missing 'branch' parameter" });

  const url = `https://zoom.us/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&state=${branch}`;

  res.json({ url });
});

/**
 * GET /zoom/callback
 * OAuth redirect endpoint: exchanges code for tokens and saves them per branch
 */
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
      tokens[branch] = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: Date.now() + tokenData.expires_in * 1000,
      };
      saveTokens();

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

/**
 * Refresh token if expired or near expiry
 */
async function refreshTokenIfNeeded(branch) {
  const tokenSet = tokens[branch];
  if (!tokenSet) throw new Error(`No tokens found for branch "${branch}"`);

  if (Date.now() < tokenSet.expires_at - 60000) return; // Token still valid (1 minute buffer)

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

  tokens[branch] = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens();

  console.log(`🔄 Token refreshed for branch "${branch}"`);
}

/**
 * POST /create-meeting
 * Create Zoom meeting for given branch using saved token
 */
app.post("/create-meeting", async (req, res) => {
  const { branch } = req.body;
  if (!branch) return res.status(400).json({ error: "Missing 'branch' in request body" });
  if (!tokens[branch]) return res.status(401).json({ error: `Branch "${branch}" is not authorized yet.` });

  try {
    await refreshTokenIfNeeded(branch);

    const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens[branch].access_token}`,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Zoom backend running on http://localhost:${PORT}`);
  console.log(`🔗 Make sure Zoom redirect URI is set to: ${REDIRECT_URI}`);
});





// const express = require("express");
// const fetch = require("node-fetch");
// const cors = require("cors");
// require("dotenv").config();

// const app = express();
// app.use(express.json());
// app.use(cors());

// const CLIENT_ID = process.env.ZOOM_CLIENT_ID;
// const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;
// const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI;

// // In-memory store: tokens[branch] = { access_token, refresh_token, expires_at }
// const tokens = {};

// /**
//  * GET /auth-url?branch=branchA
//  * Generates a Zoom OAuth URL for a specific branch
//  */
// app.get("/auth-url", (req, res) => {
//   const branch = req.query.branch;
//   if (!branch) return res.status(400).json({ error: "Missing 'branch' parameter" });

//   const url = `https://zoom.us/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
//     REDIRECT_URI
//   )}&state=${branch}`;

//   res.json({ url });
// });

// /**
//  * GET /zoom/callback
//  * Handles OAuth redirect from Zoom and stores tokens for a branch
//  */
// app.get("/zoom/callback", async (req, res) => {
//   const { code, state: branch } = req.query;
//   if (!code || !branch) return res.status(400).send("Missing code or branch");

//   const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

//   try {
//     const tokenResponse = await fetch(
//       `https://zoom.us/oauth/token?grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
//       {
//         method: "POST",
//         headers: {
//           Authorization: `Basic ${creds}`,
//           "Content-Type": "application/x-www-form-urlencoded",
//         },
//       }
//     );

//     const tokenData = await tokenResponse.json();

//     if (tokenData.access_token) {
//       tokens[branch] = {
//         access_token: tokenData.access_token,
//         refresh_token: tokenData.refresh_token,
//         expires_at: Date.now() + tokenData.expires_in * 1000,
//       };

//       console.log(`🔐 Tokens stored for branch "${branch}"`);
//       return res.send(`<h2>Zoom connected for branch "${branch}"</h2><p>You can close this window.</p>`);
//     }

//     console.error("❌ Token exchange failed:", tokenData);
//     res.status(500).json(tokenData);
//   } catch (err) {
//     console.error("❌ Error in callback:", err);
//     res.status(500).send("OAuth token exchange error");
//   }
// });

// /**
//  * Utility to refresh token if expired
//  */
// async function refreshTokenIfNeeded(branch) {
//   const tokenSet = tokens[branch];
//   if (!tokenSet) throw new Error(`No tokens found for branch "${branch}"`);

//   if (Date.now() < tokenSet.expires_at - 60000) return; // Token still valid

//   const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

//   const response = await fetch(
//     `https://zoom.us/oauth/token?grant_type=refresh_token&refresh_token=${tokenSet.refresh_token}`,
//     {
//       method: "POST",
//       headers: {
//         Authorization: `Basic ${creds}`,
//         "Content-Type": "application/x-www-form-urlencoded",
//       },
//     }
//   );

//   const data = await response.json();

//   if (!data.access_token) throw new Error("Failed to refresh token");

//   tokens[branch] = {
//     access_token: data.access_token,
//     refresh_token: data.refresh_token,
//     expires_at: Date.now() + data.expires_in * 1000,
//   };

//   console.log(`🔄 Token refreshed for branch "${branch}"`);
// }

// /**
//  * POST /create-meeting
//  * Body: { branch: "branchA" }
//  * Creates a Zoom meeting for the given branch
//  */
// app.post("/create-meeting", async (req, res) => {
//   const { branch } = req.body;
//   if (!branch) return res.status(400).json({ error: "Missing 'branch' in request body" });
//   if (!tokens[branch]) return res.status(401).json({ error: `Branch "${branch}" is not authorized yet.` });

//   try {
//     await refreshTokenIfNeeded(branch);

//     const response = await fetch("https://api.zoom.us/v2/users/me/meetings", {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${tokens[branch].access_token}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         topic: `Meeting for ${branch}`,
//         type: 1, // Instant meeting
//       }),
//     });

//     const data = await response.json();

//     if (data.join_url) {
//       res.json({ join_url: data.join_url });
//     } else {
//       res.status(500).json({ error: "Zoom API error", details: data });
//     }
//   } catch (err) {
//     console.error("❌ Meeting creation failed:", err);
//     res.status(500).json({ error: err.message });
//   }
// });

// // Start server
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   console.log(`🚀 Zoom backend running on http://localhost:${PORT}`);
//   console.log(`🔗 Set your Zoom redirect URI to: ${REDIRECT_URI}`);
// });
