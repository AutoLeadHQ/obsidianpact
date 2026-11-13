#!/usr/bin/env python3
"""Builds the Obsidian Pact site pages from shared header/nav/footer pieces.
Usage: build.py OUT_DIR   (pages use relative links, so the same output works at / or /preview/)"""
import sys, pathlib, html

OUT = pathlib.Path(sys.argv[1])
INVITE = "https://discord.gg/c9HDNeTX4z"
REPO = "https://github.com/AutoLeadHQ/obsidianpact"
DISCORD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18.2 18.2 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.8 19.8 0 0 0 6 3l1.3-2a12.8 12.8 0 0 1-2-1l.5-.4a14.1 14.1 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.7 19.7 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>'

NAV = [("", "Home"), ("members/", "Members"), ("gallery/", "Gallery"), ("videos/", "Videos")]


def page(path, title, desc, body, depth, active=None, script="", noindex=False, extra_head="", nav=True):
    r = "../" * depth
    canon = "https://obsidianpact.net/" + path
    links = "".join(
        f'<a href="{r}{href}"{" aria-current=\"page\"" if href == active else ""}>{label}</a>' for href, label in NAV
    )
    nav_html = f"""<header class="nav"><div class="nav-in">
  <a class="brand" href="{r}"><img src="{r}assets/favicon.png" alt="" width="30" height="30">The Obsidian Pact</a>
  <nav class="nav-links" aria-label="Main">{links}<a class="nav-join" href="{INVITE}" data-where="nav">Join</a></nav>
</div></header>""" if nav else ""
    foot = f"""<footer><div class="foot">
  <nav aria-label="Footer"><a href="{r}">Home</a><a href="{r}members/">Members</a><a href="{r}gallery/">Gallery</a><a href="{r}videos/">Videos</a><a href="{r}privacy/">Privacy &amp; safety</a><a href="{REPO}" rel="noopener">Site code on GitHub</a></nav>
  <p>The Obsidian Pact is a player-run clan and is not affiliated with DonutSMP or Mojang. We never buy or sell DonutSMP items, money or accounts, and this site never asks you to sign in or download anything.</p>
</div></footer>""" if nav else ""
    doc = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(desc)}">
{'<meta name="robots" content="noindex, nofollow">' if noindex else f'<link rel="canonical" href="{canon}">'}
<meta property="og:title" content="{html.escape(title)}">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="https://obsidianpact.net/assets/og.png">
<meta property="og:url" content="{canon}">
<meta property="og:site_name" content="The Obsidian Pact">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#1a1222">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="{r}assets/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@500;700&family=Sora:wght@400;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{r}assets/site.css">
{extra_head}
</head>
<body>
{nav_html}
{body}
{foot}
<script src="{r}assets/site.js"></script>
{script}
</body>
</html>
"""
    f = OUT / path / "index.html"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(doc)


def part(name):
    return (pathlib.Path(__file__).parent / "parts" / name).read_text()


page("", "The Obsidian Pact | DonutSMP Clan",
     "The Obsidian Pact is a DonutSMP PvP and building clan. Meet the members, see our bases and videos, and join the Discord.",
     part("home.html").replace("{INVITE}", INVITE).replace("{DISCORD_SVG}", DISCORD_SVG).replace("{REPO}", REPO),
     0, active="", script=part("home.js"), extra_head=part("home.css"))
page("members/", "Members | The Obsidian Pact",
     "Meet the members of The Obsidian Pact, a DonutSMP PvP and building clan.",
     part("members.html").replace("{INVITE}", INVITE), 1, active="members/", script=part("members.js"))
page("gallery/", "Gallery | The Obsidian Pact",
     "Screenshots from The Obsidian Pact on DonutSMP: bases, builds, PvP, events and map art. Send in your own.",
     part("gallery.html").replace("{INVITE}", INVITE), 1, active="gallery/", script=part("gallery.js"))
page("videos/", "Videos | The Obsidian Pact",
     "Full videos from The Obsidian Pact: raids, builds, events and PvP on DonutSMP.",
     part("videos.html").replace("{INVITE}", INVITE), 1, active="videos/", script=part("videos.js"))
page("discord/", "Join The Obsidian Pact on Discord",
     "Join The Obsidian Pact Discord server.",
     part("discord.html").replace("{INVITE}", INVITE).replace("{DISCORD_SVG}", DISCORD_SVG), 1, script=part("discord.js"))
page("privacy/", "Privacy & safety | The Obsidian Pact",
     "What obsidianpact.net does and doesn't do: no sign-ins, no downloads, simple anonymous visit counts.",
     part("privacy.html").replace("{INVITE}", INVITE).replace("{REPO}", REPO), 1)
page("admin/", "Admin | The Obsidian Pact", "Owner dashboard.",
     part("admin.html"), 1, script=part("admin.js"), noindex=True, extra_head=part("admin.css"), nav=False)
print("built", OUT)
