import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { standing, tone } from '../lib/attendance'

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function Subjects() {
  const data = useLiveQuery(async () => ({ subjects: await db.subjects.toArray(), slots: await db.slots.toArray(), records: await db.records.toArray() }))
  const [name, setName] = useState('')
  const [target, setTarget] = useState(75)
  const [slotFor, setSlotFor] = useState<number | null>(null)
  const [day, setDay] = useState(1)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('10:00')
  if (!data) return null
  const { subjects, slots, records } = data

  const addSubject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await db.subjects.add({ name: name.trim(), target } as never)
    setName('')
  }
  const addSlot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (slotFor == null || end <= start) return
    await db.slots.add({ subjectId: slotFor, day, start, end } as never)
    setSlotFor(null)
  }
  const removeSlot = (id: number) => db.slots.delete(id)
  const removeSubject = async (id: number, n: string) => {
    if (!confirm(`Delete ${n}, its timetable and all its records? This cannot be undone.`)) return
    await db.transaction('rw', db.subjects, db.slots, db.records, async () => {
      await db.subjects.delete(id)
      await db.slots.where('subjectId').equals(id).delete()
      await db.records.where('subjectId').equals(id).delete()
    })
  }

  return (
    <>
      <h1>Attendance</h1>
      <p className="sub">Your standing in each subject. Cancelled classes never count.</p>
      {subjects.length === 0 && <div className="card empty">No subjects yet. Add your first one below.</div>}
      {subjects.map((s) => {
        const st = standing(records.filter((r) => r.subjectId === s.id), s.target)
        const t = tone(st, s.target)
        const mine = slots.filter((x) => x.subjectId === s.id).sort((a, b) => a.day - b.day || a.start.localeCompare(b.start))
        return (
          <div className="card" key={s.id}>
            <div className="row">
              <div className="grow"><div className="name">{s.name}</div><div className="meta num">{st.attended} of {st.total} attended. Target {s.target}%</div></div>
              <div className={`big num ${t}`}>{st.pct.toFixed(1)}%</div>
            </div>
            <div className={`bar ${t}`} aria-hidden><i style={{ width: `${Math.min(100, st.pct)}%` }} /></div>
            <div className={`meta ${t}`} style={{ marginTop: 10 }}>
              {st.mustAttend > 0 ? `Attend the next ${st.mustAttend} classes to reach ${s.target}%.` : `Safe to miss ${st.canSkip} more.`}
            </div>
            {mine.map((x) => (
              <div className="row meta" key={x.id} style={{ marginTop: 6 }}>
                <span className="num">{days[x.day]} {x.start} to {x.end}</span>
                <button className="btn fit quiet" aria-label={`Remove ${days[x.day]} ${x.start} class`} onClick={() => removeSlot(x.id)}>Remove</button>
              </div>
            ))}
            <div className="btns">
              <button className="btn" onClick={() => setSlotFor(slotFor === s.id ? null : s.id)}>Add class time</button>
              <button className="btn quiet" onClick={() => removeSubject(s.id, s.name)}>Delete subject</button>
            </div>
            {slotFor === s.id && (
              <form onSubmit={addSlot} style={{ marginTop: 14 }}>
                <div className="field"><label htmlFor="day">Day</label>
                  <select id="day" value={day} onChange={(e) => setDay(+e.target.value)}>{days.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></div>
                <div className="grid2">
                  <div className="field"><label htmlFor="st">Starts</label><input id="st" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
                  <div className="field"><label htmlFor="en">Ends</label><input id="en" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
                </div>
                <button className="btn primary" type="submit" style={{ width: '100%' }}>Save class time</button>
              </form>
            )}
          </div>
        )
      })}
      <h2>Add a subject</h2>
      <form onSubmit={addSubject} className="card">
        <div className="field"><label htmlFor="sn">Subject name</label><input id="sn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Networks" /></div>
        <div className="field"><label htmlFor="tg">Minimum attendance (%)</label><input id="tg" type="number" min={1} max={99} value={target} onChange={(e) => setTarget(+e.target.value)} /></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>Add subject</button>
      </form>
    </>
  )
}
