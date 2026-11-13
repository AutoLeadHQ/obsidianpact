<script>
  const gallery = document.getElementById("gallery");
  const lb = document.getElementById("lb");
  let bases = [], at = 0, lastFocus = null;
  function show(i) {
    at = (i + bases.length) % bases.length;
    const b = bases[at];
    document.getElementById("lb-img").src = b.image;
    document.getElementById("lb-img").alt = b.title || "Clan base";
    document.getElementById("lb-title").textContent = b.title;
    document.getElementById("lb-text").textContent = [b.caption, b.builders && "Built by " + b.builders].filter(Boolean).join(" · ");
    history.replaceState(null, "", "#" + b.id);
  }
  function open(i) {
    lastFocus = document.activeElement; show(i); lb.hidden = false; document.body.style.overflow = "hidden";
    document.getElementById("lb-close").focus(); OP.track("base_open", bases[at].title);
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
  OP.load().then((d) => {
    bases = d.bases;
    if (!bases.length) {
      gallery.outerHTML = `<div class="empty"><strong>Screenshots are coming.</strong>We're building now. Want your base featured? Post a screenshot in the Discord.</div>`;
      return;
    }
    gallery.innerHTML = bases.map((b, i) => `<button class="shot" type="button" data-i="${i}">
      <img src="${OP.esc(b.image)}" alt="${OP.esc(b.title || "Clan base")}" loading="lazy">
      ${b.title || b.builders ? `<span class="cap">${b.title ? `<strong>${OP.esc(b.title)}</strong>` : ""}${b.builders ? `<span>Built by ${OP.esc(b.builders)}</span>` : ""}</span>` : ""}
    </button>`).join("");
    gallery.addEventListener("click", (e) => { const s = e.target.closest(".shot"); if (s) open(Number(s.dataset.i)); });
    const fromHash = bases.findIndex((b) => "#" + b.id === location.hash);
    if (fromHash >= 0) open(fromHash);
  }).catch(() => { gallery.innerHTML = `<div class="empty"><strong>Couldn't load the gallery.</strong>Refresh the page to try again.</div>`; });
</script>
