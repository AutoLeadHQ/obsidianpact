// pact-site — backend for obsidianpact.net (a static GitHub Pages site).
//  GET  ?a=public         members roster, base gallery, videos, Discord counts (cached, public)
//  POST ?a=t              visitor analytics beacon (page view, heartbeat, click events)
//  POST ?a=admin          owner dashboard: analytics + content management (needs x-admin-key)
// Everything in the database is service-role only; this function is the only door in.
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BUCKET = "pact-media";
const MEDIA = `${SB_URL}/storage/v1/object/public/${BUCKET}/`;
const INVITE = "c9HDNeTX4z";
const TZ = "America/Chicago";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-admin-key",
  "Access-Control-Max-Age": "86400",
};
const json = (b: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });

let keys: { admin_key: string; sync_key: string } | null = null;
async function getKeys() {
  if (!keys) {
    const { data } = await db.from("pact_site_keys").select("admin_key, sync_key").eq("id", 1).single();
    keys = data;
  }
  return keys!;
}

// ---------------------------------------------------------------- helpers
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|discordbot|whatsapp|telegram|embedly|headless|lighthouse|python|curl|wget|axios|node-fetch|go-http|java\/|okhttp|monitor|pingdom|uptime/i;
function parseUa(ua: string) {
  const device = /ipad|tablet/i.test(ua) ? "Tablet" : /mobi|iphone|android/i.test(ua) ? "Phone" : "Computer";
  const browser = /edg\//i.test(ua) ? "Edge" : /opr\/|opera/i.test(ua) ? "Opera" : /firefox|fxios/i.test(ua) ? "Firefox"
    : /crios|chrome/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Other";
  const os = /windows/i.test(ua) ? "Windows" : /iphone|ipad|ios/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android"
    : /mac os/i.test(ua) ? "Mac" : /cros/i.test(ua) ? "ChromeOS" : /linux/i.test(ua) ? "Linux" : "Other";
  return { device, browser, os };
}
function sourceOf(ref: string, utm: string) {
  if (utm) return utm.slice(0, 40).toLowerCase();
  if (!ref) return "direct";
  let h = "";
  try { h = new URL(ref).hostname.replace(/^www\./, ""); } catch { return "other"; }
  if (h.endsWith("obsidianpact.net")) return "internal";
  if (/discord/.test(h)) return "discord";
  if (/youtube|youtu\.be/.test(h)) return "youtube";
  if (/tiktok/.test(h)) return "tiktok";
  if (/google\./.test(h)) return "google";
  if (/bing\.|duckduckgo|yahoo/.test(h)) return "search";
  if (/(^|\.)x\.com$|twitter|t\.co$/.test(h)) return "x";
  if (/reddit/.test(h)) return "reddit";
  if (/instagram/.test(h)) return "instagram";
  return h.slice(0, 40);
}
async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function geo(ip: string) {
  if (!ip) return {};
  try {
    const r = await fetch(`https://get.geojs.io/v1/ip/geo/${ip}.json`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return {};
    const g = await r.json();
    return { country: g.country || null, region: g.region || null, city: g.city || null };
  } catch { return {}; }
}
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);
const okId = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);
const avatarUrl = (id: string, hash: string | null) =>
  hash ? `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`
       : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(id) >> 22n) % 6n)}.png`;
const media = (p: string | null) => (p ? MEDIA + p.split("/").map(encodeURIComponent).join("/") : null);

// ---------------------------------------------------------------- public data
let publicCache: { at: number; body: unknown } | null = null;
async function publicData() {
  if (publicCache && Date.now() - publicCache.at < 60_000) return publicCache.body;
  const [igns, dm, bases, videos, counts] = await Promise.all([
    db.from("pact_igns").select("discord_user_id, ign, about, sort, created_at").eq("hidden", false),
    db.from("pact_discord_members").select("discord_user_id, avatar, roles, joined_at, left_at, global_name"),
    db.from("pact_bases").select("*").order("sort").order("created_at", { ascending: false }),
    db.from("pact_videos").select("*").order("sort").order("created_at", { ascending: false }),
    fetch(`https://discord.com/api/v10/invites/${INVITE}?with_counts=true`).then((r) => r.ok ? r.json() : null).catch(() => null),
  ]);
  const byId = new Map((dm.data ?? []).map((m) => [m.discord_user_id, m]));
  const RANK = ["Leader", "Mod", "Trial Mod"];
  const members = (igns.data ?? [])
    .map((m) => {
      const d = byId.get(m.discord_user_id);
      if (d?.left_at) return null; // left the Discord
      const role = RANK.find((r) => d?.roles?.includes(r)) ?? "Member";
      return {
        ign: m.ign, about: m.about || "", role,
        avatar: avatarUrl(m.discord_user_id, d?.avatar ?? null),
        since: d?.joined_at ?? m.created_at, sort: m.sort,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.sort - b!.sort) || (RANK.concat("Member").indexOf(a!.role) - RANK.concat("Member").indexOf(b!.role)) || Date.parse(a!.since) - Date.parse(b!.since));
  const body = {
    members,
    bases: (bases.data ?? []).map((b) => ({ id: b.id, title: b.title, caption: b.caption, builders: b.builders, image: media(b.image_path) })),
    videos: (videos.data ?? []).map((v) => ({
      id: v.id, kind: v.kind, title: v.title, description: v.description,
      ref: v.kind === "file" ? media(v.ref) : v.ref, poster: media(v.poster_path), at: v.created_at,
    })),
    discord: counts ? { members: counts.approximate_member_count, online: counts.approximate_presence_count, name: counts.guild?.name, icon: counts.guild?.icon ? `https://cdn.discordapp.com/icons/${counts.guild.id}/${counts.guild.icon}.png?size=128` : null } : null,
  };
  publicCache = { at: Date.now(), body };
  return body;
}

// ---------------------------------------------------------------- tracking
async function track(req: Request) {
  const ua = req.headers.get("user-agent") || "";
  let b: Record<string, unknown>;
  try { b = JSON.parse((await req.text()).slice(0, 4000)); } catch { return json({ ok: false }, 400); }
  const vid = b.vid, sid = b.sid;
  if (!okId(vid) || !okId(sid)) return json({ ok: false }, 400);
  const path = clip(b.path, 200) || "/";
  const now = new Date().toISOString();
  const preview = path.startsWith("/preview");

  if (b.t === "pv") {
    const { data: s } = await db.from("pact_sessions").select("id, pages").eq("id", sid).maybeSingle();
    if (!s) {
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
      const k = await getKeys();
      const ref = clip(b.ref, 300) || "";
      await db.from("pact_sessions").insert({
        id: sid, visitor_id: vid, path, landing: path, referrer: ref || null,
        source: sourceOf(ref, clip(b.utm, 40) || ""),
        ...(await geo(ip)), ...parseUa(ua),
        net: ip ? (await sha(k.sync_key + ip)).slice(0, 8) : null,
        pages: 1, is_bot: BOT_RE.test(ua) || !!b.wd, is_owner: !!b.own, preview,
      });
    } else {
      if (s.pages >= 300) return json({ ok: true });
      await db.from("pact_sessions").update({ path, last_seen: now, pages: s.pages + 1, ...(b.own ? { is_owner: true } : {}) }).eq("id", sid);
    }
    await db.from("pact_events").insert({ session_id: sid, visitor_id: vid, kind: "pageview", path, detail: clip(b.title, 120) });
  } else if (b.t === "hb") {
    await db.from("pact_sessions").update({ last_seen: now, path }).eq("id", sid);
  } else if (b.t === "ev") {
    const kind = clip(b.k, 40);
    if (!kind || !/^[a-z_]+$/.test(kind)) return json({ ok: false }, 400);
    await db.from("pact_events").insert({ session_id: sid, visitor_id: vid, kind, path, detail: clip(b.d, 200) });
    await db.from("pact_sessions").update({ last_seen: now, ...(kind === "discord_click" ? { discord_click: true } : {}) }).eq("id", sid);
  }
  return json({ ok: true });
}

// ---------------------------------------------------------------- admin
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
function tally<T>(rows: T[], f: (r: T) => string | null | undefined, n = 12) {
  const m = new Map<string, number>();
  for (const r of rows) { const k = f(r) || "Unknown"; m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

async function stats(o: Record<string, unknown>) {
  const days = Math.min(Number(o.days) || 30, 90);
  const since = new Date(Date.now() - days * 864e5).toISOString();
  let q = db.from("pact_sessions").select("*").gte("started_at", since).eq("is_bot", false).order("started_at", { ascending: false }).limit(20000);
  if (!o.owner) q = q.eq("is_owner", false);
  if (!o.preview) q = q.eq("preview", false);
  const { data: rows = [] } = await q;
  const S = rows ?? [];
  // per-day uniques
  const perDay = new Map<string, { visitors: Set<string>; views: number; clicks: number }>();
  for (let i = days - 1; i >= 0; i--) perDay.set(dayKey(new Date(Date.now() - i * 864e5).toISOString()), { visitors: new Set(), views: 0, clicks: 0 });
  for (const s of S) {
    const d = perDay.get(dayKey(s.started_at)); if (!d) continue;
    d.visitors.add(s.visitor_id); d.views += s.pages; if (s.discord_click) d.clicks++;
  }
  const visitors = new Set(S.map((s) => s.visitor_id));
  const firstSeen = new Map<string, string>();
  { // returning = visitor with a session before the window or more than one session
    const { data: older } = await db.from("pact_sessions").select("visitor_id").lt("started_at", since).in("visitor_id", [...visitors].slice(0, 1000));
    for (const r of older ?? []) firstSeen.set(r.visitor_id, "before");
  }
  const sessByV = tally(S, (s) => s.visitor_id, 100000);
  const returning = sessByV.filter(([v, n]) => n > 1 || firstSeen.has(v)).length;
  const durations = S.map((s) => (Date.parse(s.last_seen) - Date.parse(s.started_at)) / 1000).filter((x) => x >= 0);
  const avgTime = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const { data: ev } = await db.from("pact_events").select("kind, path, detail, session_id").gte("at", since).eq("kind", "pageview").limit(50000);
  const sids = new Set(S.map((s) => s.id));
  const pv = (ev ?? []).filter((e) => sids.has(e.session_id));
  const { data: other } = await db.from("pact_events").select("kind, detail, session_id").gte("at", since).neq("kind", "pageview").limit(20000);
  const oth = (other ?? []).filter((e) => sids.has(e.session_id));

  return {
    days,
    totals: {
      visitors: visitors.size, sessions: S.length, views: S.reduce((a, s) => a + s.pages, 0),
      discordClicks: S.filter((s) => s.discord_click).length,
      discordClickers: new Set(S.filter((s) => s.discord_click).map((s) => s.visitor_id)).size,
      returning, avgTime,
    },
    perDay: [...perDay.entries()].map(([day, d]) => ({ day, visitors: d.visitors.size, views: d.views, clicks: d.clicks })),
    pages: tally(pv, (e) => e.path?.replace(/^\/preview/, "") || "/"),
    sources: tally(S, (s) => s.source),
    countries: tally(S, (s) => s.country),
    cities: tally(S, (s) => s.city ? `${s.city}${s.region ? ", " + s.region : ""}` : null),
    devices: tally(S, (s) => s.device),
    browsers: tally(S, (s) => s.browser),
    events: tally(oth, (e) => e.kind + (e.detail ? ": " + e.detail : ""), 20),
  };
}

async function live(o: Record<string, unknown>) {
  const since = new Date(Date.now() - 70_000).toISOString();
  let q = db.from("pact_sessions").select("*").gte("last_seen", since).eq("is_bot", false).order("started_at");
  if (!o.preview) q = q.eq("preview", false);
  const { data } = await q;
  return { now: Date.now(), sessions: data ?? [] };
}

async function visitors(o: Record<string, unknown>) {
  let q = db.from("pact_sessions").select("*").eq("is_bot", false).order("started_at", { ascending: false }).limit(Math.min(Number(o.limit) || 200, 1000));
  if (!o.owner) q = q.eq("is_owner", false);
  if (!o.preview) q = q.eq("preview", false);
  const { data } = await q;
  const S = data ?? [];
  // every visitor's total visit count, to label new vs returning
  const ids = [...new Set(S.map((s) => s.visitor_id))];
  const { data: all } = ids.length ? await db.from("pact_sessions").select("visitor_id, started_at").in("visitor_id", ids.slice(0, 1000)) : { data: [] };
  const counts = new Map<string, { n: number; first: string }>();
  for (const r of all ?? []) {
    const c = counts.get(r.visitor_id) || { n: 0, first: r.started_at };
    c.n++; if (r.started_at < c.first) c.first = r.started_at;
    counts.set(r.visitor_id, c);
  }
  return { sessions: S.map((s) => ({ ...s, visits: counts.get(s.visitor_id)?.n ?? 1, first: counts.get(s.visitor_id)?.first ?? s.started_at })) };
}

async function sessionDetail(o: Record<string, unknown>) {
  const { data } = await db.from("pact_events").select("kind, path, detail, at").eq("session_id", String(o.id)).order("at").limit(500);
  return { events: data ?? [] };
}

async function discordView() {
  const [{ data: m }, { data: c }, { data: igns }] = await Promise.all([
    db.from("pact_discord_members").select("*").eq("is_bot", false).order("joined_at", { ascending: false }),
    db.from("pact_discord_counts").select("*").gte("hour", new Date(Date.now() - 30 * 864e5).toISOString()).order("hour"),
    db.from("pact_igns").select("discord_user_id, ign"),
  ]);
  const ign = new Map((igns ?? []).map((r) => [r.discord_user_id, r.ign]));
  return {
    members: (m ?? []).map((x) => ({ ...x, ign: ign.get(x.discord_user_id) ?? null, avatar_url: avatarUrl(x.discord_user_id, x.avatar) })),
    counts: c ?? [],
  };
}

async function content() {
  const [igns, dm, bases, videos] = await Promise.all([
    db.from("pact_igns").select("*").order("sort").order("created_at"),
    db.from("pact_discord_members").select("discord_user_id, avatar, roles, left_at"),
    db.from("pact_bases").select("*").order("sort").order("created_at", { ascending: false }),
    db.from("pact_videos").select("*").order("sort").order("created_at", { ascending: false }),
  ]);
  const byId = new Map((dm.data ?? []).map((m) => [m.discord_user_id, m]));
  return {
    members: (igns.data ?? []).map((m) => ({ ...m, avatar: avatarUrl(m.discord_user_id, byId.get(m.discord_user_id)?.avatar ?? null), roles: byId.get(m.discord_user_id)?.roles ?? [], left: !!byId.get(m.discord_user_id)?.left_at })),
    bases: (bases.data ?? []).map((b) => ({ ...b, image: media(b.image_path) })),
    videos: (videos.data ?? []).map((v) => ({ ...v, url: v.kind === "file" ? media(v.ref) : null, poster: media(v.poster_path) })),
  };
}

function ytId(s: string) {
  const m = s.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})/) || s.match(/^([A-Za-z0-9_-]{11})$/);
  return m?.[1] ?? null;
}
const ttId = (s: string) => s.match(/\/video\/(\d{8,25})/)?.[1] ?? (/^\d{8,25}$/.test(s) ? s : null);

async function admin(o: Record<string, unknown>) {
  const op = String(o.op || "");
  const str = (k: string, n = 500) => (typeof o[k] === "string" ? (o[k] as string).slice(0, n) : "");
  switch (op) {
    case "ping": return { ok: true };
    case "stats": return await stats(o);
    case "live": return await live(o);
    case "visitors": return await visitors(o);
    case "session": return await sessionDetail(o);
    case "discord": return await discordView();
    case "content": return await content();

    case "member": {
      const patch: Record<string, unknown> = {};
      if ("about" in o) patch.about = str("about", 300) || null;
      if ("hidden" in o) patch.hidden = !!o.hidden;
      if ("sort" in o) patch.sort = Number(o.sort) || 0;
      if ("ign" in o && /^\.?[A-Za-z0-9_]{3,16}$/.test(str("ign"))) patch.ign = str("ign");
      await db.from("pact_igns").update(patch).eq("discord_user_id", str("id"));
      break;
    }

    case "upload": { // signed URL so the browser uploads straight to storage
      const ext = (str("name").match(/\.([a-z0-9]{2,5})$/i)?.[1] || "bin").toLowerCase();
      if (!["png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov"].includes(ext)) throw new Error("That file type isn't supported.");
      const path = `${str("folder") === "videos" ? "videos" : "bases"}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) throw error;
      return { path, url: data.signedUrl, token: data.token };
    }

    case "base_add": {
      const { error } = await db.from("pact_bases").insert({ title: str("title", 80), caption: str("caption", 300), builders: str("builders", 120), image_path: str("image_path", 200) });
      if (error) throw error; break;
    }
    case "base_edit": {
      await db.from("pact_bases").update({ title: str("title", 80), caption: str("caption", 300), builders: str("builders", 120), sort: Number(o.sort) || 0 }).eq("id", str("id"));
      break;
    }
    case "base_delete": {
      const { data } = await db.from("pact_bases").delete().eq("id", str("id")).select("image_path").maybeSingle();
      if (data?.image_path) await db.storage.from(BUCKET).remove([data.image_path]);
      break;
    }

    case "video_add": {
      let kind = "file", ref = str("path", 200);
      const link = str("link", 300).trim();
      if (link) {
        const y = ytId(link), t = ttId(link);
        if (y) { kind = "youtube"; ref = y; } else if (t) { kind = "tiktok"; ref = t; }
        else throw new Error("Paste a YouTube or TikTok video link.");
      }
      if (!ref) throw new Error("Add a link or upload a video.");
      const { error } = await db.from("pact_videos").insert({ kind, ref, title: str("title", 100), description: str("description", 500) });
      if (error) throw error; break;
    }
    case "video_edit": {
      await db.from("pact_videos").update({ title: str("title", 100), description: str("description", 500), sort: Number(o.sort) || 0 }).eq("id", str("id"));
      break;
    }
    case "video_delete": {
      const { data } = await db.from("pact_videos").delete().eq("id", str("id")).select("kind, ref").maybeSingle();
      if (data?.kind === "file") await db.storage.from(BUCKET).remove([data.ref]);
      break;
    }
    default: throw new Error("Unknown action");
  }
  publicCache = null;
  return { ok: true };
}

// ---------------------------------------------------------------- router
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const a = new URL(req.url).searchParams.get("a");
  try {
    if (req.method === "GET" && a === "public") return json(await publicData(), 200, { "Cache-Control": "public, max-age=60" });
    if (req.method === "POST" && a === "t") return await track(req);
    if (req.method === "POST" && a === "admin") {
      const k = await getKeys();
      if (req.headers.get("x-admin-key") !== k.admin_key) return json({ error: "Wrong admin key" }, 401);
      const o = await req.json().catch(() => ({}));
      return json(await admin(o));
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong" }, 500);
  }
});
