// The one file to edit when something ships. Every button on the site reads from here.
window.AURA = {
  // GitHub Releases of kartikgupta372/aura-suite. Turn releasePublished on after the first tagged release exists.
  releaseBase: "https://github.com/kartikgupta372/aura-suite/releases/latest/download/",
  releasePublished: false,

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
    design:  { url: "https://aura-design-ai-gilt.vercel.app", live: false },
    sponsor: { url: "https://sponsorfit-inky.vercel.app",     live: false },
    beat:    { url: "", live: false },
    speak:   { url: "", live: false },
    codex:   { url: "", live: false },
  },
};
