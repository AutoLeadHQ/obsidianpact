<script>
  const roster = document.getElementById("roster");
  const count = document.getElementById("count");
  let all = [];
  function card(m) {
    const b = OP.body(m);
    const pic = b
      ? `<img class="body" src="${OP.esc(b)}" alt="${OP.esc(m.ign)}'s Minecraft skin" loading="lazy" onerror="this.className='av-only';this.src='${OP.esc(m.avatar)}'">`
      : `<img class="av-only" src="${OP.esc(m.avatar)}" alt="" loading="lazy">`;
    return `<article class="card">
      <div class="skin">${b ? `<img class="disc" src="${OP.esc(m.avatar)}" alt="" loading="lazy">` : ""}${pic}</div>
      <div class="info">
        <h3>${OP.esc(m.ign)}</h3>
        <div class="meta"><span class="role ${m.role.replace(" ", "-")}">${OP.esc(m.role)}</span><span>Member since ${OP.month(m.since)}</span></div>
        ${m.about ? `<p>${OP.esc(m.about)}</p>` : `<p class="none">No About me yet.</p>`}
      </div>
    </article>`;
  }
  function render() {
    const t = document.getElementById("q").value.trim().toLowerCase();
    const list = t ? all.filter((m) => (m.ign + " " + m.about + " " + m.role).toLowerCase().includes(t)) : all;
    count.textContent = t ? `${list.length} of ${all.length} members` : `${all.length} ${all.length === 1 ? "member" : "members"}`;
    roster.innerHTML = list.length ? list.map(card).join("")
      : t ? `<p class="loading">No one matches that.</p>`
      : `<div class="empty"><strong>The roster is filling up.</strong>Members show up here once they set their IGN in the Discord. Steps are below.</div>`;
  }
  document.getElementById("q").addEventListener("input", render);
  OP.load().then((d) => { all = d.members; render(); })
    .catch(() => { roster.innerHTML = `<div class="empty"><strong>Couldn't load the roster.</strong>Refresh the page to try again.</div>`; });
</script>
