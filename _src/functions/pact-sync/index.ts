// pact-sync — runs every 10 minutes (pg_cron). Copies The Obsidian Pact's Discord members
// (name, avatar, roles, join date) into Supabase for the website roster and the owner's
// "who joined" dashboard, and snapshots the member/online counts once an hour.
import { createClient } from "npm:@supabase/supabase-js@2";

const GUILD_ID = "1570168045928976556";
const INVITE = "c9HDNeTX4z";
const API = "https://discord.com/api/v10";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const discord = (p: string) => fetch(API + p, { headers: { Authorization: `Bot ${Deno.env.get("DISCORD_BOT_TOKEN")}` } });

type Member = { user: { id: string; username: string; global_name?: string; avatar?: string; bot?: boolean }; nick?: string; roles: string[]; joined_at: string; avatar?: string };

Deno.serve(async (req) => {
  const { data: k } = await db.from("pact_site_keys").select("sync_key").eq("id", 1).single();
  if (!k || req.headers.get("x-sync-key") !== k.sync_key) return new Response("forbidden", { status: 403 });

  const g = await discord(`/guilds/${GUILD_ID}/roles`);
  if (!g.ok) return new Response(`roles ${g.status}`, { status: 502 });
  const roleName = new Map<string, string>((await g.json()).map((r: { id: string; name: string }) => [r.id, r.name]));

  // Full member list (needs the Server Members Intent). Falls back to just the people who set an IGN.
  let members: Member[] = [];
  let full = true;
  let status = 200;
  let after = "0";
  for (let i = 0; i < 20; i++) {
    const r = await discord(`/guilds/${GUILD_ID}/members?limit=1000&after=${after}`);
    if (!r.ok) { full = false; status = r.status; break; }
    const page: Member[] = await r.json();
    members.push(...page);
    if (page.length < 1000) break;
    after = page.at(-1)!.user.id;
  }
  if (!full) {
    members = [];
    const { data: igns } = await db.from("pact_igns").select("discord_user_id");
    for (const { discord_user_id } of igns ?? []) {
      const r = await discord(`/guilds/${GUILD_ID}/members/${discord_user_id}`);
      if (r.ok) members.push(await r.json());
      else if (r.status === 404) await db.from("pact_discord_members").update({ left_at: new Date().toISOString() }).eq("discord_user_id", discord_user_id).is("left_at", null);
    }
  }

  const now = new Date().toISOString();
  if (members.length) {
    await db.from("pact_discord_members").upsert(members.map((m) => ({
      discord_user_id: m.user.id,
      username: m.user.username,
      global_name: m.user.global_name ?? null,
      nick: m.nick ?? null,
      avatar: m.user.avatar ?? null,
      roles: m.roles.map((id) => roleName.get(id) ?? id),
      is_bot: !!m.user.bot,
      joined_at: m.joined_at,
      last_seen: now,
      left_at: null,
    })), { onConflict: "discord_user_id" });
  }
  if (full) { // anyone not in the list anymore has left
    await db.from("pact_discord_members").update({ left_at: now }).lt("last_seen", now).is("left_at", null);
  }

  const inv = await fetch(`${API}/invites/${INVITE}?with_counts=true`).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (inv) {
    const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
    await db.from("pact_discord_counts").upsert({ hour: hour.toISOString(), members: inv.approximate_member_count, online: inv.approximate_presence_count });
  }
  return new Response(JSON.stringify({ full, listStatus: status, members: members.length }), { headers: { "Content-Type": "application/json" } });
});
