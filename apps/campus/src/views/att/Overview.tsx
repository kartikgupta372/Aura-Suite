import { useState } from 'react'
import { db, type Subject } from '../../lib/db'
import { standing, tone } from '../../lib/attendance'
import type { Campus } from '../../lib/useCampus'

const weightLabel = { 1: 'Easy to skip', 2: 'Normal', 3: 'Critical, never suggest skipping' } as const

export default function Overview({ c, goSetup }: { c: Campus; goSetup: () => void }) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState(c.prefs.target)
  const [kind, setKind] = useState<'theory' | 'lab'>('theory')
  const [weight, setWeight] = useState<1 | 2 | 3>(2)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await db.subjects.add({ name: name.trim(), target, kind, weight } as never)
    setName('')
  }
  const remove = async (s: Subject) => {
    if (!confirm(`Delete ${s.name}, its timetable and all its records? This cannot be undone.`)) return
    await db.transaction('rw', db.subjects, db.slots, db.records, async () => {
      await db.subjects.delete(s.id); await db.slots.where('subjectId').equals(s.id).delete(); await db.records.where('subjectId').equals(s.id).delete()
    })
  }

  return (
    <>
      {!c.ready && c.subjects.length > 0 && (
        <div className="note warn">Set the semester end date to see how many classes you can still miss. <button className="btn fit" style={{ marginLeft: 8 }} onClick={goSetup}>Open setup</button></div>
      )}
      {c.subjects.length === 0 && <div className="card empty">No subjects yet. Scan your timetable in the Timetable tab, or add a subject below.</div>}
      {c.subjects.map((s) => {
        const st = standing(c.records.filter((r) => r.subjectId === s.id), s.target)
        const t = tone(st, s.target)
        const f = c.plan?.forecasts.get(s.id)
        return (
          <div className="card" key={s.id}>
            <div className="row">
              <div className="grow">
                <div className="name">{s.name} {s.kind === 'lab' && <span className="tag meta">Lab</span>}</div>
                <div className="meta num">{st.attended} of {st.total} attended. Needs {s.target}%</div>
              </div>
              <div className={`big num ${t}`}>{st.pct.toFixed(1)}%</div>
            </div>
            <div className={`bar ${t}`} aria-hidden><i style={{ width: `${Math.min(100, st.pct)}%` }} /></div>
            {f ? (
              f.impossible ? (
                <p className="note bad" style={{ marginTop: 12 }}>Out of reach. Even attending all {f.remaining} remaining classes you finish at {f.bestPct.toFixed(1)}%. Talk to your teacher about condonation early.</p>
              ) : (
                <p className="meta" style={{ margin: '10px 0 0' }}>
                  {f.remaining} classes left. Attend at least <b className="num">{f.minAttend}</b>, so you can miss up to <b className={`num ${f.skipBudget === 0 ? 'danger' : f.skipBudget <= 2 ? 'edge' : 'safe'}`}>{f.skipBudget}</b>. Attend all and you finish at {f.bestPct.toFixed(1)}%.
                </p>
              )
            ) : (
              <p className={`meta ${t}`} style={{ margin: '10px 0 0' }}>{st.mustAttend > 0 ? `Attend the next ${st.mustAttend} classes to reach ${s.target}%.` : `Safe to miss ${st.canSkip} more right now.`}</p>
            )}
            <details>
              <summary>Edit subject</summary>
              <div className="grid2">
                <div className="field"><label htmlFor={`t${s.id}`}>Minimum attendance (%)</label><input id={`t${s.id}`} type="number" min={1} max={99} defaultValue={s.target} onBlur={(e) => db.subjects.update(s.id, { target: Math.min(99, Math.max(1, +e.target.value || 75)) })} /></div>
                <div className="field"><label htmlFor={`k${s.id}`}>Type</label><select id={`k${s.id}`} defaultValue={s.kind ?? 'theory'} onChange={(e) => db.subjects.update(s.id, { kind: e.target.value as 'theory' | 'lab' })}><option value="theory">Theory</option><option value="lab">Lab or practical</option></select></div>
              </div>
              <div className="field"><label htmlFor={`w${s.id}`}>How important is each class?</label>
                <select id={`w${s.id}`} defaultValue={s.weight ?? 2} onChange={(e) => db.subjects.update(s.id, { weight: +e.target.value as 1 | 2 | 3 })}>{([1, 2, 3] as const).map((w) => <option key={w} value={w}>{weightLabel[w]}</option>)}</select></div>
              <button className="btn quiet" onClick={() => remove(s)}>Delete subject</button>
            </details>
          </div>
        )
      })}
      <h2>Add a subject</h2>
      <form onSubmit={add} className="card">
        <div className="field"><label htmlFor="sn">Subject name</label><input id="sn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Computer Networks" /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="tg">Minimum attendance (%)</label><input id="tg" type="number" min={1} max={99} value={target} onChange={(e) => setTarget(+e.target.value)} /></div>
          <div className="field"><label htmlFor="kd">Type</label><select id="kd" value={kind} onChange={(e) => setKind(e.target.value as 'theory' | 'lab')}><option value="theory">Theory</option><option value="lab">Lab or practical</option></select></div>
        </div>
        <div className="field"><label htmlFor="wt">How important is each class?</label><select id="wt" value={weight} onChange={(e) => setWeight(+e.target.value as 1 | 2 | 3)}>{([1, 2, 3] as const).map((w) => <option key={w} value={w}>{weightLabel[w]}</option>)}</select></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>Add subject</button>
      </form>
    </>
  )
}
