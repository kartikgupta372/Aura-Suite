(() => {
  const S = window.Shared;
  const { PRIORITIES, ymd, parseYMD, addDays, occursOn, topPriority } = S;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const PKEYS = ['yellow', 'orange', 'red', 'blue'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fmtTime = (hhmm) => { if (!hhmm) return 'All day'; let [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; };
  const longDate = (ds) => parseYMD(ds).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekday = (ds) => parseYMD(ds).toLocaleDateString('en-IN', { weekday: 'long' });
  const shortDate = (ds) => parseYMD(ds).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const REMIND_TXT = { 0: 'at time', 5: '5 min before', 15: '15 min before', 30: '30 min before', 60: '1 hr before', 180: '3 hrs before', 1440: '1 day before' };
  const REPEAT_TXT = { daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year' };

  let data = { version: 1, days: {}, events: [], settings: { morning: '09:00', weekStart: 0 } };
  const todayStr = () => ymd(new Date());
  let selected = todayStr();
  let viewY = new Date().getFullYear(), viewM = new Date().getMonth();
  let view = 'month';
  let query = '';
  let editingId = null;
  let formPriority = 'yellow';
  let pending = null; // parsed quick-add awaiting confirmation

  // ---------- persistence ----------
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    try { localStorage.setItem('deskcal-mirror', JSON.stringify(data)); } catch {}
    saveTimer = setTimeout(async () => {
      try {
        await window.__TAURI__.core.invoke('write_store', { name: 'calendar.json', json: JSON.stringify(data), day: todayStr() });
        if (window.DeskCalReminders) window.DeskCalReminders.check();
      } catch { flash('Could not save to disk. Your changes are kept in this window; try again in a moment.'); }
    }, 250);
  }
  async function load() {
    try {
      const text = await window.__TAURI__.core.invoke('read_store', { name: 'calendar.json' });
      if (text) data = JSON.parse(text);
    } catch {
      try { data = JSON.parse(localStorage.getItem('deskcal-mirror')) || data; } catch {}
    }
    data.days ||= {}; data.events ||= []; data.settings ||= { morning: '09:00', weekStart: 0 };
  }
  const day = (ds, create) => { if (!data.days[ds] && create) data.days[ds] = { motive: '', priority: '' }; return data.days[ds]; };
  const eventsOn = (ds) => data.events.filter((e) => occursOn(e, ds)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const isDone = (ev, ds) => (ev.doneDates || []).includes(ds);
  function dayPriority(ds) {
    const d = data.days[ds];
    // daily routines only colour a date if they are marked above Normal
    const list = eventsOn(ds).filter((e) => !isDone(e, ds) && !(e.repeat === 'daily' && (e.priority || 'yellow') === 'yellow')).map((e) => e.priority || 'yellow');
    if (d && d.priority) list.push(d.priority);
    else if (d && d.motive) list.push('yellow');
    return topPriority(list);
  }
  const hasTT = (ds) => { const t = data.days[ds]?.timetable; return t && (t.rows.some((r) => r.some((c) => c && c.trim())) || t.cols.some((c) => c && c.trim())); };

  // ---------- small UI helpers ----------
  let toastTimer;
  function flash(msg, actionLabel, action) {
    const el = $('toast');
    el.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
    el.hidden = false;
    if (actionLabel) el.querySelector('button').onclick = () => { action(); el.hidden = true; };
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 5000);
  }
  function chips(container, current, onPick, allowNone) {
    const opts = (allowNone ? [['', 'None', '#ffffff']] : []).concat(PKEYS.map((k) => [k, PRIORITIES[k].label, PRIORITIES[k].color]));
    container.innerHTML = opts.map(([k, l, c]) => `<button type="button" class="chip${current === k ? ' on' : ''}" data-k="${k}" style="--c:${c}"><i${k ? '' : ' style="border:1px solid #ccc"'}></i>${l}</button>`).join('');
    container.querySelectorAll('.chip').forEach((b) => (b.onclick = () => onPick(b.dataset.k)));
  }

  // ---------- month grid ----------
  function renderMonth() {
    const ws = +data.settings.weekStart || 0;
    $('monthLabel').textContent = new Date(viewY, viewM, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    $('dow').innerHTML = [0, 1, 2, 3, 4, 5, 6].map((i) => `<div>${DOW[(i + ws) % 7]}</div>`).join('');
    const first = new Date(viewY, viewM, 1);
    const start = addDays(first, -((first.getDay() - ws + 7) % 7));
    const t = todayStr();
    const q = query.toLowerCase();
    let html = '';
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), ds = ymd(d);
      const dd = data.days[ds];
      const evs = eventsOn(ds);
      const p = dayPriority(ds);
      const hit = q && (evs.some((e) => (e.title + ' ' + (e.notes || '')).toLowerCase().includes(q)) || (dd?.motive || '').toLowerCase().includes(q));
      const cls = ['cell', d.getMonth() !== viewM && 'other', ds === t && 'today', ds === selected && 'sel', p && 'p-' + p].filter(Boolean).join(' ');
      const shown = evs.slice(0, 3).map((e) => `<div class="ev${isDone(e, ds) ? ' done' : ''}"><i style="--c:${PRIORITIES[e.priority || 'yellow'].color}"></i>${e.time ? esc(fmtTime(e.time).replace(':00', '')) + ' ' : ''}${esc(e.title)}</div>`).join('');
      html += `<div class="${cls}" data-d="${ds}" tabindex="0" style="${q && !hit ? 'opacity:.35' : ''}" title="${esc(shortDate(ds))} — double-click for timetable">
        <span class="num">${d.getDate()}</span>
        ${hasTT(ds) ? '<svg class="ttmark" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>' : ''}
        ${dd?.motive ? `<div class="motive">${esc(dd.motive)}</div>` : ''}
        ${shown}${evs.length > 3 ? `<div class="more">+${evs.length - 3} more</div>` : ''}
      </div>`;
    }
    $('grid').innerHTML = html;
  }

  // ---------- agenda ----------
  function renderAgenda() {
    const start = parseYMD(todayStr());
    const q = query.toLowerCase();
    let html = '', any = false;
    for (let i = 0; i < 60; i++) {
      const ds = ymd(addDays(start, i));
      const dd = data.days[ds];
      let items = eventsOn(ds).map((e) => ({ e }));
      if (dd?.motive) items.unshift({ motive: dd.motive, p: dd.priority || 'yellow' });
      if (q) items = items.filter((x) => ((x.motive || x.e.title) + ' ' + (x.e?.notes || '')).toLowerCase().includes(q));
      if (!items.length) continue;
      any = true;
      html += `<h3>${i === 0 ? 'Today · ' : i === 1 ? 'Tomorrow · ' : ''}${esc(shortDate(ds))}</h3>`;
      html += items.map((x) => x.motive
        ? `<div class="item" data-d="${ds}"><span class="t">Motive</span><span class="dot" style="--c:${PRIORITIES[x.p].color}"></span><b>${esc(x.motive)}</b></div>`
        : `<div class="item" data-d="${ds}"><span class="t">${esc(fmtTime(x.e.time))}</span><span class="dot" style="--c:${PRIORITIES[x.e.priority || 'yellow'].color}"></span><span style="${isDone(x.e, ds) ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(x.e.title)}</span></div>`).join('');
    }
    $('agendaView').innerHTML = any ? html : '<div class="empty">Nothing in the next 60 days. Use the mic or type above to add something.</div>';
    $('agendaView').querySelectorAll('.item').forEach((el) => (el.onclick = () => { selectDate(el.dataset.d); setView('month'); }));
  }

  // ---------- side panel ----------
  function renderSide() {
    $('dayName').textContent = (selected === todayStr() ? 'Today · ' : '') + weekday(selected);
    $('dayDate').textContent = longDate(selected);
    const dd = data.days[selected];
    if (document.activeElement !== $('motive')) $('motive').value = dd?.motive || '';
    chips($('dayChips'), dd?.priority || '', (k) => { const x = day(selected, true); x.priority = k; save(); renderAll(); }, true);

    const evs = eventsOn(selected);
    $('evCount').textContent = evs.length ? `${evs.length}` : '';
    $('eventList').innerHTML = evs.length ? evs.map((e) => `
      <li class="${isDone(e, selected) ? 'done' : ''}" data-id="${e.id}">
        <input type="checkbox" ${isDone(e, selected) ? 'checked' : ''} aria-label="Mark done">
        <span class="dot" style="--c:${PRIORITIES[e.priority || 'yellow'].color}"></span>
        <div class="info"><div class="ttl">${esc(e.title)}</div>
          <div class="sub">${esc(fmtTime(e.time))}${e.time || +e.remind >= 1440 ? ' · remind ' + esc(REMIND_TXT[e.remind] || e.remind + ' min before') : ''}${e.repeat && e.repeat !== 'none' ? ' · ' + REPEAT_TXT[e.repeat] : ''}${e.notes ? ' · ' + esc(e.notes) : ''}</div></div>
        <button class="icon edit" title="Edit" aria-label="Edit"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        <button class="icon del" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>
      </li>`).join('') : '<li class="empty">No events yet.</li>';
    $('eventList').querySelectorAll('li[data-id]').forEach((li) => {
      const ev = data.events.find((x) => x.id === li.dataset.id);
      li.querySelector('input').onchange = (e) => {
        ev.doneDates ||= [];
        if (e.target.checked) ev.doneDates.push(selected); else ev.doneDates = ev.doneDates.filter((d) => d !== selected);
        save(); renderAll();
      };
      li.querySelector('.del').onclick = () => {
        const idx = data.events.indexOf(ev);
        data.events.splice(idx, 1); save(); renderAll();
        flash(`Deleted “${ev.title}”`, 'Undo', () => { data.events.splice(idx, 0, ev); save(); renderAll(); });
      };
      li.querySelector('.edit').onclick = () => startEdit(ev);
    });
    chips($('evChips'), formPriority, (k) => { formPriority = k; renderSide(); });
    renderUpcoming();
  }

  function renderUpcoming() {
    const start = parseYMD(todayStr()); const out = [];
    for (let i = 0; i < 30 && out.length < 8; i++) {
      const ds = ymd(addDays(start, i));
      const dd = data.days[ds];
      if (dd?.motive && dd.priority && PRIORITIES[dd.priority].rank >= 2) out.push({ ds, title: dd.motive, p: dd.priority, time: '' });
      for (const e of eventsOn(ds)) if (!isDone(e, ds) && !(e.repeat === 'daily' && (e.priority || 'yellow') === 'yellow')) out.push({ ds, title: e.title, p: e.priority || 'yellow', time: e.time });
    }
    $('upcoming').innerHTML = out.length ? out.slice(0, 8).map((x) => `<li data-d="${x.ds}"><span class="when">${x.ds === todayStr() ? 'Today' : esc(shortDate(x.ds).replace(/,/g, ''))}${x.time ? '<br>' + esc(fmtTime(x.time)) : ''}</span><span class="dot" style="--c:${PRIORITIES[x.p].color}"></span><span class="what">${esc(x.title)}</span></li>`).join('') : '<li class="empty">Nothing coming up in the next 30 days.</li>';
    $('upcoming').querySelectorAll('li[data-d]').forEach((li) => (li.onclick = () => selectDate(li.dataset.d)));
  }

  function renderAll() { if (view === 'month') renderMonth(); else renderAgenda(); renderSide(); }

  function selectDate(ds) {
    const changedDay = ds !== selected;
    selected = ds;
    const d = parseYMD(ds);
    const cell = $('grid').querySelector(`.cell[data-d="${ds}"]`);
    if (changedDay) resetForm();
    if (view === 'month' && cell && d.getFullYear() === viewY && d.getMonth() === viewM) {
      // same month: just move the highlight so double-clicks keep working
      $('grid').querySelectorAll('.cell.sel').forEach((c) => c.classList.remove('sel'));
      cell.classList.add('sel');
      renderSide();
      return;
    }
    viewY = d.getFullYear(); viewM = d.getMonth();
    renderAll();
  }

  // ---------- event form ----------
  function resetForm() {
    editingId = null; formPriority = 'yellow';
    $('evTitle').value = ''; $('evTime').value = ''; $('evRemind').value = '15'; $('evRepeat').value = 'none'; $('evNotes').value = '';
    $('evSave').textContent = 'Add event'; $('evCancel').hidden = true;
  }
  function startEdit(ev) {
    editingId = ev.id; formPriority = ev.priority || 'yellow';
    $('evTitle').value = ev.title; $('evTime').value = ev.time || ''; $('evRemind').value = String(ev.remind ?? 15);
    $('evRepeat').value = ev.repeat || 'none'; $('evNotes').value = ev.notes || '';
    $('evSave').textContent = 'Save changes'; $('evCancel').hidden = false;
    renderSide(); $('evTitle').focus();
  }
  $('eventForm').onsubmit = (e) => {
    e.preventDefault();
    const title = $('evTitle').value.trim(); if (!title) return;
    const vals = { title, time: $('evTime').value, remind: +$('evRemind').value, repeat: $('evRepeat').value, notes: $('evNotes').value.trim(), priority: formPriority };
    if (editingId) Object.assign(data.events.find((x) => x.id === editingId), vals);
    else data.events.push({ id: uid(), date: selected, created: Date.now(), ...vals });
    resetForm(); save(); renderAll();
  };
  $('evCancel').onclick = () => { resetForm(); renderSide(); };

  $('motive').oninput = () => {
    const x = day(selected, true); x.motive = $('motive').value;
    save(); if (view === 'month') renderMonth(); renderUpcoming();
  };

  // ---------- grid interactions: click = select (motive), double-click = timetable ----------
  let lastClick = { d: null, t: 0 };
  $('grid').addEventListener('click', (e) => {
    const c = e.target.closest('.cell'); if (!c) return;
    const ds = c.dataset.d, now = Date.now();
    const isDouble = lastClick.d === ds && now - lastClick.t < 450;
    lastClick = isDouble ? { d: null, t: 0 } : { d: ds, t: now };
    selectDate(ds);
    if (isDouble) openTimetable(ds);
  });
  $('grid').addEventListener('keydown', (e) => {
    const c = e.target.closest('.cell'); if (!c) return;
    if (e.key === 'Enter') { selectDate(c.dataset.d); openTimetable(c.dataset.d); }
    if (e.key === ' ') { e.preventDefault(); selectDate(c.dataset.d); $('motive').focus(); }
  });
  $('openTT').onclick = () => openTimetable(selected);

  // ---------- timetable ----------
  const TT_HINTS = ['Time', 'Task', 'Details', 'Place', 'Status', 'Notes'];
  const blankTT = () => ({ cols: ['', '', '', '', '', ''], rows: Array.from({ length: 8 }, () => ['', '', '', '', '', '']) });
  let ttDate = null, lastFocus = null;
  function getTT(ds, create) { const d = day(ds, create); if (d && !d.timetable && create) d.timetable = blankTT(); return d?.timetable; }
  function openTimetable(ds) {
    ttDate = ds; lastFocus = document.activeElement;
    $('ttTitle').textContent = `Timetable — ${weekday(ds)}, ${longDate(ds)}`;
    renderTT(); $('ttModal').hidden = false;
    setTimeout(() => $('ttTable').querySelector('td input')?.focus(), 30);
  }
  function closeModal(id) { $(id).hidden = true; renderAll(); lastFocus?.focus?.(); }
  function renderTT() {
    const tt = data.days[ttDate]?.timetable || blankTT();
    const n = tt.cols.length;
    let h = `<thead><tr><th class="rn">#</th>${tt.cols.map((c, i) => `<th><input data-h="${i}" value="${esc(c)}" placeholder="${esc(TT_HINTS[i] || 'Column ' + (i + 1))}" aria-label="Column ${i + 1} heading"></th>`).join('')}</tr></thead><tbody>`;
    tt.rows.forEach((r, ri) => { h += `<tr><td class="rn">${ri + 1}</td>${Array.from({ length: n }, (_, ci) => `<td><input data-r="${ri}" data-c="${ci}" value="${esc(r[ci] || '')}" aria-label="Row ${ri + 1} column ${ci + 1}"></td>`).join('')}</tr>`; });
    $('ttTable').innerHTML = h + '</tbody>';
  }
  $('ttTable').addEventListener('input', (e) => {
    const inp = e.target; const tt = getTT(ttDate, true);
    if (inp.dataset.h != null) tt.cols[+inp.dataset.h] = inp.value;
    else tt.rows[+inp.dataset.r][+inp.dataset.c] = inp.value;
    save();
  });
  $('ttTable').addEventListener('keydown', (e) => {
    const inp = e.target; if (inp.dataset.r == null) return;
    const r = +inp.dataset.r, c = +inp.dataset.c;
    const go = (rr, cc) => $('ttTable').querySelector(`input[data-r="${rr}"][data-c="${cc}"]`)?.focus();
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); go(r + 1, c); }
    if (e.key === 'ArrowUp') { e.preventDefault(); go(r - 1, c); }
  });
  $('ttAddRow').onclick = () => { const tt = getTT(ttDate, true); tt.rows.push(tt.cols.map(() => '')); save(); renderTT(); };
  $('ttDelRow').onclick = () => { const tt = getTT(ttDate, true); if (tt.rows.length > 1) tt.rows.pop(); save(); renderTT(); };
  $('ttAddCol').onclick = () => { const tt = getTT(ttDate, true); if (tt.cols.length < 12) { tt.cols.push(''); tt.rows.forEach((r) => r.push('')); } save(); renderTT(); };
  $('ttDelCol').onclick = () => { const tt = getTT(ttDate, true); if (tt.cols.length > 1) { tt.cols.pop(); tt.rows.forEach((r) => r.pop()); } save(); renderTT(); };
  $('ttClear').onclick = () => {
    const d = data.days[ttDate]; if (!d?.timetable) return;
    const old = d.timetable; delete d.timetable; save(); renderTT();
    flash('Timetable cleared', 'Undo', () => { day(ttDate, true).timetable = old; save(); renderTT(); });
  };
  $('ttCopyPrev').onclick = () => {
    const prev = Object.keys(data.days).filter((k) => k < ttDate && hasTT(k)).sort().pop();
    if (!prev) return flash('No earlier timetable to copy.');
    day(ttDate, true).timetable = JSON.parse(JSON.stringify(data.days[prev].timetable));
    save(); renderTT(); flash(`Copied timetable from ${shortDate(prev)}`);
  };
  $('ttClose').onclick = () => closeModal('ttModal');

  // ---------- quick add (voice + typed) ----------
  function showPreview(p) {
    pending = p;
    const el = $('preview');
    el.hidden = false;
    el.innerHTML = `<div class="pv"><b>${esc(p.title)}</b><div class="meta">${esc(shortDate(p.date))} · ${esc(fmtTime(p.time))}${p.time || p.remind >= 1440 ? ' · remind ' + esc(REMIND_TXT[p.remind] || p.remind + ' min before') : ''}${p.repeat !== 'none' ? ' · ' + REPEAT_TXT[p.repeat] : ''}</div></div>
      <div class="chips" id="pvChips"></div>
      <button class="ghost" id="pvCancel">Discard</button><button class="primary" id="pvAdd">Add to ${esc(shortDate(p.date))}</button>`;
    chips($('pvChips'), p.priority, (k) => { p.priority = k; showPreview(p); });
    $('pvAdd').onclick = commitPending;
    $('pvCancel').onclick = () => { pending = null; el.hidden = true; };
  }
  function commitPending() {
    if (!pending) return;
    const p = pending; pending = null; $('preview').hidden = true; $('quickInput').value = '';
    const ev = { id: uid(), date: p.date, title: p.title, time: p.time, remind: p.remind, repeat: p.repeat, priority: p.priority, notes: '', created: Date.now() };
    data.events.push(ev); save(); selectDate(p.date);
    flash(`Added “${p.title}” on ${shortDate(p.date)}`, 'Undo', () => { data.events = data.events.filter((x) => x !== ev); save(); renderAll(); });
  }
  $('quickForm').onsubmit = (e) => {
    e.preventDefault();
    const txt = $('quickInput').value.trim();
    if (!txt) return;
    if (pending && pending.src === txt) return commitPending();
    const p = S.parseText(txt); p.src = txt; showPreview(p);
  };

  // speech
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  function toggleMic() {
    if (!SR) return flash('Voice input needs Microsoft Edge or Chrome. Type instead — it understands the same phrases.');
    if (listening) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let finalText = '';
    rec.onstart = () => { listening = true; $('micBtn').classList.add('rec'); $('quickInput').value = ''; $('quickInput').placeholder = 'Listening… say the event, date, time and how important it is'; };
    rec.onresult = (ev) => {
      let interim = ''; finalText = '';
      for (const r of ev.results) (r.isFinal ? (finalText += r[0].transcript) : (interim += r[0].transcript));
      $('quickInput').value = (finalText + ' ' + interim).trim();
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') flash('Microphone is blocked. Click the lock icon in the title bar and allow the microphone.');
      else if (ev.error === 'network') flash('Voice needs an internet connection. You can still type.');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') flash('Voice error: ' + ev.error);
    };
    rec.onend = () => {
      listening = false; $('micBtn').classList.remove('rec');
      $('quickInput').placeholder = 'Say or type: “Exam on 20 Nov at 10 am, extremely important”';
      const txt = $('quickInput').value.trim();
      if (txt) { const p = S.parseText(txt); p.src = txt; showPreview(p); }
    };
    rec.start();
  }
  $('micBtn').onclick = toggleMic;

  // ---------- navigation / views ----------
  const shiftMonth = (n) => { const d = new Date(viewY, viewM + n, 1); viewY = d.getFullYear(); viewM = d.getMonth(); renderAll(); };
  $('prev').onclick = () => shiftMonth(-1);
  $('next').onclick = () => shiftMonth(1);
  $('todayBtn').onclick = () => selectDate(todayStr());
  function setView(v) {
    view = v;
    $('viewMonth').classList.toggle('on', v === 'month'); $('viewAgenda').classList.toggle('on', v === 'agenda');
    $('calView').hidden = v !== 'month'; $('agendaView').hidden = v !== 'agenda';
    renderAll();
  }
  $('viewMonth').onclick = () => setView('month');
  $('viewAgenda').onclick = () => setView('agenda');
  $('search').oninput = () => { query = $('search').value.trim(); renderAll(); };
  $('grid').addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > 40 && !e.ctrlKey) { e.preventDefault(); shiftMonth(e.deltaY > 0 ? 1 : -1); } }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('ttModal').hidden) return closeModal('ttModal');
      if (!$('setModal').hidden) return closeModal('setModal');
      if (!$('preview').hidden) { pending = null; $('preview').hidden = true; }
      return;
    }
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || !$('ttModal').hidden || !$('setModal').hidden) return;
    if (e.key === 'ArrowLeft') shiftMonth(-1);
    if (e.key === 'ArrowRight') shiftMonth(1);
    if (e.key.toLowerCase() === 't') selectDate(todayStr());
    if (e.key.toLowerCase() === 'm') toggleMic();
  });
  ['ttModal', 'setModal'].forEach((id) => $(id).addEventListener('mousedown', (e) => { if (e.target.id === id) closeModal(id); }));

  // ---------- settings ----------
  $('settingsBtn').onclick = () => {
    lastFocus = document.activeElement;
    $('setMorning').value = data.settings.morning || '09:00';
    $('setWeek').value = String(data.settings.weekStart || 0);
    $('setModal').hidden = false;
  };
  $('setClose').onclick = () => closeModal('setModal');
  $('setMorning').onchange = () => { data.settings.morning = $('setMorning').value || '09:00'; save(); };
  $('setWeek').onchange = () => { data.settings.weekStart = +$('setWeek').value; save(); renderAll(); };
  $('testNotify').onclick = () => {
    try { window.DeskCalReminders.notify('🔔 DeskCal reminders are working', 'You will get notifications like this for your dates.'); flash('Test notification sent. Look at the bottom-right corner.'); }
    catch { flash('Notifications are not available. Open DeskCal from its installed shortcut.'); }
  };
  $('exportBtn').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `deskcal-backup-${todayStr()}.json`; a.click();
  };
  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async () => {
    const f = $('importFile').files[0]; if (!f) return;
    try {
      const obj = JSON.parse(await f.text());
      if (!Array.isArray(obj.events)) throw new Error();
      const old = data; data = obj; data.days ||= {}; data.settings ||= { morning: '09:00', weekStart: 0 };
      save(); renderAll(); flash('Backup imported', 'Undo', () => { data = old; save(); renderAll(); });
    } catch { flash('That file is not a DeskCal backup.'); }
    $('importFile').value = '';
  };

  // refresh "today" highlight when the date changes while the window stays open
  let lastDay = todayStr();
  setInterval(() => { if (todayStr() !== lastDay) { lastDay = todayStr(); renderAll(); } }, 60000);

  load().then(() => { resetForm(); renderAll(); });
})();
