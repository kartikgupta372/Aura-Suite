# Aura Suite — Owner manual

For Kartik. How the suite is put together, where everything lives, how to ship, and what is still open. Last updated 13 Nov 2026.

The user-facing manual is the hub site's Help page (`site/help.html`). Keep the two in step when a feature changes.

## 1. What each product is, and why

| Product | Form | Why this form | Runs on | Code | Database |
|---|---|---|---|---|---|
| DeskCal | Desktop app (Tauri) | Needs tray, start at login, Windows notifications, offline | User's PC | `apps/deskcal` | None (files in `%APPDATA%\com.auraventures.deskcal`) |
| Inkboard | Desktop app (Electron; move to Tauri later) | Pen input, local files, `.inkb` file association, offline | User's PC | `apps/inkboard` | None (`Documents\Inkboard`) |
| Launcher | Desktop app (Tauri), planned Feb | Global hotkey and system access | User's PC | not started | — |
| Aura Design | Website | Server takes screenshots with headless Chromium and runs heavy AI | Vercel today; Railway/Render recommended by its DEPLOYMENT.md | `AuraDesign.AI` repo | Supabase **AuraDesignAI** (own project) |
| Speak AI | Website | Mic works in the browser; embedding model runs on a Python server | Frontend Vercel, backend Railway (not deployed yet) | `Speak-AI` repo | Supabase **aura-suite** (`public` tables) |
| BeatBeater | Website (installable PWA) | Webcam hand tracking runs well in the browser and works on any device | Vercel (not deployed yet) | local `BeatBeater` folder | Supabase **aura-suite** (`public` tables) |
| SponsorFit | Website | Creators work in a browser and share public media-kit links | Vercel (`sponsorfit-inky.vercel.app`) | `SponsorFit` repo | Supabase **aura-suite** (`public` tables) |
| Codex Vitae | Website | Chat with a server-side model; static frontend | Frontend Vercel, API on Railway (not deployed yet) | `Codex_Vitae-philosophers-chatbot-` repo | Supabase **aura-suite**, `codex` schema |
| Sixth Sense | Website + browser extension, after launch | Heavy multi-database stack | — | local `6th sense` | MongoDB, Neo4j, Qdrant, Redis (not Supabase) |

Rule of thumb for new products: if it needs the tray, a global shortcut, local files or offline use, it is a desktop app. If it needs a big model, a camera or mic on any device, or a shareable link, it is a website. A website can still appear inside Launcher as a shortcut.

## 2. Where everything lives

### Supabase (free plan: 2 active projects at a time)

| Project | Status | Holds |
|---|---|---|
| **aura-suite** (Mumbai, `grmaprevhcrjrlstssfi`) | Active | Waitlist, shared accounts (`profiles`), Speak AI, BeatBeater, SponsorFit, Codex Vitae (`codex` schema) |
| **AuraDesignAI** (`bumjqmfftomwvczpevgu`) | Active | Aura Design only (backend uses the service key) |
| beatbeater, Sponsor_fit, SPEAK | Paused | Old copies. Nothing writes to them. Keep until you are sure no data there is needed. Supabase shows the restore deadline on each project page |
| IntellliBroker, exam-league-jss, DhatuJal | Paused | Not part of Aura Suite |

How the shared account works in aura-suite:
- One `profiles` row per person, created automatically on sign-up (including anonymous demo users). App settings are columns on that row (BeatBeater: `handedness_swap`, `preferred_tracker`, `telemetry_opt_in`; SponsorFit: `safety`, `existing_sponsors`).
- `plan` is `free`, `pro` or `student`. Users cannot change it; a trigger blocks it. Change it yourself in the SQL editor: `update profiles set plan = 'pro' where id = '<user id>';`
- Every user table has row-level security: people only see their own rows. SponsorFit media kits are readable by anyone with the link, on purpose.
- Speak AI's and Codex Vitae's tables are server-only (no public access); their backends use the service key or a direct database connection.

Useful SQL (Supabase → aura-suite → SQL Editor):
- Waitlist: `select email, apps, source, created_at from waitlist order by created_at desc;`
- Waitlist by app: `select unnest(apps) app, count(*) from waitlist group by 1 order by 2 desc;`
- Sign-ups: `select count(*), plan from profiles group by plan;`

### Vercel
- `aura-design-ai` → `aura-design-ai-gilt.vercel.app`
- `sponsorfit` → `sponsorfit-inky.vercel.app`
- Both have **Vercel Authentication** switched on for every deployment, so the public sees a Vercel login screen. Fix in step 3 below.

### GitHub
Existing repos: `AuraDesign.AI`, `Speak-AI`, `SponsorFit`, `Codex_Vitae-philosophers-chatbot-`. New: **`aura-suite`** (to create, step 1) holds both desktop apps, the hub site, these manuals and the release workflow.

## 3. Your to-do list, in order

These are the things I could not do from my side. Each is a few clicks.

1. **Create the `aura-suite` repo.** github.com/new → name `aura-suite` → Public → no README → Create. Tell me, and I push everything and run the first release.
2. **SponsorFit on aura-suite.** Vercel → sponsorfit → Settings → Environment Variables. Set `NEXT_PUBLIC_SUPABASE_URL` to `https://grmaprevhcrjrlstssfi.supabase.co` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `..._ANON_KEY`, whichever exists) to `sb_publishable_e8GiA8jFIsTEWGs9vQ0j_Q_2uMo9FBo`. Then Deployments → latest → Redeploy. Until then the live site points at the paused database.
3. **Make the two websites public.** Vercel → each project → Settings → Deployment Protection → Vercel Authentication → set to **Only Preview Deployments** (or off). Then set `live: true` for `design` and `sponsor` in `site/config.js`.
4. **aura-suite sign-in settings.** Supabase → aura-suite → Authentication:
   - Sign In / Providers → turn on **Allow anonymous sign-ins** (SponsorFit's "Try the demo" needs it) and keep Email on.
   - URL Configuration → Site URL = the hub site address; add Redirect URLs for `https://sponsorfit-inky.vercel.app/**` and the BeatBeater site once it exists.
5. **Aura Design database.** Run `backend/src/db/migrations/005_refresh_tokens.sql` and `006_lock_public_roles.sql` in the AuraDesignAI SQL editor, or tell me "run them".
6. **Two secrets** (I can't read them):
   - Codex Vitae: database password (aura-suite → Connect → Session pooler). Put it in `api/.env` as shown in `api/.env.aura-suite.example`.
   - Speak AI: secret key (aura-suite → Project Settings → API Keys). Put it in `backend/.env` as shown in `backend/.env.aura-suite.example`, then run `seed_speakers.py`.
7. **Deploy the hub site.** Vercel → Add New Project → import `aura-suite` → Root Directory `site` → Framework "Other" → Deploy.
8. **Deploy BeatBeater.** Push the BeatBeater folder to a repo, import it in Vercel with Root Directory `web`, and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (same values as step 2).

## 4. Releasing the desktop apps

1. Bump the version in `apps/inkboard/package.json`, `apps/deskcal/src-tauri/tauri.conf.json` and `apps/deskcal/src-tauri/Cargo.toml`, and in `site/config.js`.
2. Commit, then `git tag v1.0.1 && git push origin v1.0.1`.
3. GitHub Actions → "Release desktop apps" builds `Inkboard-Setup.exe` and `DeskCal-Setup.exe` on Windows and attaches them, with `SHA256SUMS.txt`, to a GitHub Release.
4. The first time only: set `releasePublished: true` in `site/config.js` and redeploy the site. The Download buttons point at `releases/latest/download/<file>`, so later releases need no site change.

Do not rename the two `.exe` asset names: the site links to them.

## 5. Running each project locally

| Project | Command |
|---|---|
| DeskCal | `cd apps/deskcal && npx @tauri-apps/cli@2 icon ui/icon.svg && npx @tauri-apps/cli@2 dev` (needs Rust) |
| Inkboard | `cd apps/inkboard && npm install && npm start` |
| Hub site | open `site/index.html`, or `npx serve site` |
| Aura Design | `cd backend && npm run dev`, `cd frontend && npm run dev` (see its DEPLOYMENT.md) |
| Speak AI | backend: `uvicorn` per its README; frontend: `npm run dev` |
| Codex Vitae | `cd api && uvicorn app.main:app` with `DB_SCHEMA=codex` in `.env` |

## 6. Limits that will bite

- **Supabase free plan:** 2 active projects, 500 MB database, 1 GB storage, 50 MB per uploaded file. Free projects pause after a week with no activity; the waitlist alone may not count as enough activity, so check the dashboard weekly or upgrade before launch.
- **Vercel Hobby** is for non-commercial use. Move to Pro before you charge for Aura Pro.
- **Unsigned installers** trigger SmartScreen. Fixes: a code-signing certificate, or ship through the Microsoft Store.
- **No auto-update yet.** Users must download new installers. Next step: Tauri updater for DeskCal, electron-updater for Inkboard.

## 7. Known gaps

- Aura Design has its own sign-in (its own `users` table), and Speak AI keys users by email without Supabase Auth. Move both onto the shared `profiles` account later.
- Inkboard's "Convert to text" needs the user's own AI key. Plan: route it through an Aura server with daily limits.
- BeatBeater and SponsorFit now share one account. Data in their old paused projects was not copied; both were days old and held test data only.

## 8. What was tested on 13 Nov

| Item | Check |
|---|---|
| Inkboard installer | Built from source; `Inkboard-Setup-1.0.0.exe` is a valid Windows installer with the new file-safety code inside. Not yet installed on a real PC |
| DeskCal | Rust compiles (`cargo check`), JavaScript syntax checked. Windows installer not built yet (needs the GitHub workflow) |
| aura-suite database | Simulated two users: own settings save, plan cannot be raised, other users' rows are invisible, anonymous users get a profile, waitlist accepts inserts but cannot be read |
| Aura Design | 7 backend tests pass; live DB is schema v4; `exec_sql` is locked to the backend |
| Hub site | Renders on desktop and mobile with no script errors. Fonts from Google may differ slightly from my check |
