import { useLiveQuery } from 'dexie-react-hooks'
import { db, isoDate, type Status } from '../lib/db'
import { standing, tone } from '../lib/attendance'

export default function Today({ go }: { go: (t: 'attendance') => void }) {
  const date = isoDate()
  const day = new Date().getDay()
  const data = useLiveQuery(async () => ({
    slots: (await db.slots.where('day').equals(day).toArray()).sort((a, b) => a.start.localeCompare(b.start)),
    subjects: await db.subjects.toArray(),
    records: await db.records.toArray(),
  }), [day])
  if (!data) return null
  const { slots, subjects, records } = data

  const mark = async (slotId: number, subjectId: number, status: Status) => {
    const ex = records.find((r) => r.slotId === slotId && r.date === date)
    if (ex?.status === status) return void (await db.records.delete(ex.id))
    if (ex) return void (await db.records.update(ex.id, { status }))
    await db.records.add({ slotId, subjectId, date, status } as never)
  }

  // overall standing across subjects, against the average target
  const overall = standing(records, subjects.length ? Math.round(subjects.reduce((s, x) => s + x.target, 0) / subjects.length) : 75)
  const avgTarget = subjects.length ? Math.round(subjects.reduce((s, x) => s + x.target, 0) / subjects.length) : 75
  const ot = tone(overall, avgTarget)
  const R = 44, C = 2 * Math.PI * R

  return (
    <>
      <h1>{new Date().toLocaleDateString(undefined, { weekday: 'long' })}</h1>
      <p className="sub">{new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>

      {subjects.length > 0 && (
        <div className="card gauge" aria-label={`Overall attendance ${overall.pct.toFixed(0)} percent`}>
          <svg width="108" height="108" viewBox="0 0 108 108" role="img" aria-hidden>
            <circle className="ring-bg" cx="54" cy="54" r={R} fill="none" strokeWidth="10" />
            <circle className={`ring ${ot}`} cx="54" cy="54" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, overall.pct / 100))} transform="rotate(-90 54 54)" />
            <text x="54" y="61" textAnchor="middle" fontSize="24" fontWeight="700" fill="currentColor">{overall.total ? overall.pct.toFixed(0) : '–'}</text>
          </svg>
          <div>
            <div className="name">Overall attendance</div>
            <div className={`meta ${ot}`}>
              {overall.total === 0 ? 'Mark your first class to start.' : overall.mustAttend > 0 ? `Below ${avgTarget}%. Attend the next ${overall.mustAttend} classes.` : overall.canSkip > 0 ? `${overall.canSkip} classes of slack across all subjects.` : `Right on ${avgTarget}%.`}
            </div>
          </div>
        </div>
      )}

      {slots.length === 0 && (
        <div className="card empty">
          {subjects.length === 0 ? (<>Add your subjects and timetable to start tracking.<div className="btns"><button className="btn primary" onClick={() => go('attendance')}>Add subjects</button></div></>) : 'No classes scheduled today.'}
        </div>
      )}

      {slots.map((sl) => {
        const sub = subjects.find((s) => s.id === sl.subjectId)
        if (!sub) return null
        const current = records.find((r) => r.slotId === sl.id && r.date === date)?.status
        const st = standing(records.filter((r) => r.subjectId === sub.id), sub.target)
        const t = tone(st, sub.target)
        return (
          <div className="card" key={sl.id}>
            <div className="row">
              <div className="grow"><div className="name">{sub.name}</div><div className="meta num">{sl.start} to {sl.end}</div></div>
              <div className={`big num ${t}`}>{st.pct.toFixed(0)}%</div>
            </div>
            <div className={`meta ${t}`}>
              {st.total === 0 ? 'No classes recorded yet.' : st.mustAttend > 0 ? `Below ${sub.target}%. Attend the next ${st.mustAttend} to recover.` : st.canSkip > 0 ? `You can miss ${st.canSkip} more and stay above ${sub.target}%.` : `Right on ${sub.target}%. Missing one drops you below.`}
            </div>
            <div className="btns seg" role="group" aria-label={`Mark ${sub.name}`}>
              {(['present', 'absent', 'cancelled'] as Status[]).map((s) => (
                <button key={s} className={`btn ${s} ${current === s ? 'on' : ''}`} aria-pressed={current === s} onClick={() => mark(sl.id, sub.id, s)}>
                  {s === 'present' ? 'Present' : s === 'absent' ? 'Absent' : 'Cancelled'}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
