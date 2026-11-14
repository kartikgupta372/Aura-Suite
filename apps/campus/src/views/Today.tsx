import { db, type Status } from '../lib/db'
import { loadSample } from '../lib/sample'
import { standing, tone } from '../lib/attendance'
import { useCampus } from '../lib/useCampus'

type Go = (t: 'attendance' | 'planner', sub?: 'overview' | 'skip' | 'timetable' | 'setup') => void
const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const daysTo = (iso: string, today: string) => Math.round((new Date(iso + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)

export default function Today({ go }: { go: Go }) {
  const c = useCampus()
  if (!c) return null
  const { today, subjects, slots, records } = c
  const day = new Date().getDay()
  const todays = slots.filter((s) => s.day === day && !c.hol.has(today)).sort((a, b) => a.start.localeCompare(b.start))

  const mark = async (slotId: number, subjectId: number, status: Status) => {
    const ex = records.find((r) => r.slotId === slotId && r.date === today)
    if (ex?.status === status) return void (await db.records.delete(ex.id))
    if (ex) return void (await db.records.update(ex.id, { status }))
    await db.records.add({ slotId, subjectId, date: today, status } as never)
  }

  const avgTarget = subjects.length ? Math.round(subjects.reduce((s, x) => s + x.target, 0) / subjects.length) : c.prefs.target
  const overall = standing(records, avgTarget)
  const ot = tone(overall, avgTarget)
  const R = 44, C = 2 * Math.PI * R
  const soon = c.tasks.filter((t) => !t.done && daysTo(t.due, today) <= 3).sort((a, b) => a.due.localeCompare(b.due))
  const exams = c.exams.filter((e) => e.date >= today && daysTo(e.date, today) <= 7)
  const nextFree = c.plan?.freeDays.find((d) => d > today)
  const holiday = c.holidays.find((h) => h.date === today)

  return (
    <>
      <h1>{new Date().toLocaleDateString(undefined, { weekday: 'long' })}</h1>
      <p className="sub">{new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>

      {subjects.length === 0 && (
        <div className="card">
          <div className="name">Let’s set up your semester</div>
          <p className="meta" style={{ margin: '4px 0 0' }}>Photograph your timetable and Aura Campus works out how many classes you can miss, and which ones.</p>
          <div className="btns">
            <button className="btn primary" onClick={() => go('attendance', 'timetable')}>Scan my timetable</button>
            <button className="btn" onClick={() => go('attendance', 'setup')}>Set dates first</button>
            <button className="btn quiet" onClick={loadSample}>Try a sample semester</button>
          </div>
        </div>
      )}

      {subjects.length > 0 && !c.ready && (
        <div className="note warn">Add the last teaching day of your semester to unlock the forecast. <button className="btn fit" style={{ marginLeft: 8 }} onClick={() => go('attendance', 'setup')}>Add it</button></div>
      )}

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
              {overall.total === 0 ? 'Mark your first class to start.' : overall.mustAttend > 0 ? `Below ${avgTarget}%. Attend the next ${overall.mustAttend} classes.` : c.plan ? `${c.plan.skips.size} classes are safe to skip this semester.` : `${overall.canSkip} classes of slack across all subjects.`}
            </div>
            {c.plan && c.plan.skips.size > 0 && <button className="btn fit" style={{ marginTop: 8 }} onClick={() => go('attendance', 'skip')}>See skip plan</button>}
          </div>
        </div>
      )}

      {holiday && <div className="note">Today is a holiday: {holiday.name}.</div>}
      {subjects.length > 0 && todays.length === 0 && !holiday && <div className="card empty">No classes today.</div>}

      {todays.map((sl) => {
        const sub = subjects.find((s) => s.id === sl.subjectId)
        if (!sub) return null
        const current = records.find((r) => r.slotId === sl.id && r.date === today)?.status
        const st = standing(records.filter((r) => r.subjectId === sub.id), sub.target)
        const t = tone(st, sub.target)
        const f = c.plan?.forecasts.get(sub.id)
        const canSkip = c.plan?.skips.has(`${today}|${sl.id}`)
        return (
          <div className="card" key={sl.id}>
            <div className="row">
              <div className="grow"><div className="name">{sub.name}</div><div className="meta num">{sl.start} to {sl.end}</div></div>
              <div className={`big num ${t}`}>{st.pct.toFixed(0)}%</div>
            </div>
            <div className={`meta ${f?.impossible ? 'danger' : canSkip ? 'safe' : t}`} style={{ marginTop: 4 }}>
              {st.total === 0 ? 'No classes recorded yet.'
                : canSkip ? `Safe to skip. You would still finish above ${sub.target}%.`
                : f?.impossible ? `Out of reach this semester. Attend every class.`
                : f ? (f.skipBudget === 0 ? 'Attend. You have no room to miss this one.' : f.skipBudget <= c.prefs.buffer ? `Attend. Only ${f.skipBudget} miss left, keep it for emergencies.` : `Better to attend. You can miss up to ${f.skipBudget} this semester.`)
                : st.mustAttend > 0 ? `Below ${sub.target}%. Attend the next ${st.mustAttend} to recover.` : `You can miss ${st.canSkip} more right now.`}
            </div>
            <div className="btns seg" role="group" aria-label={`Mark ${sub.name}`}>
              {(['present', 'absent', 'cancelled'] as Status[]).map((s) => (
                <button key={s} className={`btn ${s} ${current === s ? 'on' : ''}`} aria-pressed={current === s} onClick={() => mark(sl.id, sub.id, s)}>{s === 'present' ? 'Present' : s === 'absent' ? 'Absent' : 'Cancelled'}</button>
              ))}
            </div>
          </div>
        )
      })}

      {(soon.length > 0 || exams.length > 0 || nextFree) && (
        <>
          <h2>Coming up</h2>
          <div className="card">
            {exams.map((e) => <div className="cls" key={e.id}><span><b>{e.subject}: {e.title}</b></span><span className={daysTo(e.date, today) <= 3 ? 'danger' : 'edge'}>{daysTo(e.date, today) === 0 ? 'Today' : `in ${daysTo(e.date, today)} days`}</span></div>)}
            {soon.map((t) => <div className="cls" key={t.id}><span>{t.title}</span><span className={daysTo(t.due, today) < 0 ? 'danger' : 'edge'}>{daysTo(t.due, today) < 0 ? 'Overdue' : daysTo(t.due, today) === 0 ? 'Due today' : daysTo(t.due, today) === 1 ? 'Tomorrow' : fmt(t.due)}</span></div>)}
            {nextFree && <div className="cls"><span>Next safe day off</span><span className="safe" style={{ fontWeight: 600 }}>{fmt(nextFree)}</span></div>}
            <div className="btns"><button className="btn" onClick={() => go('planner')}>Open planner</button></div>
          </div>
        </>
      )}
    </>
  )
}
