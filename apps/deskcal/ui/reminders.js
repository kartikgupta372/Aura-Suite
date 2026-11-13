// Reminder engine (ported from the old Node service). Runs while DeskCal is open or sitting in the tray.
(function () {
  const S = window.Shared, tauri = window.__TAURI__;
  if (!tauri) return;
  const invoke = tauri.core.invoke;
  const readJSON = async (name, def) => { try { const t = await invoke('read_store', { name }); return t ? JSON.parse(t) : def; } catch { return def; } };
  const writeJSON = (name, obj) => invoke('write_store', { name, json: JSON.stringify(obj) });
  const notify = (title, body) => { try { tauri.notification.sendNotification({ title, body }); } catch (e) { console.warn('notify failed', e); } };

  const fmtTime = (hhmm) => { if (!hhmm) return ''; let [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${S.pad(m)} ${ap}`; };
  const fmtDate = (ds) => S.parseYMD(ds).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  async function check() {
    const data = (await readJSON('calendar.json', null)) || { events: [], days: {}, settings: {} };
    const fired = await readJSON('notified.json', {});
    const now = Date.now();
    const morning = (data.settings && data.settings.morning) || '09:00';
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const queue = [];
    const due = (key, when, windowMs, title, body) => {
      const w = when.getTime();
      if (!fired[key] && now >= w && now - w < windowMs) { fired[key] = now; queue.push([title, body]); }
    };
    for (let off = -1; off <= 2; off++) {
      const ds = S.ymd(S.addDays(today, off));
      const prev = S.ymd(S.addDays(S.parseYMD(ds), -1));
      for (const ev of data.events || []) {
        if (!S.occursOn(ev, ds) || (ev.doneDates || []).includes(ds)) continue;
        const P = S.PRIORITIES[ev.priority] || S.PRIORITIES.yellow;
        const label = `${P.label}${ev.notes ? ' · ' + ev.notes : ''}`;
        if (ev.time) {
          const start = S.at(ds, ev.time);
          const rem = +ev.remind || 0;
          if (rem > 0) due(`${ev.id}|${ds}|pre`, new Date(start - rem * 60000), 3 * 3600e3, `⏰ ${ev.title}`, `${fmtDate(ds)} at ${fmtTime(ev.time)} — ${label}`);
          due(`${ev.id}|${ds}|start`, start, 2 * 3600e3, `🔔 Now: ${ev.title}`, `${fmtTime(ev.time)} — ${label}`);
        } else {
          due(`${ev.id}|${ds}|day`, S.at(ds, morning), 16 * 3600e3, `📅 Today: ${ev.title}`, label);
          if (+ev.remind >= 1440) due(`${ev.id}|${ds}|pre`, new Date(S.at(ds, morning) - ev.remind * 60000), 16 * 3600e3, `⏰ Coming up: ${ev.title}`, `${fmtDate(ds)} — ${label}`);
        }
        if (ev.priority === 'blue') due(`${ev.id}|${ds}|eve`, S.at(prev, '18:00'), 14 * 3600e3, `🔵 Tomorrow: ${ev.title}`, `${fmtDate(ds)}${ev.time ? ' at ' + fmtTime(ev.time) : ''} — Extremely important`);
      }
      const day = (data.days || {})[ds];
      if (day && day.motive && day.priority) {
        const P = S.PRIORITIES[day.priority] || S.PRIORITIES.yellow;
        due(`day|${ds}|motive`, S.at(ds, morning), 16 * 3600e3, `📌 Today: ${day.motive}`, P.label);
        if (day.priority === 'blue') due(`day|${ds}|eve`, S.at(prev, '18:00'), 14 * 3600e3, `🔵 Tomorrow: ${day.motive}`, `${fmtDate(ds)} — Extremely important`);
      }
    }
    for (const k of Object.keys(fired)) if (now - fired[k] > 10 * 86400e3) delete fired[k];
    if (queue.length) {
      await writeJSON('notified.json', fired);
      queue.slice(0, 6).forEach(([t, b], i) => setTimeout(() => notify(t, b), i * 1500));
      if (queue.length > 6) setTimeout(() => notify('DeskCal', `+${queue.length - 6} more reminders — open the calendar`), 9500);
    }
  }

  window.DeskCalReminders = { check, notify };
  setInterval(check, 30 * 1000);
  setTimeout(check, 1500);

  // Launch at login, switched on once. Users can turn it off from Windows Settings > Apps > Startup.
  try {
    if (!localStorage.getItem('deskcal-autostart-set') && tauri.autostart) {
      tauri.autostart.enable().then(() => localStorage.setItem('deskcal-autostart-set', '1')).catch(() => {});
    }
  } catch {}
})();
