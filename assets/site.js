// Shared script for every page of obsidianpact.net: visitor analytics, Join tracking, and the content API.
(() => {
  const API = "https://qgwbrwqyeyvrilwemtvy.supabase.co/functions/v1/pact-site";
  const INVITE = "https://discord.gg/c9HDNeTX4z";

  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } };
  const ss = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch { return null; } };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

  // ---- anonymous visitor analytics (no cookies, no ads, no personal info; see /privacy/)
  let vid = ls("op_vid"); if (!vid) { vid = rid(); ls("op_vid", vid); }
  let sid = ss("op_sid");
  const lastActive = Number(ss("op_last") || 0);
  if (!sid || Date.now() - lastActive > 30 * 60e3) { sid = rid(); ss("op_sid", sid); }
  const touch = () => ss("op_last", String(Date.now()));
  touch();
  const own = ls("op_owner") === "1";
  const send = (t, extra = {}) => {
    const body = JSON.stringify({ t, vid, sid, path: location.pathname, own, ...extra });
    try {
      if (t !== "pv" && navigator.sendBeacon) navigator.sendBeacon(API + "?a=t", body);
      else fetch(API + "?a=t", { method: "POST", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
    } catch {}
  };
  const isAdmin = location.pathname.includes("/admin");
  if (!isAdmin) {
    const ref = document.referrer || "";
    const utm = new URLSearchParams(location.search).get("utm_source") || new URLSearchParams(location.search).get("ref") || "";
    send("pv", { ref, utm, title: document.title, wd: !!navigator.webdriver });
    setInterval(() => { if (document.visibilityState === "visible") { send("hb"); touch(); } }, 20000);
  }
  const track = (k, d) => { if (!isAdmin) { send("ev", { k, d: d || "" }); touch(); } };

  // Every Join button goes straight to discord.gg (no redirect hops) and is counted.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    if (a.href.startsWith(INVITE)) track("discord_click", a.dataset.where || location.pathname);
    else if (a.dataset.track) track(a.dataset.track, a.dataset.where || "");
  }, true);

  // ---- content
  let cache;
  const load = () => (cache ||= fetch(API + "?a=public").then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(async (d) => { await withUuids(d.members || []); return d; }));

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const month = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  // Live Discord numbers (shown once the server is big enough to show off)
  const SHOW_COUNTS_FROM = 25;
  window.addEventListener("DOMContentLoaded", () => {
    const live = document.querySelectorAll("[data-live]");
    if (!live.length) return;
    load().then((d) => {
      if (!d.discord || d.discord.members < SHOW_COUNTS_FROM) return;
      live.forEach((el) => {
        el.querySelector("[data-online]").textContent = d.discord.online.toLocaleString();
        el.querySelector("[data-members]").textContent = d.discord.members.toLocaleString();
        el.hidden = false;
      });
    }).catch(() => {});
  });

  // Minecraft skin renders by IGN (Java names). Bedrock names (".Name") fall back to the Discord avatar.
  // m.skin is the name whose skin they wear (their IGN, or the name they copied with /skin on DonutSMP).
  const java = (n) => /^[A-Za-z0-9_]{3,16}$/.test(n || "");
  const skinOf = (m) => m.skin || m.ign;
  // Skins: the site draws each member itself from their current skin file (mineatar.io, by account UUID).
  // Outside renderers (mc-heads, etc.) kept showing people's old skins. mc-heads is only the fallback now.
  // Name -> UUID via playerdb.co, remembered in this browser for a week.
  const UUIDS_KEY = "op_uuids";
  let uuidMap = {};
  try { uuidMap = JSON.parse(localStorage.getItem(UUIDS_KEY) || "{}"); } catch (_) {}
  const uuidOf = (n) => { const e = uuidMap[(n || "").toLowerCase()]; return e && Date.now() - e.t < 7 * 864e5 ? e.id : null; };
  async function lookup(n) {
    const r = await fetch(`https://playerdb.co/api/player/minecraft/${encodeURIComponent(n)}`);
    const id = r.ok ? (await r.json())?.data?.player?.raw_id : null;
    if (id) uuidMap[n.toLowerCase()] = { id, t: Date.now() };
  }
  const loadImg = (src) => new Promise((ok, no) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => ok(i); i.onerror = no; i.src = src; });
  // Front view: 16x32 skin pixels, drawn at 5x. Handles classic/slim arms and old 64x32 skins.
  function drawSkin(img) {
    const src = document.createElement("canvas"); src.width = 64; src.height = img.height;
    const sx = src.getContext("2d"); sx.drawImage(img, 0, 0);
    const legacy = img.height === 32;
    const px = sx.getImageData(50, 16, 2, 4).data;
    let slim = !legacy; for (let k = 3; k < px.length; k += 4) if (px[k]) slim = false;
    const aw = slim ? 3 : 4, S = 5;
    const out = (w, h) => { const c = document.createElement("canvas"); c.width = w * S; c.height = h * S; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; return [c, x]; };
    const part = (x, u, v, w, h, dx, dy, flip) => {
      x.save();
      if (flip) { x.translate((dx + w) * S, dy * S); x.scale(-1, 1); x.drawImage(src, u, v, w, h, 0, 0, w * S, h * S); }
      else x.drawImage(src, u, v, w, h, dx * S, dy * S, w * S, h * S);
      x.restore();
    };
    const [bc, x] = out(16, 32);
    const L = 4 - aw; // slim arms sit 1px in
    // base layer
    part(x, 8, 8, 8, 8, 4, 0); part(x, 20, 20, 8, 12, 4, 8);
    part(x, 44, 20, aw, 12, L, 8);
    if (legacy) part(x, 44, 20, aw, 12, 12, 8, true); else part(x, 36, 52, aw, 12, 12, 8);
    part(x, 4, 20, 4, 12, 4, 20);
    if (legacy) part(x, 4, 20, 4, 12, 8, 20, true); else part(x, 20, 52, 4, 12, 8, 20);
    // second layer (hat, jacket, sleeves, pants)
    part(x, 40, 8, 8, 8, 4, 0);
    if (!legacy) {
      part(x, 20, 36, 8, 12, 4, 8); part(x, 44, 36, aw, 12, L, 8); part(x, 52, 52, aw, 12, 12, 8);
      part(x, 4, 36, 4, 12, 4, 20); part(x, 4, 52, 4, 12, 8, 20);
    }
    const [hc, y] = out(8, 8); const hx = y;
    hx.drawImage(src, 8, 8, 8, 8, 0, 0, 8 * S, 8 * S); hx.drawImage(src, 40, 8, 8, 8, 0, 0, 8 * S, 8 * S);
    return { body: bc.toDataURL(), head: hc.toDataURL() };
  }
  const drawn = {};
  async function withUuids(list) {
    const need = [...new Set(list.map(skinOf).filter((n) => java(n) && !uuidOf(n)))];
    if (need.length) {
      await Promise.race([Promise.all(need.map((n) => lookup(n).catch(() => {}))), new Promise((ok) => setTimeout(ok, 3000))]);
      try { localStorage.setItem(UUIDS_KEY, JSON.stringify(uuidMap)); } catch (_) {}
    }
    await Promise.race([Promise.all(list.map(async (m) => {
      const id = uuidOf(skinOf(m));
      if (!id) return;
      try { drawn[id] ||= drawSkin(await loadImg(`https://api.mineatar.io/skin/${id}`)); m.drawn = drawn[id]; } catch (_) {}
    })), new Promise((ok) => setTimeout(ok, 4000))]);
  }
  const head = (m) => (m.drawn ? m.drawn.head : java(skinOf(m)) ? `https://mc-heads.net/avatar/${encodeURIComponent(skinOf(m))}/64` : m.avatar);
  const body = (m) => (m.drawn ? m.drawn.body : java(skinOf(m)) ? `https://mc-heads.net/body/${encodeURIComponent(skinOf(m))}/170` : null);

  // Video player: shows a poster with a play button, loads the real player on click (full video, plays right here).
  function player(v) {
    const box = document.createElement("div");
    box.className = "player" + (v.kind === "tiktok" ? " tall" : "");
    const start = () => {
      track("video_play", v.title || v.ref);
      if (v.kind === "youtube") {
        box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.ref)}?autoplay=1&rel=0" title="${esc(v.title)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
      } else if (v.kind === "tiktok") {
        box.innerHTML = `<iframe src="https://www.tiktok.com/embed/v2/${encodeURIComponent(v.ref)}" title="${esc(v.title)}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
      }
    };
    if (v.kind === "file") {
      box.innerHTML = `<video controls playsinline preload="metadata" ${v.poster ? `poster="${esc(v.poster)}"` : ""} src="${esc(v.ref)}"></video>`;
      box.querySelector("video").addEventListener("play", () => track("video_play", v.title || "upload"), { once: true });
      return box;
    }
    const poster = v.kind === "youtube" ? `https://i.ytimg.com/vi/${encodeURIComponent(v.ref)}/hqdefault.jpg` : v.poster;
    box.innerHTML = (poster ? `<img src="${esc(poster)}" alt="" loading="lazy">` : "") +
      `<button class="play" type="button" aria-label="Play ${esc(v.title || "video")}"><span></span></button>`;
    box.querySelector(".play").addEventListener("click", start);
    return box;
  }

  window.OP = { API, INVITE, load, esc, month, day, track, head, body, player };
})();
