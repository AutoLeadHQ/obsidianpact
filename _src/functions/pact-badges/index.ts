// pact-badges — public, read-only: which members have special Discord roles (Media, Supporter, Server Booster).
// The members page on obsidianpact.net shows these as badges next to each member's rank.
// Roles come from pact_discord_members, which pact-sync refreshes from Discord every 10 minutes,
// so giving someone a role in Discord puts the badge on the website automatically.
import { createClient } from "npm:@supabase/supabase-js@2";

const BADGES = ["Media", "Supporter", "Server Booster"];
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=120",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...headers, "Access-Control-Allow-Methods": "GET" } });
  const [igns, dm] = await Promise.all([
    db.from("pact_igns").select("discord_user_id, ign"),
    db.from("pact_discord_members").select("discord_user_id, roles, left_at"),
  ]);
  const roles = new Map((dm.data ?? []).filter((m) => !m.left_at).map((m) => [m.discord_user_id, (m.roles ?? []) as string[]]));
  const out: Record<string, string[]> = {};
  for (const m of igns.data ?? []) {
    const r = roles.get(m.discord_user_id);
    if (!r) continue;
    const b = BADGES.filter((x) => r.includes(x));
    if (b.length) out[m.ign.toLowerCase()] = b;
  }
  return new Response(JSON.stringify({ badges: out }), { headers });
});
