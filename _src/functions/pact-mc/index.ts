// pact-mc — bridge between The Obsidian Pact Minecraft server (PactMenu plugin) and Discord.
// The plugin POSTs JSON with header x-mc-key (pact_site_keys.mc_key). Actions:
//   link_create {uuid, name}   -> {code} (or {already:true}) — player then types /link CODE in Discord (Pact Bot)
//   link_poll                  -> {links:[{code, mc_uuid, mc_name, discord_user_id}]} linked but not rewarded yet
//   link_ack {codes}           -> marks those rewarded
//   status {online, players, max, names} -> keeps one live status message in #server-status up to date
//   event {open}               -> posts "event starting / ended" in the events (or status) channel
//   grant_role {mc_name, role} -> gives an allowed Discord role (Supporter, Media) to the linked Discord user, or queues it until they /link
//   revoke_role {mc_name, role} / ensure_role {role} / channels / invite {channel_id}
import { createClient } from "npm:@supabase/supabase-js@2";

const GUILD_ID = "1570168045928976556";
const API = "https://discord.com/api/v10";
const PURPLE = 0x7c4dff;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const discord = (p: string, init: RequestInit = {}) =>
  fetch(API + p, { ...init, headers: { Authorization: `Bot ${Deno.env.get("DISCORD_BOT_TOKEN")}`, "Content-Type": "application/json" } });

type State = { status_channel_id: string | null; status_message_id: string | null; events_channel_id: string | null; linked_role_id: string | null };

async function state(): Promise<State> {
  const { data } = await db.from("pact_mc_state").select("*").eq("id", 1).single();
  return data as State;
}
const saveState = (patch: Partial<State> & { last_status?: unknown }) =>
  db.from("pact_mc_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", 1);

/** Finds or creates the read-only #server-status channel, and finds an events channel if there is one. */
async function channels(st: State) {
  if (st.status_channel_id) {
    const r = await discord(`/channels/${st.status_channel_id}`);
    if (r.ok) return st;
  }
  const list = await discord(`/guilds/${GUILD_ID}/channels`);
  if (!list.ok) throw new Error(`channels ${list.status} ${await list.text()}`);
  const all: { id: string; name: string; type: number }[] = await list.json();
  let status = all.find((c) => c.type === 0 && /server-?status/i.test(c.name));
  if (!status) {
    const r = await discord(`/guilds/${GUILD_ID}/channels`, {
      method: "POST",
      body: JSON.stringify({
        name: "📡server-status", type: 0,
        topic: "Live status of the Minecraft server. IP: obsidianpact.net",
        permission_overwrites: [{ id: GUILD_ID, type: 0, deny: "2048", allow: "1024" }], // @everyone: view yes, send no
      }),
    });
    if (!r.ok) throw new Error(`create channel ${r.status} ${await r.text()}`);
    status = await r.json();
  }
  const events = all.find((c) => c.type === 0 && /event/i.test(c.name));
  if (st.status_channel_id !== status!.id) st.status_message_id = null;
  st.status_channel_id = status!.id;
  st.events_channel_id = events?.id ?? status!.id;
  await saveState({ status_channel_id: st.status_channel_id, events_channel_id: st.events_channel_id, status_message_id: st.status_message_id });
  return st;
}

function statusEmbed(b: { online: boolean; players?: number; max?: number; names?: string[] }) {
  const now = new Date().toISOString();
  if (!b.online) {
    return {
      title: "🔴 The server is restarting or offline",
      description: "It's usually back within a minute. IP: **obsidianpact.net**",
      color: 0xd04444, timestamp: now, footer: { text: "Last update" },
    };
  }
  const names = (b.names ?? []).slice(0, 25).map((n) => n.replace(/[_*~`|]/g, (c) => "\\" + c));
  return {
    title: "🟢 The Obsidian Pact SMP is online",
    color: PURPLE,
    fields: [
      { name: "Players", value: `**${b.players ?? 0}** / ${b.max ?? 100}`, inline: true },
      { name: "IP", value: "`obsidianpact.net`", inline: true },
      { name: "Version", value: "Java 26.1 – 26.3", inline: true },
      ...(names.length ? [{ name: "Online now", value: names.join(", ").slice(0, 1000) }] : []),
    ],
    description: "Vanilla+ survival with /shop, homes, RTP queue, events and voice chat.",
    footer: { text: "Updates every few minutes • Last update" },
    timestamp: now,
  };
}

async function updateStatus(b: { online: boolean; players?: number; max?: number; names?: string[] }) {
  const st = await channels(await state());
  const body = JSON.stringify({ content: "", embeds: [statusEmbed(b)], allowed_mentions: { parse: [] } });
  if (st.status_message_id) {
    const r = await discord(`/channels/${st.status_channel_id}/messages/${st.status_message_id}`, { method: "PATCH", body });
    if (r.ok) { await saveState({ last_status: b }); return { edited: true }; }
  }
  const r = await discord(`/channels/${st.status_channel_id}/messages`, { method: "POST", body });
  if (!r.ok) throw new Error(`post status ${r.status} ${await r.text()}`);
  const m = await r.json();
  await saveState({ status_message_id: m.id, last_status: b });
  return { posted: true };
}

async function postEvent(open: boolean) {
  const st = await channels(await state());
  const embed = open
    ? { title: "🎉 An event is starting on the server!", description: "Hop on at **obsidianpact.net** and type **/event** to join.", color: PURPLE }
    : { title: "The event has ended", description: "Thanks to everyone who played! Watch this channel for the next one.", color: 0x555566 };
  const r = await discord(`/channels/${st.events_channel_id}/messages`, { method: "POST", body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }) });
  return { ok: r.ok, status: r.status };
}

// Roles the server is allowed to hand out (never staff roles).
const GRANTABLE: Record<string, number> = { Supporter: 0xf5b301, Donator: 0xf5b301, Media: 0xe62117 };

async function ensureRole(name: string): Promise<string | null> {
  const roles = await discord(`/guilds/${GUILD_ID}/roles`).then((r) => r.ok ? r.json() : []);
  const found = roles.find((r: { name: string }) => r.name === name);
  if (found) return found.id;
  const r = await discord(`/guilds/${GUILD_ID}/roles`, { method: "POST", body: JSON.stringify({ name, color: GRANTABLE[name] ?? 0, hoist: true, mentionable: false }) });
  return r.ok ? (await r.json()).id : null;
}

async function grantRole(mcName: string, role: string) {
  if (!(role in GRANTABLE)) return { error: "role not allowed" };
  const { data: link } = await db.from("pact_mc_links").select("discord_user_id").ilike("mc_name", mcName).not("linked_at", "is", null).maybeSingle();
  if (!link) {
    await db.from("pact_mc_pending_roles").insert({ mc_name: mcName, role_name: role });
    return { queued: true };
  }
  const roleId = await ensureRole(role);
  if (!roleId) return { error: "could not create role" };
  const r = await discord(`/guilds/${GUILD_ID}/members/${link.discord_user_id}/roles/${roleId}`, { method: "PUT" });
  return { granted: r.ok, status: r.status };
}

async function revokeRole(mcName: string, role: string) {
  if (!(role in GRANTABLE)) return { error: "role not allowed" };
  await db.from("pact_mc_pending_roles").delete().ilike("mc_name", mcName).eq("role_name", role);
  const { data: link } = await db.from("pact_mc_links").select("discord_user_id").ilike("mc_name", mcName).not("linked_at", "is", null).maybeSingle();
  if (!link) return { removed_pending: true };
  const roles = await discord(`/guilds/${GUILD_ID}/roles`).then((r) => r.ok ? r.json() : []);
  const found = roles.find((r: { name: string }) => r.name === role);
  if (!found) return { none: true };
  const r = await discord(`/guilds/${GUILD_ID}/members/${link.discord_user_id}/roles/${found.id}`, { method: "DELETE" });
  return { revoked: r.ok, status: r.status };
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("pact-mc is running");
  const { data: k } = await db.from("pact_site_keys").select("mc_key").eq("id", 1).single();
  if (!k?.mc_key || req.headers.get("x-mc-key") !== k.mc_key) return json({ error: "forbidden" }, 403);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "link_create": {
        const uuid = String(b.uuid ?? ""), name = String(b.name ?? "");
        if (!/^[0-9a-f-]{32,36}$/i.test(uuid) || !/^\.?[A-Za-z0-9_]{1,16}$/.test(name)) return json({ error: "bad player" }, 400);
        const { data: done } = await db.from("pact_mc_links").select("discord_user_id").eq("mc_uuid", uuid).not("linked_at", "is", null).maybeSingle();
        if (done) return json({ already: true, discord_user_id: done.discord_user_id });
        await db.from("pact_mc_links").delete().eq("mc_uuid", uuid).is("linked_at", null);
        for (let i = 0; i < 5; i++) {
          const code = newCode();
          const { error } = await db.from("pact_mc_links").insert({ code, mc_uuid: uuid, mc_name: name });
          if (!error) return json({ code, minutes: 15 });
        }
        return json({ error: "could not make a code" }, 500);
      }
      case "link_poll": {
        const { data } = await db.from("pact_mc_links").select("code, mc_uuid, mc_name, discord_user_id")
          .not("linked_at", "is", null).is("rewarded_at", null).limit(50);
        return json({ links: data ?? [] });
      }
      case "link_ack": {
        const codes: string[] = Array.isArray(b.codes) ? b.codes.map(String).slice(0, 50) : [];
        if (codes.length) await db.from("pact_mc_links").update({ rewarded_at: new Date().toISOString() }).in("code", codes);
        return json({ ok: true });
      }
      case "status":
        return json(await updateStatus({ online: !!b.online, players: Number(b.players) || 0, max: Number(b.max) || 100, names: Array.isArray(b.names) ? b.names.map(String) : [] }));
      case "event":
        return json(await postEvent(!!b.open));
      case "revoke_role":
        return json(await revokeRole(String(b.mc_name ?? ""), String(b.role ?? "")));
      case "ensure_role":
        return json({ id: (String(b.role ?? "") in GRANTABLE) ? await ensureRole(String(b.role)) : null });
      case "grant_role":
        return json(await grantRole(String(b.mc_name ?? ""), String(b.role ?? "")));
      case "channels": {
        const r = await discord(`/guilds/${GUILD_ID}/channels`);
        const all = await r.json();
        return json(Array.isArray(all) ? all.map((c: { id: string; name: string; type: number; position: number; parent_id: string | null }) => ({ id: c.id, name: c.name, type: c.type, position: c.position, parent: c.parent_id })) : all);
      }
      case "invite": {
        // permanent invite on a TEXT channel (an invite made from a voice channel drops people straight into the call)
        const ch = String(b.channel_id ?? "");
        const r = await discord(`/channels/${ch}/invites`, { method: "POST", body: JSON.stringify({ max_age: 0, max_uses: 0, unique: true }) });
        return json({ status: r.status, invite: await r.json() });
      }
      case "setup": {
        const st = await channels(await state());
        return json(st);
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: String(e) }, 500);
  }
});
