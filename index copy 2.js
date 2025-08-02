// index.js
require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");
const { getTokens, saveTokens } = require("./supabaseClient");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname)); // Serves static files like style.css

const REDIRECT_URI = process.env.ZOOM_REDIRECT_URI;

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

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Zoom Integration</title>
        
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <img src="/logo.jpg" alt="Zoom Integration Logo" class="logo" />

        <h1>Zoom Meeting Mines and Minerals</h1>
        
        <div>
          <button onclick="window.location.href='/auth-url?branch=A'">
            Authenticate Zoom (Branch A MITDGMM )
          </button>
        </div>
        
        <div>
          <button onclick="window.location.href='/auth-url?branch=B'">
            Authenticate Zoom (Branch B IT Branch)
          </button>
        </div>

        <br/>

        <div>
          <button onclick="createMeeting('A')">Create Meeting (Branch A MITDGMM)</button>
        </div>

        <div>
          <button onclick="createMeeting('B')">Create Meeting (Branch B IT Branch )</button>
        </div>

        <br/>

        <div id="whatsapp-share" style="display: none;">
          <p>Meeting link copied to clipboard ✅</p>
          <a id="whatsapp-link" href="#" target="_blank">
            <button style="background-color: green; color: white; padding: 10px 20px; border: none; cursor: pointer;">
              Share on WhatsApp
            </button>
          </a>
        </div>

        <script>
          async function createMeeting(branch) {
            try {
              const res = await fetch('/create-meeting-' + branch.toLowerCase(), { method: 'POST' });
              const data = await res.json();

              if (data.join_url) {
                window.open(data.join_url, '_blank');
                await navigator.clipboard.writeText(data.join_url);
                const waLink = "https://wa.me/?text=" + encodeURIComponent("Join my Zoom meeting: " + data.join_url);
                document.getElementById("whatsapp-link").href = waLink;
                document.getElementById("whatsapp-share").style.display = "block";
              } else {
                alert("Error: " + (data.error || "Unknown"));
              }
            } catch (err) {
              console.error(err);
              alert("Failed to create meeting");
            }
          }
        </script>
      </body>
    </html>
  `);
});

app.get("/auth-url", (req, res) => {
  const branch = req.query.branch;
  if (!branch) return res.status(400).json({ error: "Missing 'branch'" });

  const { clientId } = getZoomCredentials(branch);

  const url = `https://zoom.us/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&state=${branch}`;
  res.json({ url });
});

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

    if (tokenData.access_token) {
      await saveTokens(
        branch,
        tokenData.access_token,
        tokenData.refresh_token,
        Date.now() + tokenData.expires_in * 1000
      );
      return res.send(`<h2>Zoom connected for branch "${branch}"</h2><p>You can close this window.</p>`);
    }

    console.error("Token exchange failed:", tokenData);
    res.status(500).json(tokenData);
  } catch (err) {
    console.error("Callback error:", err);
    res.status(500).send("OAuth token exchange error");
  }
});

async function refreshTokenIfNeeded(branch) {
  const tokenSet = await getTokens(branch);
  if (!tokenSet) throw new Error(`No token for branch "${branch}"`);

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

app.post("/create-meeting-a", (req, res) => createMeetingFor("A", res));
app.post("/create-meeting-b", (req, res) => createMeetingFor("B", res));

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

app.get("/tokens/:branch", async (req, res) => {
  const branch = req.params.branch;
  const tokenSet = await getTokens(branch);
  if (tokenSet) res.json(tokenSet);
  else res.status(404).json({ error: "No token for this branch" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Visit http://localhost:${PORT}/ to authenticate Zoom accounts and create meetings`);
});
