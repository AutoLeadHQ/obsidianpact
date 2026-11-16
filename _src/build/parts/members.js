<script>
  const roster = document.getElementById("roster");
  const count = document.getElementById("count");
  let all = [];
  let badges = {};
  // Media (from Discord) counts as a rank: shown in place of "Member" and listed right under Trial Mod
  const ORDER = ["Leader", "Mod", "Trial Mod", "Media", "Member"];
  const rank = (m) => (m.role === "Member" && (badges[m.ign.toLowerCase()] || []).includes("Media")) ? "Media" : m.role;
  function card(m) {
    const r = rank(m);
    const b = OP.body(m);
    const pic = b
      ? `<img class="body" src="${OP.esc(b)}" alt="${OP.esc(m.ign)}'s Minecraft skin" loading="lazy" onerror="this.className='av-only';this.src='${OP.esc(m.avatar)}'">`
      : `<img class="av-only" src="${OP.esc(m.avatar)}" alt="" loading="lazy">`;
    return `<article class="card">
      <div class="skin">${b ? `<img class="disc" src="${OP.esc(m.avatar)}" alt="" loading="lazy">` : ""}${pic}</div>
      <div class="info">
        <h3>${OP.esc(m.ign)}</h3>
        <div class="meta"><span class="role ${r.replace(" ", "-")}">${OP.esc(r)}</span>${(badges[m.ign.toLowerCase()] || []).filter((b) => b !== r).map((b) => `<span class="role ${b.replace(/ /g, "-")}">${OP.esc(b)}</span>`).join("")}<span>Member since ${OP.month(m.since)}</span></div>
        ${m.about ? `<p>${OP.esc(m.about)}</p>` : `<p class="none">No About me yet.</p>`}
      </div>
    </article>`;
  }
  function render() {
    const t = document.getElementById("q").value.trim().toLowerCase();
    const sorted = all.map((m, i) => [m, i]).sort((a, b) => (a[0].sort - b[0].sort) || (ORDER.indexOf(rank(a[0])) - ORDER.indexOf(rank(b[0]))) || (a[1] - b[1])).map((x) => x[0]);
    const list = t ? sorted.filter((m) => (m.ign + " " + m.about + " " + rank(m)).toLowerCase().includes(t)) : sorted;
    count.textContent = t ? `${list.length} of ${all.length} members` : `${all.length} ${all.length === 1 ? "member" : "members"}`;
    roster.innerHTML = list.length ? list.map(card).join("")
      : t ? `<p class="loading">No one matches that.</p>`
      : `<div class="empty"><strong>The roster is filling up.</strong>Members show up here once they set their IGN in the Discord. Steps are below.</div>`;
  }
  document.getElementById("q").addEventListener("input", render);
  // Discord roles like Media and Supporter show as badges (updated from Discord every 10 minutes)
  fetch("https://qgwbrwqyeyvrilwemtvy.supabase.co/functions/v1/pact-badges").then((r) => r.json())
    .then((d) => { badges = d.badges || {}; if (all.length) render(); }).catch(() => {});
  OP.load().then((d) => { all = d.members; render(); })
    .catch(() => { roster.innerHTML = `<div class="empty"><strong>Couldn't load the roster.</strong>Refresh the page to try again.</div>`; });
</script>
