import { useState } from 'react'
import { db, type Subject } from '../../lib/db'
import { DAYS } from '../../lib/dates'
import { scanTimetable, type ScannedClass } from '../../lib/scan'
import type { Campus } from '../../lib/useCampus'

type Row = ScannedClass & { on: boolean }

export default function Timetable({ c }: { c: Campus }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [notes, setNotes] = useState('')
  const [replace, setReplace] = useState(false)
  const [subjectId, setSubjectId] = useState<number | ''>('')
  const [day, setDay] = useState(1)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setBusy(true); setErr(''); setRows(null)
    try {
      const r = await scanTimetable(f)
      if (r.classes.length === 0) setErr('No classes found in that photo. Try a clearer, straight-on picture, or add classes by hand below.')
      else { setRows(r.classes.map((x) => ({ ...x, on: true }))); setNotes(r.notes); setReplace(c.slots.length > 0) }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const patch = (i: number, p: Partial<Row>) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, ...p } : x)))

  const importAll = async () => {
    const use = rows!.filter((r) => r.on && r.subject.trim())
    await db.transaction('rw', db.subjects, db.slots, async () => {
      if (replace) await db.slots.clear()
      const subs = new Map<string, Subject>((await db.subjects.toArray()).map((s) => [s.name.toLowerCase(), s]))
      for (const r of use) {
        const key = r.subject.trim().toLowerCase()
        let s = subs.get(key)
        if (!s) {
          const id = (await db.subjects.add({ name: r.subject.trim(), target: c.prefs.target, kind: r.kind, weight: 2 } as never)) as number
          s = { id, name: r.subject.trim(), target: c.prefs.target }; subs.set(key, s)
        }
        const dup = await db.slots.where('subjectId').equals(s.id).filter((x) => x.day === r.day && x.start === r.start).count()
        if (!dup) await db.slots.add({ subjectId: s.id, day: r.day, start: r.start, end: r.end, room: r.room } as never)
      }
    })
    setRows(null)
  }
  const addSlot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (subjectId === '' || end <= start) return
    await db.slots.add({ subjectId, day, start, end } as never)
  }
  const name = (id: number) => c.subjects.find((s) => s.id === id)?.name ?? ''

  return (
    <>
      <div className="card">
        <div className="name">Scan your timetable</div>
        <p className="meta" style={{ margin: '4px 0 12px' }}>Take a straight-on photo of your class timetable. You get to check and fix everything before it is saved. The photo is read once and not kept.</p>
        <label className="photo">
          <input type="file" accept="image/*" capture="environment" onChange={(e) => onFile(e.target.files?.[0])} disabled={busy} />
          <span>{busy ? 'Reading your timetable…' : 'Take or choose a photo'}</span>
        </label>
        {err && <p className="danger" role="alert" style={{ margin: '12px 0 0' }}>{err}</p>}
      </div>

      {rows && (
        <div className="card">
          <div className="name">Check what we found</div>
          <p className="meta" style={{ margin: '4px 0 12px' }}>{rows.length} classes. Fix anything that looks wrong and untick anything that is not a real class.{notes && ` Note from the scanner: ${notes}`}</p>
          {rows.map((r, i) => (
            <div className="day" key={i}>
              <label className="check"><input type="checkbox" checked={r.on} onChange={(e) => patch(i, { on: e.target.checked })} /><span className={r.on ? '' : 'done'}>{DAYS[r.day]} {r.start} to {r.end}</span></label>
              <div className="grid2">
                <div className="field"><label htmlFor={`rs${i}`}>Subject</label><input id={`rs${i}`} value={r.subject} onChange={(e) => patch(i, { subject: e.target.value })} /></div>
                <div className="field"><label htmlFor={`rk${i}`}>Type</label><select id={`rk${i}`} value={r.kind} onChange={(e) => patch(i, { kind: e.target.value as 'theory' | 'lab' })}><option value="theory">Theory</option><option value="lab">Lab</option></select></div>
              </div>
              <div className="grid2">
                <div className="field"><label htmlFor={`rd${i}`}>Day</label><select id={`rd${i}`} value={r.day} onChange={(e) => patch(i, { day: +e.target.value })}>{DAYS.map((d, k) => <option key={d} value={k}>{d}</option>)}</select></div>
                <div className="grid2">
                  <div className="field"><label htmlFor={`ra${i}`}>From</label><input id={`ra${i}`} type="time" value={r.start} onChange={(e) => patch(i, { start: e.target.value })} /></div>
                  <div className="field"><label htmlFor={`rb${i}`}>To</label><input id={`rb${i}`} type="time" value={r.end} onChange={(e) => patch(i, { end: e.target.value })} /></div>
                </div>
              </div>
            </div>
          ))}
          {c.slots.length > 0 && <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /><span>Replace my current timetable (attendance records are kept)</span></label>}
          <div className="btns"><button className="btn quiet" onClick={() => setRows(null)}>Discard</button><button className="btn primary" onClick={importAll}>Save {rows.filter((r) => r.on).length} classes</button></div>
        </div>
      )}

      <h2>Your weekly timetable</h2>
      {c.slots.length === 0 && <div className="card empty">No classes yet.</div>}
      {c.slots.length > 0 && (
        <div className="card">
          {DAYS.map((d, i) => {
            const list = c.slots.filter((s) => s.day === i).sort((a, b) => a.start.localeCompare(b.start))
            if (!list.length) return null
            return (
              <div className="day" key={d}>
                <h3>{d}</h3>
                {list.map((s) => (
                  <div className="cls" key={s.id}><span><span className="num meta">{s.start}-{s.end}</span> {name(s.subjectId)}</span>
                    <button className="btn fit quiet" aria-label={`Remove ${name(s.subjectId)} on ${d} at ${s.start}`} onClick={() => db.slots.delete(s.id)}>Remove</button></div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <h2>Add a class by hand</h2>
      <form className="card" onSubmit={addSlot}>
        <div className="field"><label htmlFor="as">Subject</label>
          <select id="as" value={subjectId} onChange={(e) => setSubjectId(e.target.value === '' ? '' : +e.target.value)}><option value="">Choose a subject</option>{c.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label htmlFor="ad">Day</label><select id="ad" value={day} onChange={(e) => setDay(+e.target.value)}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
        <div className="grid2">
          <div className="field"><label htmlFor="a1">Starts</label><input id="a1" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div className="field"><label htmlFor="a2">Ends</label><input id="a2" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
        </div>
        <button className="btn primary" type="submit" style={{ width: '100%' }} disabled={subjectId === ''}>Add class</button>
      </form>
    </>
  )
}
