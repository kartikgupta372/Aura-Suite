// Wires buttons to config.js and runs the waitlist form. Pages work without it: buttons just keep their fallback state.
(function () {
  const A = window.AURA || {};

  // Desktop downloads: <a data-download="inkboard">
  document.querySelectorAll('[data-download]').forEach((el) => {
    const app = (A.desktop || {})[el.dataset.download];
    if (!app) return;
    if (A.releasePublished) {
      el.href = A.releaseBase + app.file;
      el.removeAttribute('aria-disabled');
      el.textContent = el.dataset.label || 'Download for Windows';
    } else {
      el.href = 'index.html#waitlist';
      el.textContent = 'Join the waitlist';
    }
  });
  document.querySelectorAll('[data-version]').forEach((el) => {
    const app = (A.desktop || {})[el.dataset.version];
    if (app) el.textContent = `v${app.version} · ${app.size}`;
  });

  // Web tools: <a data-open="design">
  document.querySelectorAll('[data-open]').forEach((el) => {
    const t = (A.web || {})[el.dataset.open];
    const tag = document.querySelector(`[data-status="${el.dataset.open}"]`);
    if (t && t.live && t.url) {
      el.href = t.url; el.target = '_blank'; el.rel = 'noopener';
      el.textContent = 'Open in browser';
      if (tag) { tag.textContent = 'Live'; tag.className = 'tag live'; }
    } else {
      el.href = 'index.html#waitlist';
      el.textContent = 'Get notified';
      if (tag) { tag.textContent = 'Coming soon'; tag.className = 'tag soon'; }
    }
  });
  const relTag = A.releasePublished ? ['Available', 'tag live'] : ['Coming soon', 'tag soon'];
  document.querySelectorAll('[data-status-desktop]').forEach((t) => { t.textContent = relTag[0]; t.className = relTag[1]; });

  // Waitlist
  const form = document.getElementById('wl');
  if (!form) return;
  const msg = form.querySelector('.msg'), btn = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    msg.className = 'msg';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.className = 'msg err'; msg.textContent = 'Enter a valid email address, like you@email.com.'; form.email.focus(); return;
    }
    btn.disabled = true; msg.textContent = 'Saving your spot...';
    try {
      const r = await fetch(A.supabaseUrl + '/rest/v1/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: A.supabaseKey, Prefer: 'return=minimal' },
        body: JSON.stringify({ email, apps: [], source: 'hub-site' }),
      });
      if (r.ok || r.status === 409) { msg.className = 'msg ok'; msg.textContent = "You're on the list. We'll email you when your apps are ready."; form.reset(); }
      else throw new Error(String(r.status));
    } catch {
      msg.className = 'msg err'; msg.textContent = 'Could not save your email. Check your connection and try again.';
    }
    btn.disabled = false;
  });
})();
