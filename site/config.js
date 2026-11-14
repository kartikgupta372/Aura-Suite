// The one file to edit when something ships. Every button on the site reads from here.
window.AURA = {
  // GitHub Releases of kartikgupta372/Aura-Suite. Turn releasePublished on after the first tagged release exists.
  releaseBase: "https://github.com/kartikgupta372/Aura-Suite/releases/latest/download/",
  releasePublished: true,

  // aura-suite Supabase project. The publishable key is safe in a browser: the waitlist table only accepts inserts.
  supabaseUrl: "https://grmaprevhcrjrlstssfi.supabase.co",
  supabaseKey: "sb_publishable_e8GiA8jFIsTEWGs9vQ0j_Q_2uMo9FBo",

  // Desktop apps: file is the asset name the release workflow publishes.
  desktop: {
    inkboard: { file: "Inkboard-Setup.exe", version: "1.0.0", size: "about 120 MB" },
    deskcal:  { file: "DeskCal-Setup.exe",  version: "1.0.0", size: "about 5 MB" },
  },

  // Web tools: set url and live: true once the site is public.
  web: {
    design:  { url: "https://aura-design-ai-gilt.vercel.app", live: true },
    sponsor: { url: "https://sponsorfit-inky.vercel.app",     live: true },
    beat:    { url: "https://beatbeater.vercel.app", live: true },
    speak:   { url: "", live: false },
    codex:   { url: "https://codex-vitae-two.vercel.app", live: true },
    campus:  { url: "https://aura-campus-one.vercel.app", live: true },
    counter: { url: "https://aura-counter-chi.vercel.app", live: true },
    sprout:  { url: "https://sprout-alpha-two.vercel.app", live: true },
  },
};
