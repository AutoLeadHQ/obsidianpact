// Pact Bot — The Obsidian Pact's Discord bot (HTTP interactions, no always-on server).
// - "Set your IGN" button / /ign or /about opens one pop-up: Minecraft name, About me, skin name
// - IGN saves right away; it becomes their nickname only if they haven't picked their own (/nick is theirs to use)
// - About me and skin name wait for the owner's approval (admin page) before they show on obsidianpact.net;
//   links and @everyone are refused outright
// - /ign-lookup lets the owner check anyone's IGN
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

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Registers the slash commands (idempotent). Visit once after the token is set.
  if (req.method === "GET") {
    if (url.searchParams.get("register") === "1") return json(await registerCommands());
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

  // Discord checking the endpoint
  if (i.type === 1) return json({ type: 1 });

  // Slash commands
  if (i.type === 2) {
    const name = i.data?.name;
    if (name === "ign" || name === "about") return json(await profileModal(user.id));
    if (name === "ign-panel") return json({ type: 4, data: PANEL });
    if (name === "ign-lookup") {
      const uid = i.data.options?.[0]?.value;
      const { data } = await db.from("pact_igns").select("ign, updated_at").eq("discord_user_id", uid).maybeSingle();
      return ephemeral(data ? `<@${uid}>'s IGN is **${data.ign}**.` : `<@${uid}> hasn't set an IGN yet.`);
    }
  }

  // Button click
  if (i.type === 3 && i.data?.custom_id === "set_ign") return json(await profileModal(user.id));

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
