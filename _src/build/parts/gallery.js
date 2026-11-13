<script>
  const gallery = document.getElementById("gallery");
  const chips = document.getElementById("chips");
  const lb = document.getElementById("lb");
  let all = [], shown = [], at = 0, lastFocus = null, filter = "All";

  // ---- lightbox
  function show(i) {
    at = (i + shown.length) % shown.length;
    const b = shown[at];
    document.getElementById("lb-img").src = b.image;
    document.getElementById("lb-img").alt = b.title || b.category;
    document.getElementById("lb-title").textContent = b.title || b.category;
    document.getElementById("lb-text").textContent = [b.caption, b.builders && "By " + b.builders].filter(Boolean).join(" · ");
    history.replaceState(null, "", "#" + b.id);
  }
  function open(i) {
    lastFocus = document.activeElement; show(i); lb.hidden = false; document.body.style.overflow = "hidden";
    document.getElementById("lb-close").focus(); OP.track("base_open", shown[at].title || shown[at].category);
  }
  function close() { lb.hidden = true; document.body.style.overflow = ""; history.replaceState(null, "", location.pathname); lastFocus && lastFocus.focus(); }
  document.getElementById("lb-close").onclick = close;
  document.getElementById("lb-prev").onclick = () => show(at - 1);
  document.getElementById("lb-next").onclick = () => show(at + 1);
  lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
  document.addEventListener("keydown", (e) => {
    if (lb.hidden) return;
    if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") show(at - 1); else if (e.key === "ArrowRight") show(at + 1);
  });

  // ---- grid + filters
  function render() {
    shown = filter === "All" ? all : all.filter((b) => b.category === filter);
    chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.c === filter));
    gallery.innerHTML = shown.map((b, i) => `<button class="shot" type="button" data-i="${i}">
      <img src="${OP.esc(b.image)}" alt="${OP.esc(b.title || b.category)}" loading="lazy">
      <span class="cap"><em class="tag">${OP.esc(b.category)}</em>${b.title ? `<strong>${OP.esc(b.title)}</strong>` : ""}${b.builders ? `<span>By ${OP.esc(b.builders)}</span>` : ""}</span>
    </button>`).join("");
  }
  gallery.addEventListener("click", (e) => { const s = e.target.closest(".shot"); if (s) open(Number(s.dataset.i)); });
  chips.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { filter = b.dataset.c; render(); } });

  const cats = ["Bases", "Builds", "PvP", "Events", "Map art", "Other"];
  document.getElementById("s-cat").innerHTML = cats.map((c) => `<option>${c}</option>`).join("");

  OP.load().then((d) => {
    all = d.gallery;
    if (!all.length) {
      gallery.outerHTML = `<div class="empty"><strong>The first screenshots are on the way.</strong>Be the first in the gallery: send one in below.</div>`;
      return;
    }
    const used = (d.categories || cats).filter((c) => all.some((b) => b.category === c));
    if (used.length > 1) {
      chips.innerHTML = ["All", ...used].map((c) => `<button type="button" data-c="${OP.esc(c)}">${OP.esc(c)}</button>`).join("");
      chips.hidden = false;
    }
    render();
    const fromHash = all.findIndex((b) => "#" + b.id === location.hash);
    if (fromHash >= 0) { filter = "All"; render(); open(fromHash); }
  }).catch(() => { gallery.innerHTML = `<div class="empty"><strong>Couldn't load the gallery.</strong>Refresh the page to try again.</div>`; });

  // ---- send a screenshot
  const file = document.getElementById("s-file"), msg = document.getElementById("s-msg"), go = document.getElementById("s-go");
  const preview = document.getElementById("s-preview"), drop = document.getElementById("drop");
  const say = (t, ok) => { msg.textContent = t; msg.className = "sub-msg " + (ok ? "ok" : "bad"); };
  function pick(f) {
    if (!f) return;
    preview.src = URL.createObjectURL(f); preview.hidden = false;
    document.getElementById("drop-text").innerHTML = `<b>${OP.esc(f.name)}</b> · tap to change`;
  }
  file.addEventListener("change", () => pick(file.files[0]));
  ["dragover", "dragenter"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { file.files = e.dataTransfer.files; pick(file.files[0]); } });
  try { const saved = localStorage.getItem("op_ign"); if (saved) document.getElementById("s-ign").value = saved; } catch {}

  document.getElementById("sub").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = file.files[0], ign = document.getElementById("s-ign").value.trim();
    if (!f) return say("Pick a screenshot first.");
    if (f.size > 15 * 1024 * 1024) return say("That screenshot is over 15 MB.");
    if (!/^\.?[A-Za-z0-9_]{3,16}$/.test(ign)) return say("Add your Minecraft name (IGN).");
    go.disabled = true; say("Uploading…", true);
    const post = (a, body) => fetch(OP.API + "?a=" + a, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Something went wrong."); return d; });
    try {
      const up = await post("submit_url", { name: f.name, size: f.size });
      const fd = new FormData(); fd.append("cacheControl", "3600"); fd.append("", f);
      const r = await fetch(up.url, { method: "PUT", body: fd });
      if (!r.ok) throw new Error("The upload failed. Try a smaller screenshot.");
      await post("submit", {
        path: up.path, ign, category: document.getElementById("s-cat").value,
        title: document.getElementById("s-title").value, builders: document.getElementById("s-builders").value,
        caption: document.getElementById("s-caption").value, website: document.getElementById("s-website").value,
      });
      try { localStorage.setItem("op_ign", ign); } catch {}
      OP.track("screenshot_sent", document.getElementById("s-cat").value);
      say("Sent! A Leader will check it soon, and it goes up once it's approved.", true);
      e.target.reset(); document.getElementById("s-ign").value = ign; preview.hidden = true;
      document.getElementById("drop-text").innerHTML = "<b>Send another?</b> Pick a screenshot or drag it here.";
    } catch (err) { say(err.message); }
    go.disabled = false;
  });
</script>
