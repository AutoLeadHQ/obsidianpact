<script>
  // Social links: add a URL to show the button. Empty ones stay hidden.
  const SOCIALS = [
    ["YouTube", ""],
    ["TikTok", ""],
    ["X", ""],
  ];
  const box = document.getElementById("socials");
  SOCIALS.filter(([, url]) => url).forEach(([name, url]) => {
    const a = document.createElement("a");
    a.className = "btn"; a.href = url; a.textContent = name; a.target = "_blank"; a.rel = "noopener";
    a.dataset.track = "social_click"; a.dataset.where = name;
    box.appendChild(a);
  });
  if (!box.children.length) document.getElementById("follow-section").remove();

  // Teasers: the crew, newest bases, latest video. Each block stays hidden until it has something in it.
  OP.load().then((d) => {
    if (d.members.length) {
      document.getElementById("t-roster").innerHTML = d.members.slice(0, 12).map((m) =>
        `<a class="mini" href="members/"><img src="${OP.esc(OP.head(m))}" alt="" width="64" height="64" loading="lazy" onerror="this.src='${OP.esc(m.avatar)}'"><b>${OP.esc(m.ign)}</b><span class="role ${m.role.replace(" ", "-")}">${OP.esc(m.role)}</span></a>`).join("");
      document.getElementById("t-members").hidden = false;
    }
    if (d.gallery.length) {
      document.getElementById("t-bases-grid").innerHTML = d.gallery.slice(0, 3).map((b) =>
        `<a href="gallery/#${OP.esc(b.id)}"><img src="${OP.esc(b.image)}" alt="${OP.esc(b.title || b.category)}" loading="lazy"></a>`).join("");
      document.getElementById("t-bases").hidden = false;
    }
    if (d.videos.length) {
      const v = d.videos[0];
      const wrap = document.createElement("div");
      wrap.className = "video";
      wrap.appendChild(OP.player(v));
      const txt = document.createElement("div");
      txt.innerHTML = `<h3>${OP.esc(v.title)}</h3><p>${OP.esc(v.description)}</p>`;
      wrap.appendChild(txt);
      document.getElementById("t-video-box").appendChild(wrap);
      document.getElementById("t-video").hidden = false;
    }
  }).catch(() => {});

  // Nether portal swirl, drawn at low resolution and scaled up with pixelated rendering.
  (() => {
    const cv = document.getElementById("portal");
    const ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height, img = ctx.createImageData(w, h);
    const C = { purple: [127, 63, 178], magenta: [178, 76, 216], lapis: [51, 76, 178] };
    const bayer = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    function frame(t) {
      const s = t / 2400;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = 1.3 * Math.sin(x * 0.30 + 2.6 * Math.sin(y * 0.09 + s) + 1.2 * Math.sin(y * 0.031 + x * 0.02 - s * 0.7))
                + 0.6 * Math.sin(y * 0.07 - x * 0.05 + s * 1.3);
        const d = bayer[y % 4][x % 4] / 16;
        const c = v > 1.15 + d * 0.5 ? C.magenta : v < -1.2 - d * 0.5 ? C.lapis : C.purple;
        const i = (y * w + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (!reduce) requestAnimationFrame(frame);
    }
    frame(0);
  })();
</script>
