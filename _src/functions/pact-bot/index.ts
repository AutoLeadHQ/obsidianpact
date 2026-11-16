// Pact Bot — The Obsidian Pact's Discord bot (HTTP interactions, no always-on server).
// - "Set your IGN" button / /ign or /about opens one pop-up: Minecraft name, About me, skin name
// - IGN saves right away; it becomes their nickname only if they haven't picked their own (/nick is theirs to use)
// - About me and skin name wait for the owner's approval (admin page) before they show on obsidianpact.net;
//   links and @everyone are refused outright
// - /ign-lookup lets the owner check anyone's IGN
// - /link CODE connects a Minecraft account (code comes from /link in game); the server pays the reward
// - #submit-clips: read-only channel with a "Submit a clip" button; the pop-up form sends the clip to #mod-log
//   for Max to review (saved in pact_clip_submissions). /clips-panel posts the button anywhere; GET ?clips_panel=1&key=… posts it in #submit-clips
import nacl from "npm:tweetnacl@1.0.3";
import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const PUBLIC_KEY = "2882fb8c2e3d3a8f46b0cbeeaec8cc88128d0344fa7e30b4fd4a6c8619c8044f";
const APP_ID = "1570205930426081400";
const GUILD_ID = "1570168045928976556";
const API = "https://discord.com/api/v10";
const PURPLE = 0x7c4dff;
const SITE = "https://obsidianpact.net/members/";
const MODLOG_CHANNEL_ID = "1570569897564708894";
const ANNOUNCE_CHANNEL_ID = "1570678978535096341"; // #bot-commands
const CLIPS_CHANNEL_ID = "1571760953085796364"; // #submit-clips (read-only for members)
const CLIP_URL_RE = /^https?:\/\/\S+$/i;
const LINK_RE = /(https?:\/\/|www\.|discord\.gg|discord(app)?\.com\/invite|\b[a-z0-9-]+\.(com|net|org|gg|xyz|io|me|ly|co|tv|app|link|site|shop|ru)\b|@everyone|@here)/i;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const hexToBytes = (h: string) => Uint8Array.from(h.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ephemeral = (content: string) => json({ type: 4, data: { content, flags: 64 } });

function discord(path: string, init: RequestInit = {}) {
  const token = Deno.env.get("DISCORD_BOT_TOKEN");
  return fetch(API + path, {
    ...init,
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  });
}

const COMMANDS = [
  { name: "ign", description: "Set or change your Minecraft IGN", type: 1 },
  { name: "about", description: "Write the About me shown on the clan website", type: 1 },
  {
    name: "link",
    description: "Link your Minecraft account (get the code with /link in game)",
    type: 1,
    options: [{ type: 3, name: "code", description: "The code from /link in game (leave empty to get a box to paste it in)", required: false }],
  },
  {
    name: "link-panel",
    description: "Post the Link your Minecraft account button in this channel",
    type: 1,
    default_member_permissions: "32",
  },
  {
    name: "clips-panel",
    description: "Post the Submit a clip button in this channel",
    type: 1,
    default_member_permissions: "32",
  },
  {
    name: "ign-panel",
    description: "Post the Set your IGN button in this channel",
    type: 1,
    default_member_permissions: "32", // Manage Server only
  },
  {
    name: "ign-lookup",
    description: "Look up a member's Minecraft IGN",
    type: 1,
    default_member_permissions: "32",
    options: [{ type: 6, name: "user", description: "The member", required: true }],
  },
];

async function registerCommands() {
  const r = await discord(`/applications/${APP_ID}/guilds/${GUILD_ID}/commands`, {
    method: "PUT",
    body: JSON.stringify(COMMANDS),
  });
  return { status: r.status, body: await r.text() };
}

// One pop-up: IGN (required), About me and skin name (optional), pre-filled with what they already sent.
async function profileModal(userId: string) {
  const { data: row } = await db.from("pact_igns").select("ign, about, skin, about_pending, skin_pending, pending_at").eq("discord_user_id", userId).maybeSingle();
  const data = row && { ign: row.ign, about: row.pending_at ? row.about_pending : row.about, skin: row.pending_at ? row.skin_pending : row.skin };
  return {
    type: 9,
    data: {
      custom_id: "ign_modal",
      title: "Your Obsidian Pact profile",
      components: [
        {
          type: 1,
          components: [{
            type: 4, custom_id: "ign", label: "Your exact in-game name", style: 1,
            min_length: 3, max_length: 17, required: true,
            placeholder: "Type it exactly like it shows in Minecraft",
            ...(data?.ign ? { value: data.ign } : {}),
          }],
        },
        {
          type: 1,
          components: [{
            type: 4, custom_id: "about", label: "About me (shows on the clan website)", style: 2,
            max_length: 300, required: false,
            placeholder: "What you're into: PvP, building, farms, map art… Leave empty to skip.",
            ...(data?.about ? { value: data.about } : {}),
          }],
        },
        {
          type: 1,
          components: [{
            type: 4, custom_id: "skin", label: "Skin name (only if you use /skin)", style: 1,
            min_length: 3, max_length: 16, required: false,
            placeholder: "The player name you copied your skin from",
            ...(data?.skin ? { value: data.skin } : {}),
          }],
        },
      ],
    },
  };
}

const PANEL = {
  embeds: [{
    title: "Set your IGN",
    description:
      "Click the button and type your exact Minecraft name.\n" +
      "It becomes your nickname here, so everyone knows who you are in-game.\n" +
      `Add an About me too and you'll show up on the members page: ${SITE}`,
    color: PURPLE,
  }],
  components: [{
    type: 1,
    components: [{ type: 2, style: 1, label: "Set your IGN", custom_id: "set_ign" }],
  }],
};

// IGN is saved right away. A changed About me / skin goes into the approval queue.
async function saveProfile(userId: string, username: string, ign: string, about: string, skin: string, nick: string | null) {
  const { data: cur } = await db.from("pact_igns").select("ign, about, skin").eq("discord_user_id", userId).maybeSingle();
  const changed = (about || null) !== (cur?.about ?? null) || (skin || null) !== (cur?.skin ?? null);
  await db.from("pact_igns").upsert({
    discord_user_id: userId,
    discord_username: username,
    ign,
    about_pending: changed ? about || null : null,
    skin_pending: changed ? skin || null : null,
    pending_at: changed ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  });
  if (changed) {
    await discord(`/channels/${MODLOG_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: `📝 **${ign}** updated their website profile. Approve or reject it on your admin page, Members tab.`,
        allowed_mentions: { parse: [] },
      }),
    });
  }
  // Only use the IGN as their nickname if they have no nickname yet (or it was just their old IGN).
  if (!nick || nick === cur?.ign) {
    await discord(`/guilds/${GUILD_ID}/members/${userId}`, { method: "PATCH", body: JSON.stringify({ nick: ign }) });
  }
}

// /link CODE: connect the Minecraft account that made the code to this Discord user, give the Linked role.
async function linkAccount(userId: string, username: string, rawCode: string) {
  // accept "ABC123", "/link ABC123", "link abc123", with spaces etc.
  const code = rawCode.toUpperCase().replace(/^\s*\/?\s*LINK\s*/, "").replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (code.length !== 6) return "Paste the 6-character code from **/link** in game (it looks like `AB12CD`).";
  const { data: mine } = await db.from("pact_mc_links").select("mc_name").eq("discord_user_id", userId).not("linked_at", "is", null).maybeSingle();
  if (mine) return `You're already linked to **${mine.mc_name}**. One Minecraft account per Discord account.`;
  const { data: row } = await db.from("pact_mc_links").select("code, mc_uuid, mc_name, created_at, linked_at").eq("code", code).maybeSingle();
  if (!row) return "That code doesn't exist. Type **/link** in game on obsidianpact.net to get a fresh one.";
  if (row.linked_at) return "That code was already used.";
  if (Date.now() - new Date(row.created_at).getTime() > 15 * 60 * 1000) return "That code expired (they last 15 minutes). Type **/link** in game again for a new one.";
  const { error } = await db.from("pact_mc_links").update({ discord_user_id: userId, linked_at: new Date().toISOString() }).eq("code", code).is("linked_at", null);
  if (error) { console.error("link update", JSON.stringify(error)); return "That Minecraft account is already linked to someone."; }
  EdgeRuntime.waitUntil((async () => {
    // Linked role (made once), and save their IGN for the website if they don't have one yet.
    const { data: st } = await db.from("pact_mc_state").select("linked_role_id").eq("id", 1).single();
    let roleId = st?.linked_role_id as string | null;
    if (!roleId) {
      const roles = await discord(`/guilds/${GUILD_ID}/roles`).then((r) => r.ok ? r.json() : []);
      roleId = roles.find((r: { name: string }) => r.name === "Linked")?.id ?? null;
      if (!roleId) {
        const r = await discord(`/guilds/${GUILD_ID}/roles`, { method: "POST", body: JSON.stringify({ name: "Linked", color: 0x55ff99, hoist: false, mentionable: false }) });
        if (r.ok) roleId = (await r.json()).id;
      }
      if (roleId) await db.from("pact_mc_state").update({ linked_role_id: roleId }).eq("id", 1);
    }
    if (roleId) await discord(`/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, { method: "PUT" });
    // Roles they earned in game before linking (e.g. Donator)
    const { data: pending } = await db.from("pact_mc_pending_roles").select("id, role_name").ilike("mc_name", row.mc_name).is("applied_at", null);
    if (pending?.length) {
      const roles = await discord(`/guilds/${GUILD_ID}/roles`).then((r) => r.ok ? r.json() : []);
      for (const pr of pending) {
        let rid = roles.find((r: { name: string }) => r.name === pr.role_name)?.id;
        if (!rid) {
          const r = await discord(`/guilds/${GUILD_ID}/roles`, { method: "POST", body: JSON.stringify({ name: pr.role_name, color: pr.role_name === "Donator" ? 0xf5b301 : 0, hoist: true }) });
          if (r.ok) rid = (await r.json()).id;
        }
        if (rid) {
          await discord(`/guilds/${GUILD_ID}/members/${userId}/roles/${rid}`, { method: "PUT" });
          await db.from("pact_mc_pending_roles").update({ applied_at: new Date().toISOString() }).eq("id", pr.id);
        }
      }
    }
    const { data: ign } = await db.from("pact_igns").select("ign").eq("discord_user_id", userId).maybeSingle();
    if (!ign) await db.from("pact_igns").upsert({ discord_user_id: userId, discord_username: username, ign: row.mc_name, updated_at: new Date().toISOString() });
  })().catch((e) => console.error("link extras", e)));
  return `✅ Linked to **${row.mc_name}**! Your $500 reward lands in game within a minute (if you're offline, it's waiting for you).`;
}

const LINK_MODAL = {
  type: 9,
  data: {
    custom_id: "link_modal",
    title: "Link your Minecraft account",
    components: [{
      type: 1,
      components: [{
        type: 4, custom_id: "code", label: "Your code (type /link in game to get it)", style: 1,
        min_length: 6, max_length: 20, required: true, placeholder: "AB12CD",
      }],
    }],
  },
};

const LINK_PANEL = {
  embeds: [{
    title: "🔗 Link your Minecraft account — get $500",
    description:
      "1. On the server (**obsidianpact.net**) type **/link** to get a code.\n" +
      "2. Click the button below and paste the code.\n" +
      "Your **$500** arrives in game within a minute, and you get the **Linked** role.",
    color: PURPLE,
  }],
  components: [{ type: 1, components: [{ type: 2, style: 3, label: "Link my account", custom_id: "open_link" }] }],
};

const CLIPS_PANEL = {
  embeds: [{
    title: "🎬 Submit your clips",
    description:
      "Got a sick PvP fight, a big build, a funny moment or an event on **The Obsidian Pact**? Send it in!\n\n" +
      "**How:** click **Submit a clip** below and either **upload the video file** (.mp4, up to your Discord upload limit, 20 MB on free accounts) " +
      "or paste a link (YouTube, TikTok, Medal, Google Drive, Streamable...) for longer videos. Make sure links can be opened by anyone.\n\n" +
      "**Rules**\n" +
      "• Your own footage, recorded on our server\n" +
      "• No copyrighted music (game sound or no music is best)\n" +
      "• Keep it clean: no slurs or other people's personal info\n\n" +
      "**By submitting a clip you agree** that The Obsidian Pact can use it, as-is or edited, on our website " +
      "(obsidianpact.net), in our YouTube and TikTok videos and on our other social media. We always credit you.\n\n" +
      "**Rewards:** the best clips get featured with your name on them, and regular creators can earn **Crystals** and the **Media** rank.",
    color: PURPLE,
  }],
  components: [{ type: 1, components: [{ type: 2, style: 3, label: "Submit a clip", emoji: { name: "🎬" }, custom_id: "open_clip" }] }],
};

const CLIP_MODAL = {
  type: 9,
  data: {
    custom_id: "clip_modal",
    title: "Submit a clip",
    components: [
      { type: 18, label: "Upload your video", description: "An .mp4 or other video file. Too big? Paste a link below instead.",
        component: { type: 19, custom_id: "file", min_values: 0, max_values: 1, required: false } },
      { type: 18, label: "Or a link to your clip", component: { type: 4, custom_id: "url", style: 1, max_length: 300, required: false, placeholder: "https://youtube.com/..." } },
      { type: 18, label: "What happens in it?", component: { type: 4, custom_id: "note", style: 2, max_length: 400, required: false, placeholder: "1v3 clutch at spawn, my castle build, event win..." } },
      { type: 18, label: "Your in-game name (for credit)", component: { type: 4, custom_id: "ign", style: 1, max_length: 17, required: false } },
    ],
  },
};

type Attachment = { id: string; url: string; filename: string; size: number; content_type?: string };

/** Checks the form; the slow part (copying the video into #mod-log) runs after we've answered Discord. */
async function submitClip(userId: string, username: string, url: string, note: string, ign: string, file: Attachment | null) {
  if (!file && !url) return { reply: "Upload a video file or paste a link to it." };
  if (url && !CLIP_URL_RE.test(url)) return { reply: "That doesn't look like a link. Paste the full link, starting with https://" };
  if (/@everyone|@here/.test(note)) return { reply: "No @everyone or @here, please." };
  if (file && file.content_type && !/^video\//.test(file.content_type) && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.filename)) {
    return { reply: "That file isn't a video. Upload an .mp4 (or .mov / .webm), or paste a link." };
  }
  const work = (async () => {
    if (!ign) {
      const { data } = await db.from("pact_igns").select("ign").eq("discord_user_id", userId).maybeSingle();
      ign = data?.ign ?? "";
    }
    const { data: row } = await db.from("pact_clip_submissions")
      .insert({ discord_user_id: userId, username, ign: ign || null, url: url || (file ? `upload:${file.filename}` : ""), note: note || null }).select("id").single();
    const embed = {
      title: `🎬 New clip #${row?.id ?? "?"}`,
      ...(url ? { url } : {}),
      description: [note, url, file ? `📎 ${file.filename} (${(file.size / 1048576).toFixed(1)} MB) attached below` : ""].filter(Boolean).join("\n\n"),
      color: PURPLE,
      fields: [
        { name: "From", value: `<@${userId}> (${username})`, inline: true },
        { name: "In-game name", value: ign || "not given", inline: true },
      ],
      footer: { text: "They agreed the clip can be used on the website, YouTube, TikTok and socials with credit." },
      timestamp: new Date().toISOString(),
    };
    const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
    let r: Response;
    if (file) {
      // copy the upload into #mod-log so it stays (the link Discord gives us expires)
      const vid = await fetch(file.url);
      const form = new FormData();
      form.append("payload_json", JSON.stringify({ ...payload, attachments: [{ id: 0, filename: file.filename }] }));
      form.append("files[0]", new Blob([await vid.arrayBuffer()], { type: file.content_type || "video/mp4" }), file.filename);
      r = await fetch(`${API}/channels/${MODLOG_CHANNEL_ID}/messages`, { method: "POST", headers: { Authorization: `Bot ${Deno.env.get("DISCORD_BOT_TOKEN")}` }, body: form });
      if (!r.ok) {
        // too big for the bot to re-upload: post the original link instead (Discord links expire after about a day)
        console.log("clip upload failed", r.status, (await r.text()).slice(0, 200));
        embed.description += `\n\n⚠️ Too big to copy here. Download it within 24 hours: ${file.url}`;
        r = await discord(`/channels/${MODLOG_CHANNEL_ID}/messages`, { method: "POST", body: JSON.stringify(payload) });
      }
    } else {
      r = await discord(`/channels/${MODLOG_CHANNEL_ID}/messages`, { method: "POST", body: JSON.stringify(payload) });
    }
    if (!r.ok) console.log("clip post failed", r.status, (await r.text()).slice(0, 200));
  })().catch((e) => console.error("clip work", e));
  return { reply: "✅ Thanks! Your clip was sent to the staff. If it gets used, you'll be credited" + (ign ? ` as **${ign}**` : "") + ".", work };
}

/** Successful links are shown to everyone in the channel; problems only to the user. */
async function linkReply(userId: string, username: string, raw: string) {
  let reply: string;
  try { reply = await linkAccount(userId, username, raw); }
  catch (e) { console.error("link failed", e); reply = "Something went wrong linking. Type **/link** in game again for a new code."; }
  console.log("link attempt", JSON.stringify({ user: username, code: raw, reply: reply.slice(0, 80) }));
  if (reply.startsWith("✅")) {
    // The reply is private (no spam in #welcome); the shout-out goes to #bot-commands if the bot may post there.
    const mc = reply.match(/\*\*(.+?)\*\*/)?.[1] ?? "their account";
    EdgeRuntime.waitUntil(discord(`/channels/${ANNOUNCE_CHANNEL_ID}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: `🔗 <@${userId}> linked their Minecraft account **${mc}** and got **$500**! Type **/link** in game to do the same.`, allowed_mentions: { parse: [] } }),
    }).then(async (r) => { if (!r.ok) console.log("announce failed", r.status, (await r.text()).slice(0, 120)); }).catch(() => {}));
  }
  return ephemeral(reply);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Registers the slash commands (idempotent). Visit once after the token is set.
  if (req.method === "GET") {
    if (url.searchParams.get("register") === "1") return json(await registerCommands());
    if (url.searchParams.get("clips_panel") === "1") {
      const { data: k } = await db.from("pact_site_keys").select("mc_key").eq("id", 1).single();
      if (!k?.mc_key || url.searchParams.get("key") !== k.mc_key) return new Response("forbidden", { status: 403 });
      const edit = url.searchParams.get("edit");
      const r = edit
        ? await discord(`/channels/${CLIPS_CHANNEL_ID}/messages/${edit}`, { method: "PATCH", body: JSON.stringify(CLIPS_PANEL) })
        : await discord(`/channels/${CLIPS_CHANNEL_ID}/messages`, { method: "POST", body: JSON.stringify(CLIPS_PANEL) });
      return new Response(`${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    return new Response("Pact Bot is running");
  }

  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  const body = await req.text();
  if (
    !sig || !ts ||
    !nacl.sign.detached.verify(new TextEncoder().encode(ts + body), hexToBytes(sig), hexToBytes(PUBLIC_KEY))
  ) {
    return new Response("invalid request signature", { status: 401 });
  }

  const i = JSON.parse(body);
  const user = i.member?.user ?? i.user;
  console.log("interaction", JSON.stringify({ type: i.type, name: i.data?.name ?? i.data?.custom_id, user: user?.username, opts: i.data?.options }));

  // Discord checking the endpoint
  if (i.type === 1) return json({ type: 1 });

  // Slash commands
  if (i.type === 2) {
    const name = i.data?.name;
    if (name === "ign" || name === "about") return json(await profileModal(user.id));
    if (name === "ign-panel") return json({ type: 4, data: PANEL });
    if (name === "link") {
      const raw = String(i.data.options?.[0]?.value ?? "");
      if (!raw.trim()) return json(LINK_MODAL);
      return await linkReply(user.id, user.username, raw);
    }
    if (name === "link-panel") return json({ type: 4, data: LINK_PANEL });
    if (name === "clips-panel") return json({ type: 4, data: CLIPS_PANEL });
    if (name === "ign-lookup") {
      const uid = i.data.options?.[0]?.value;
      const { data } = await db.from("pact_igns").select("ign, updated_at").eq("discord_user_id", uid).maybeSingle();
      return ephemeral(data ? `<@${uid}>'s IGN is **${data.ign}**.` : `<@${uid}> hasn't set an IGN yet.`);
    }
  }

  // Button click
  if (i.type === 3 && i.data?.custom_id === "set_ign") return json(await profileModal(user.id));
  if (i.type === 3 && i.data?.custom_id === "open_link") return json(LINK_MODAL);
  if (i.type === 3 && i.data?.custom_id === "open_clip") return json(CLIP_MODAL);
  if (i.type === 5 && i.data?.custom_id === "clip_modal") {
    // components come back wrapped in labels ({component}) or action rows ({components}); flatten both
    type C = { custom_id?: string; value?: string; values?: string[]; component?: C; components?: C[] };
    const flat: C[] = [];
    const walk = (c: C) => { if (c.custom_id) flat.push(c); if (c.component) walk(c.component); (c.components ?? []).forEach(walk); };
    (i.data.components ?? []).forEach(walk);
    const f = (id: string) => String(flat.find((c) => c.custom_id === id)?.value ?? "").trim();
    const fileId = flat.find((c) => c.custom_id === "file")?.values?.[0];
    const file: Attachment | null = fileId ? (i.data.resolved?.attachments?.[fileId] ?? null) : null;
    let reply: string;
    try {
      const res = await submitClip(user.id, user.username, f("url"), f("note"), f("ign"), file);
      reply = res.reply;
      if (res.work) EdgeRuntime.waitUntil(res.work);
    } catch (e) { console.error("clip failed", e); reply = "Something went wrong sending your clip, try again in a minute."; }
    return ephemeral(reply);
  }
  if (i.type === 5 && i.data?.custom_id === "link_modal") {
    const raw = String((i.data.components ?? []).flatMap((r: { components: { custom_id: string; value: string }[] }) => r.components)
      .find((c: { custom_id: string }) => c.custom_id === "code")?.value ?? "");
    return await linkReply(user.id, user.username, raw);
  }

  // Pop-up submitted
  if (i.type === 5 && i.data?.custom_id === "ign_modal") {
    const field = (id: string) =>
      String((i.data.components ?? []).flatMap((r: { components: { custom_id: string; value: string }[] }) => r.components)
        .find((c: { custom_id: string }) => c.custom_id === id)?.value ?? "").trim();
    const ign = field("ign");
    const about = field("about").replace(/\s+\n/g, "\n").slice(0, 300);
    const skin = field("skin");
    if (!/^\.?[A-Za-z0-9_]{3,16}$/.test(ign)) {
      return ephemeral("That doesn't look like a Minecraft name. Use 3–16 letters, numbers or underscores, exactly as it shows in-game.");
    }
    if (skin && !/^[A-Za-z0-9_]{3,16}$/.test(skin)) {
      return ephemeral("The skin name should be a Java player name (3–16 letters, numbers or underscores). Leave it empty if you don't use /skin.");
    }
    if (LINK_RE.test(about)) {
      return ephemeral("No links or @everyone in your About me, please. Take them out and try again with **/about**.");
    }
    const nick: string | null = i.member?.nick ?? null;
    const { data: prev } = await db.from("pact_igns").select("ign").eq("discord_user_id", user.id).maybeSingle();
    const keepsNick = !!nick && nick !== prev?.ign;
    EdgeRuntime.waitUntil(saveProfile(user.id, user.username, ign, about, skin, nick).catch((e) => console.error("saveProfile", e)));
    return ephemeral(
      `Done. Your IGN is set to **${ign}**.` +
      (keepsNick ? ` Your nickname stays **${nick}**.` : ` It's your nickname for now; change it anytime with **/nick**.`) + "\n" +
      (about || skin
        ? `Your About me goes on the members page (${SITE}) once a Leader approves it.`
        : `You're on the members page: ${SITE}\nTip: type **/about** to add an About me.`),
    );
  }

  return ephemeral("Something went wrong, try again.");
});
