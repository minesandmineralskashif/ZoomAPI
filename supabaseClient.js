// supabaseClient.js
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Secure key
);

// Fetch tokens for a given branch
async function getTokens(branch) {
  const { data, error } = await supabase
    .from("tokens")
    .select("*")
    .eq("branch", branch)
    .single();

  if (error) return null;
  return data;
}

// Insert or update tokens
async function saveTokens(branch, access_token, refresh_token, expires_at) {
  await supabase.from("tokens").upsert({
    branch,
    access_token,
    refresh_token,
    expires_at,
  });
}

module.exports = {
  supabase,
  getTokens,
  saveTokens,
};
