<script>
  const list = document.getElementById("videos");
  OP.load().then((d) => {
    if (!d.videos.length) {
      list.outerHTML = `<div class="empty"><strong>First videos are on the way.</strong>Join the Discord to be in the next one.</div>`;
      return;
    }
    list.innerHTML = "";
    d.videos.forEach((v, i) => {
      const row = document.createElement("article");
      row.className = "video" + (i === 0 ? " feature" : "");
      row.appendChild(OP.player(v));
      const txt = document.createElement("div");
      txt.innerHTML = `<h3>${OP.esc(v.title || "Untitled video")}</h3><span class="date">${OP.day(v.at)}</span>${v.description ? `<p>${OP.esc(v.description)}</p>` : ""}`;
      row.appendChild(txt);
      list.appendChild(row);
    });
  }).catch(() => { list.innerHTML = `<div class="empty"><strong>Couldn't load videos.</strong>Refresh the page to try again.</div>`; });
</script>
