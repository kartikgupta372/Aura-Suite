// Shared helpers used by both the app window and the background service.
(function (root) {
  const PRIORITIES = {
    yellow: { rank: 1, label: 'Normal', color: '#F5C518' },
    orange: { rank: 2, label: 'Important', color: '#F28C28' },
    red:    { rank: 3, label: 'Very important', color: '#E5383B' },
    blue:   { rank: 4, label: 'Extremely important', color: '#2F6FED' },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const at = (ds, hhmm) => { const d = parseYMD(ds); const [h, m] = (hhmm || '00:00').split(':').map(Number); d.setHours(h, m, 0, 0); return d; };

  function occursOn(ev, ds) {
    if (ev.date === ds) return true;
    const rep = ev.repeat || 'none';
    if (rep === 'none' || ds < ev.date) return false;
    if (ev.until && ds > ev.until) return false;
    const a = parseYMD(ev.date), b = parseYMD(ds);
    if (rep === 'daily') return true;
    if (rep === 'weekly') return a.getDay() === b.getDay();
    if (rep === 'monthly') return a.getDate() === b.getDate();
    if (rep === 'yearly') return a.getDate() === b.getDate() && a.getMonth() === b.getMonth();
    return false;
  }

  function topPriority(list) {
    let best = null;
    for (const p of list) if (p && PRIORITIES[p] && (!best || PRIORITIES[p].rank > PRIORITIES[best].rank)) best = p;
    return best;
  }

  // ---------- Natural-language parser for voice / typed quick add ----------
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const MON_RE = '(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)';
  const monthIndex = (s) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3)));
  const DAYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const NUM_WORDS = { one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,fifteen:15,twenty:20,thirty:30,forty:40,'forty five':45,fortyfive:45 };

  function parseText(text, now = new Date()) {
    let t = ' ' + String(text || '').toLowerCase()
      .replace(/o'?\s?clock/g, '')
      .replace(/[,!?;]/g, ' ')
      .replace(/(\d)\.(\d)/g, '$1:$2')
      .replace(/\./g, ' ')
      .replace(/\b(a m)\b/g, 'am').replace(/\b(p m)\b/g, 'pm')
      .replace(/\s+/g, ' ') + ' ';
    for (const [w, n] of Object.entries(NUM_WORDS)) t = t.replace(new RegExp(`\\b${w}\\b(?= (minutes?|mins?|hours?|days?|weeks?))`, 'g'), n);
    t = t.replace(/\b(an|a) (hour|day|week)\b/g, '1 $2').replace(/\bhalf an hour\b/g, '30 minutes');

    const out = { title: '', date: null, time: '', priority: 'yellow', remind: null, repeat: 'none' };
    const cut = (re) => { t = t.replace(re, ' '); };

    // priority
    const pr = [
      [/\b(extremely|super|very very|really really|most) important\b|\b(critical|top priority|urgent|emergency|blue)\b/, 'blue'],
      [/\b(very|really|highly) important\b|\b(high priority|red)\b/, 'red'],
      [/\b(important|medium priority|orange)\b/, 'orange'],
      [/\b(normal|normally important|low priority|not important|yellow)\b/, 'yellow'],
    ];
    for (const [re, p] of pr) if (re.test(t)) { out.priority = p; cut(new RegExp(re.source, 'g')); break; }
    cut(/\b(mark(ed)? (it )?as|make it|set (it )?as|it is|it's|this is|with)\s+(priority)?(?=\s*$)/g);
    cut(/\bpriority\b/g);

    // reminder offset
    let m = t.match(/\bremind me (\d+) ?(minutes?|mins?|hours?|hrs?|days?|weeks?) (before|early|earlier|in advance|prior)\b/);
    if (!m) m = t.match(/\b(\d+) ?(minutes?|mins?|hours?|hrs?|days?|weeks?) (before|early|earlier|in advance|prior)\b/);
    if (m) {
      const n = +m[1], u = m[2];
      out.remind = u.startsWith('m') ? n : u.startsWith('h') ? n * 60 : u.startsWith('d') ? n * 1440 : n * 10080;
      cut(m[0]);
    }

    // repeat
    if (/\b(every ?day|daily)\b/.test(t)) { out.repeat = 'daily'; cut(/\b(every ?day|daily)\b/g); }
    else if (/\b(every month|monthly)\b/.test(t)) { out.repeat = 'monthly'; cut(/\b(every month|monthly)\b/g); }
    else if (/\b(every year|yearly|annually)\b/.test(t)) { out.repeat = 'yearly'; cut(/\b(every year|yearly|annually)\b/g); }
    else if (/\b(every week|weekly)\b/.test(t)) { out.repeat = 'weekly'; cut(/\b(every week|weekly)\b/g); }
    else if ((m = t.match(/\bevery (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) { out.repeat = 'weekly'; t = t.replace(m[0], ' on ' + m[1]); }

    // explicit times (unambiguous first)
    const setTime = (h, mi) => { out.time = `${pad(h)}:${pad(mi)}`; };
    m = t.match(/\b(?:at |by |from |around )?(\d{1,2})(?:[: ](\d{2}))? ?(am|pm)\b/);
    if (m) { let h = +m[1] % 12; if (m[3] === 'pm') h += 12; setTime(h, +(m[2] || 0)); cut(m[0]); }
    if (!out.time && (m = t.match(/\b(?:at |by |from |around )?([01]?\d|2[0-3]):([0-5]\d)\b/))) { setTime(+m[1], +m[2]); cut(m[0]); }
    if (!out.time && (m = t.match(/\b(?:at |by )?(noon|midday)\b/))) { setTime(12, 0); cut(m[0]); }
    if (!out.time && (m = t.match(/\b(?:at )?midnight\b/))) { setTime(23, 59); cut(m[0]); }

    // dates
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let date = null;
    const fixYear = (d, explicitYear) => (!explicitYear && d < today ? new Date(d.getFullYear() + 1, d.getMonth(), d.getDate()) : d);
    if ((m = t.match(/\b(the )?day after tomorrow\b/))) { date = addDays(today, 2); cut(m[0]); }
    else if ((m = t.match(/\btomorrow\b/))) { date = addDays(today, 1); cut(m[0]); }
    else if ((m = t.match(/\btonight\b/))) { date = today; if (!out.time) setTime(21, 0); cut(m[0]); }
    else if ((m = t.match(/\btoday\b/))) { date = today; cut(m[0]); }
    else if ((m = t.match(/\bin (\d+) (days?|weeks?|months?)\b/))) {
      const n = +m[1];
      date = m[2].startsWith('d') ? addDays(today, n) : m[2].startsWith('w') ? addDays(today, n * 7) : new Date(today.getFullYear(), today.getMonth() + n, today.getDate());
      cut(m[0]);
    }
    else if ((m = t.match(new RegExp(`\\b(?:on )?(?:the )?(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MON_RE}(?: (\\d{4}))?\\b`)))) {
      date = fixYear(new Date(m[3] ? +m[3] : today.getFullYear(), monthIndex(m[2]), +m[1]), !!m[3]); cut(m[0]);
    }
    else if ((m = t.match(new RegExp(`\\b(?:on )?${MON_RE}(?: the)? (\\d{1,2})(?:st|nd|rd|th)?(?: (\\d{4}))?\\b`)))) {
      date = fixYear(new Date(m[3] ? +m[3] : today.getFullYear(), monthIndex(m[1]), +m[2]), !!m[3]); cut(m[0]);
    }
    else if ((m = t.match(/\b(?:on )?(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?\b/))) {
      let y = m[3] ? +m[3] : today.getFullYear(); if (y < 100) y += 2000;
      date = fixYear(new Date(y, +m[2] - 1, +m[1]), !!m[3]); cut(m[0]);
    }
    else if ((m = t.match(/\b(next|this|coming|on)? ?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
      const target = DAYS.indexOf(m[2]);
      let diff = (target - today.getDay() + 7) % 7;
      if (diff === 0 && m[1] === 'next') diff = 7;
      date = addDays(today, diff); cut(m[0]);
    }
    else if ((m = t.match(/\bnext week\b/))) { date = addDays(today, 7); cut(m[0]); }
    else if ((m = t.match(/\bnext month\b/))) { date = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()); cut(m[0]); }
    else if ((m = t.match(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)?\b|\b(?:on )?(\d{1,2})(?:st|nd|rd|th)\b/))) {
      const dn = +(m[1] || m[2]);
      let d = new Date(today.getFullYear(), today.getMonth(), dn);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, dn);
      date = d; cut(m[0]);
    }

    // bare "at 5" after dates are removed
    if (!out.time && (m = t.match(/\b(?:at|by) (\d{1,2})(?::(\d{2}))?\b/))) {
      let h = +m[1]; if (h >= 1 && h <= 6) h += 12; // "at 5" most likely means 5 pm
      if (h <= 23) { setTime(h, +(m[2] || 0)); cut(m[0]); }
    }
    if (!out.time) {
      const parts = [[/\b(in the |this )?morning\b/, 9], [/\b(in the |this )?afternoon\b/, 14], [/\b(in the |this )?evening\b/, 18], [/\b(at |in the )?night\b/, 21]];
      for (const [re, h] of parts) if (re.test(t)) { setTime(h, 0); cut(re); break; }
    }

    if (!date) {
      date = today;
      if (out.time && at(ymd(today), out.time) < now) date = addDays(today, 1);
    }
    out.date = ymd(date);
    if (out.remind == null) out.remind = out.time ? 15 : 0;

    // title cleanup
    let title = t
      .replace(/\b(please|hey|ok|okay)\b/g, ' ')
      .replace(/\b(set (a |an )?reminder( for| to| about)?|remind me( to| about| of)?|add (an |a )?(event|task|reminder)?( for| to| called)?|create (an |a )?(event|task|reminder)?( for| called)?|schedule( a| an)?|put|note( down)?|to my calendar|in my calendar|on my calendar|in the calendar)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const edge = /^(on|at|by|for|the|a|an|and|i have|i've got|there is|there's|is|it|as|to|of|from)\s+|\s+(on|at|by|for|the|and|is|it|as|to|of|from|in)$/;
    for (let i = 0; i < 6 && edge.test(title); i++) title = title.replace(edge, '').trim();
    if (/^(on|at|by|for|the|and|to|in)$/.test(title)) title = '';
    // restore the user's original capitalisation (names, acronyms)
    const orig = {};
    String(text || '').split(/[\s,.!?;]+/).forEach((w) => { if (w && w !== w.toLowerCase()) orig[w.toLowerCase()] = w; });
    title = title.split(' ').map((w) => orig[w] || w).join(' ');
    out.title = title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Reminder';
    return out;
  }

  const api = { PRIORITIES, pad, ymd, parseYMD, addDays, at, occursOn, topPriority, parseText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Shared = api;
})(typeof window !== 'undefined' ? window : globalThis);
