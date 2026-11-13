Source for obsidianpact.net (not served; Jekyll skips folders starting with _).

- `build/build.py OUT` regenerates the pages from `build/parts/` (shared nav, footer, head).
- `functions/` are the Supabase edge functions: `pact-site` (content + analytics API),
  `pact-sync` (copies Discord members every 10 min), `pact-bot` (Discord slash commands).
