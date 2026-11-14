import { useState } from 'react'
import { setPref } from '../../lib/db'
import { addDays, DAYS, weekday } from '../../lib/dates'
import { whatIf } from '../../lib/forecast'
import type { Campus } from '../../lib/useCampus'

const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })

export default function Skip({ c, goSetup }: { c: Campus; goSetup: () => void }) {
  const [day, setDay] = useState(addDays(c.today, 1))
  const { plan } = c
  if (!c.ready || !plan) return <div className="card empty">Set your semester end date first, then this page can plan your skips.<div className="btns"><button className="btn primary" onClick={goSetup}>Open setup</button></div></div>
  if (c.slots.length === 0) return <div className="card empty">Add your timetable first. Scanning a photo takes about ten seconds.</div>

  const name = (id: number) => c.subjects.find((s) => s.id === id)?.name ?? ''
  const horizon = addDays(c.today, 27) < c.prefs.semEnd ? addDays(c.today, 27) : c.prefs.semEnd
  const dates = [...new Set(c.upcoming.filter((o) => o.date <= horizon).map((o) => o.date))]
  const must = c.lites.filter((s) => { const f = plan.forecasts.get(s.id); return f && f.remaining > 0 && (f.impossible || f.skipBudget <= c.prefs.buffer) })
  const totalSkips = plan.skips.size
  const wi = whatIf(c.lites, c.slots, c.records, c.today, c.prefs.semEnd, c.hol, day, c.prefs.buffer)
  const freeNext = plan.freeDays.filter((d) => d <= horizon)

  return (
    <>
      <div className="note">
        {totalSkips === 0 ? 'No class is safe to skip right now. Everything counts toward your minimum.' : (
          <>You can safely skip <b className="num">{totalSkips}</b> classes this semester{plan.freeDays.length > 0 && <>, including <b className="num">{plan.freeDays.length}</b> whole {plan.freeDays.length === 1 ? 'day' : 'days'}</>}, and still finish above your minimum in every subject.</>
        )}
      </div>

      {must.length > 0 && (
        <div className="note warn"><b>Attend every class:</b> {must.map((s) => s.name).join(', ')}. {must.some((s) => plan.forecasts.get(s.id)?.impossible) ? 'Some of these are already out of reach.' : 'There is no room left to miss any.'}</div>
      )}

      {freeNext.length > 0 && (
        <>
          <h2>Best days to take off</h2>
          <div className="card">
            {freeNext.slice(0, 5).map((d) => {
              const n = c.upcoming.filter((o) => o.date === d).length
              const joins = [addDays(d, -1), addDays(d, 1)].some((x) => !c.upcoming.some((o) => o.date === x))
              return <div className="day" key={d}><div className="row"><div><b>{fmt(d)}</b><div className="meta">{n} {n === 1 ? 'class' : 'classes'}{joins ? ', joins a break or weekend' : ''}</div></div><span className="tag safe">Safe to skip</span></div></div>
            })}
          </div>
        </>
      )}

      <h2>Next four weeks</h2>
      <div className="card">
        {dates.length === 0 && <div className="meta">No classes in this period.</div>}
        {dates.map((d) => (
          <div className="day" key={d}>
            <h3>{fmt(d)} {plan.freeDays.includes(d) && <span className="tag safe" style={{ marginLeft: 6 }}>Free day</span>}</h3>
            {c.upcoming.filter((o) => o.date === d).map((o) => {
              const sk = plan.skips.get(`${d}|${o.slotId}`)
              const s = c.lites.find((x) => x.id === o.subjectId)
              const f = plan.forecasts.get(o.subjectId)
              const why = sk ? '' : s?.kind === 'lab' ? 'Lab' : s?.weight === 3 ? 'Critical' : f && (f.impossible || f.skipBudget <= c.prefs.buffer) ? 'Must attend' : 'Attend'
              return (
                <div className="cls" key={o.slotId}>
                  <span><span className="num meta">{o.start}</span> {name(o.subjectId)}</span>
                  {sk ? <span className="safe" style={{ fontWeight: 600 }}>Can skip</span> : <span className={why === 'Must attend' ? 'edge' : 'meta'}>{why}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <h2>What if I skip a day?</h2>
      <div className="card">
        <div className="field"><label htmlFor="wd">Day</label><input id="wd" type="date" min={c.today} max={c.prefs.semEnd} value={day} onChange={(e) => setDay(e.target.value)} /></div>
        {wi.length === 0 ? <div className="meta">No classes on {DAYS[weekday(day)]} {fmt(day)}.</div> : wi.map((r) => (
          <div className="cls" key={r.subjectId}>
            <span>{name(r.subjectId)} <span className="meta">({r.classes})</span></span>
            <span className={r.verdict === 'safe' ? 'safe' : r.verdict === 'tight' ? 'edge' : 'danger'} style={{ fontWeight: 600 }}>
              {r.verdict === 'safe' ? `Safe, ${r.budgetAfter} more to spare` : r.verdict === 'tight' ? 'Tight, almost no room left' : 'Drops below your minimum'}
            </span>
          </div>
        ))}
      </div>

      <h2>Your room to skip, by subject</h2>
      <div className="card scroll">
        <table className="t">
          <thead><tr><th>Subject</th><th>Left</th><th>Can miss</th><th>Planned</th></tr></thead>
          <tbody>
            {c.lites.map((s) => {
              const f = plan.forecasts.get(s.id)!
              const used = [...plan.skips.keys()].filter((k) => +k.split('|')[1] && c.slots.find((x) => x.id === +k.split('|')[1])?.subjectId === s.id).length
              return <tr key={s.id}><td>{s.name}</td><td className="num">{f.remaining}</td><td className={`num ${f.impossible ? 'danger' : ''}`}>{f.impossible ? 'None' : f.skipBudget}</td><td className="num">{used}</td></tr>
            })}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="field"><label htmlFor="bf">Keep a reserve for illness and surprises</label>
          <select id="bf" value={c.prefs.buffer} onChange={(e) => setPref('buffer', +e.target.value)}>
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'class' : 'classes'} per subject{n === 1 ? ' (recommended)' : ''}</option>)}
          </select></div>
        <p className="meta" style={{ margin: 0 }}>Labs and subjects marked Critical are never suggested. Holidays are left out of the count.</p>
      </div>
    </>
  )
}
