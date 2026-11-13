// Pact Bot — The Obsidian Pact's Discord bot (HTTP interactions, no always-on server).
// - "Set your IGN" button / /ign command opens a pop-up asking for the Minecraft name (+ optional About me)
// - Saves it and sets the member's server nickname to it
// - /about lets members write the bio shown on the obsidianpact.net members page
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

// One pop-up for both: IGN (required) and About me (optional), pre-filled with what they already saved.
async function profileModal(userId: string) {
  const { data } = await db.from("pact_igns").select("ign, about").eq("discord_user_id", userId).maybeSingle();
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

async function saveProfile(userId: string, username: string, ign: string, about: string) {
  await db.from("pact_igns").upsert({
    discord_user_id: userId,
    discord_username: username,
    ign,
    about: about || null,
    updated_at: new Date().toISOString(),
  });
  await discord(`/guilds/${GUILD_ID}/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ nick: ign }),
  });
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
    if (!/^\.?[A-Za-z0-9_]{3,16}$/.test(ign)) {
      return ephemeral("That doesn't look like a Minecraft name. Use 3–16 letters, numbers or underscores, exactly as it shows in-game.");
    }
    EdgeRuntime.waitUntil(saveProfile(user.id, user.username, ign, about).catch((e) => console.error("saveProfile", e)));
    return ephemeral(
      `Done. Your IGN is set to **${ign}** and your nickname will update in a second.\n` +
      `You're on the members page: ${SITE}` + (about ? "" : "\nTip: type **/about** to add an About me."),
    );
  }

  return ephemeral("Something went wrong, try again.");
});
