import { useState } from 'react'
import { db, setPref } from '../../lib/db'
import { addDays, eachDay } from '../../lib/dates'
import { loadSample } from '../../lib/sample'
import type { Campus } from '../../lib/useCampus'

export default function Setup({ c }: { c: Campus }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [hname, setHname] = useState('')
  const addHoliday = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!from) return
    const last = to && to >= from ? to : from
    const have = new Set(c.holidays.map((h) => h.date))
    for (const d of eachDay(from, last)) if (!have.has(d)) await db.holidays.add({ date: d, name: hname.trim() || 'Holiday' } as never)
    setFrom(''); setTo(''); setHname('')
  }
  const hs = [...c.holidays].sort((a, b) => a.date.localeCompare(b.date)).filter((h) => h.date >= addDays(c.today, -1))
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your semester</h2>
        <div className="grid2">
          <div className="field"><label htmlFor="ss">Starts</label><input id="ss" type="date" defaultValue={c.prefs.semStart} onBlur={(e) => setPref('semStart', e.target.value)} /></div>
          <div className="field"><label htmlFor="se">Last teaching day</label><input id="se" type="date" defaultValue={c.prefs.semEnd} onBlur={(e) => setPref('semEnd', e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="mt">Default minimum attendance (%)</label><input id="mt" type="number" min={1} max={99} defaultValue={c.prefs.target} onBlur={(e) => setPref('target', Math.min(99, Math.max(1, +e.target.value || 75)))} /></div>
        <p className="meta" style={{ margin: 0 }}>Most universities check attendance at the end of the semester, so the planner works out how many of the remaining classes you can miss.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Holidays and breaks</h2>
        {hs.length === 0 && <div className="meta" style={{ marginBottom: 12 }}>No upcoming holidays added. Classes on these days are left out of the count.</div>}
        {hs.map((h) => (
          <div className="cls" key={h.id}><span><span className="num">{new Date(h.date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span> <span className="meta">{h.name}</span></span>
            <button className="btn fit quiet" aria-label={`Remove ${h.name} ${h.date}`} onClick={() => db.holidays.delete(h.id)}>Remove</button></div>
        ))}
        <form onSubmit={addHoliday} style={{ marginTop: 12 }}>
          <div className="grid2">
            <div className="field"><label htmlFor="hf">From</label><input id="hf" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="field"><label htmlFor="ht">To (optional)</label><input id="ht" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="hn">Name</label><input id="hn" value={hname} onChange={(e) => setHname(e.target.value)} placeholder="Diwali break" /></div>
          <button className="btn primary" type="submit" style={{ width: '100%' }}>Add holiday</button>
        </form>
      </div>

      {c.subjects.length === 0 && (
        <div className="card">
          <div className="name">Just looking around?</div>
          <p className="meta">Fill the app with a sample semester to see the forecast and skip planner working. You can delete it all from the Tools tab.</p>
          <button className="btn" onClick={loadSample}>Load sample semester</button>
        </div>
      )}
    </>
  )
}
