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
  const load = () => (cache ||= fetch(API + "?a=public").then((r) => (r.ok ? r.json() : Promise.reject(r.status))));

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
  const head = (m) => (java(skinOf(m)) ? `https://mc-heads.net/avatar/${encodeURIComponent(skinOf(m))}/64` : m.avatar);
  const body = (m) => (java(skinOf(m)) ? `https://mc-heads.net/body/${encodeURIComponent(skinOf(m))}/170` : null);

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
