const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getTokens(branch) {
  const { data, error } = await supabase
    .from("tokens")
    .select("*")
    .eq("branch", branch)
    .single();

  if (error) {
    console.error("Supabase getTokens error:", error);
    return null;
  }
  return data;
}

async function saveTokens(branch, access_token, refresh_token, expires_at) {
  const { error } = await supabase.from("tokens").upsert({
    branch,
    access_token,
    refresh_token,
    expires_at,
  });

  if (error) {
    console.error("Supabase saveTokens error:", error);
  }
}

module.exports = {
  supabase,
  getTokens,
  saveTokens,
};
