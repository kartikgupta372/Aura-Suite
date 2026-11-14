import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, setPref, prefsFrom } from '../lib/db'
import { cgpa, marksStanding, sgpa } from '../lib/grades'
import Seg from '../components/Seg'

const GRADES: [string, number][] = [['O', 10], ['A+', 10], ['A', 9], ['B+', 8], ['B', 7], ['C', 6], ['D', 5], ['F', 0]]

function Internal() {
  const data = useLiveQuery(async () => ({ subjects: await db.subjects.toArray(), items: await db.assessments.toArray() }))
  const [sid, setSid] = useState<number | ''>('')
  const [title, setTitle] = useState('')
  const [score, setScore] = useState('')
  const [max, setMax] = useState('25')
  const [weight, setWeight] = useState('25')
  if (!data) return null
  const { subjects, items } = data
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (sid === '' || !title.trim() || !(+max > 0)) return
    await db.assessments.add({ subjectId: sid, title: title.trim(), score: score === '' ? null : +score, max: +max, weight: +weight || +max } as never)
    setTitle(''); setScore('')
  }
  return (
    <>
      <p className="sub">Enter your CIE, quiz and assignment marks. Set your goal for each subject and see what you need in the rest.</p>
      {subjects.length === 0 && <div className="card empty">Add subjects in the Attendance tab first.</div>}
      {subjects.map((s) => {
        const mine = items.filter((i) => i.subjectId === s.id)
        const total = s.totalMarks ?? 100, goal = s.goalPct ?? 60
        const st = marksStanding(mine, total, goal)
        return (
          <div className="card" key={s.id}>
            <div className="row"><div className="name">{s.name}</div><div className="num meta">{st.earned.toFixed(1)} of {st.done} marks so far</div></div>
            {mine.map((i) => (
              <div className="cls" key={i.id}><span>{i.title} <span className="meta num">{i.score ?? 'pending'} / {i.max} (counts {i.weight})</span></span>
                <button className="btn fit quiet" aria-label={`Remove ${i.title}`} onClick={() => db.assessments.delete(i.id)}>Remove</button></div>
            ))}
            <p className={`note ${st.status === 'out-of-reach' ? 'bad' : st.status === 'possible' && (st.neededPct ?? 0) > 75 ? 'warn' : ''}`} style={{ margin: '12px 0 0' }}>
              {st.status === 'reached' ? `You already have your ${goal}% goal.` : st.status === 'out-of-reach' ? `${goal}% is out of reach now. Lower the goal below to see what is possible.` : st.status === 'no-data' ? `To reach ${goal}% of ${total} you need about ${st.neededPct?.toFixed(0)}% in everything still to come.` : `To reach ${goal}% you need ${st.neededPct!.toFixed(0)}% of the remaining ${st.remaining} marks.`}
            </p>
            <details><summary>Goal and total marks</summary>
              <div className="grid2">
                <div className="field"><label htmlFor={`g${s.id}`}>Goal (%)</label><input id={`g${s.id}`} type="number" defaultValue={goal} onBlur={(e) => db.subjects.update(s.id, { goalPct: Math.min(100, Math.max(1, +e.target.value || 60)) })} /></div>
                <div className="field"><label htmlFor={`m${s.id}`}>Total marks, internal and end sem</label><input id={`m${s.id}`} type="number" defaultValue={total} onBlur={(e) => db.subjects.update(s.id, { totalMarks: Math.max(1, +e.target.value || 100) })} /></div>
              </div>
            </details>
          </div>
        )
      })}
      <h2>Add marks</h2>
      <form className="card" onSubmit={add}>
        <div className="field"><label htmlFor="ms">Subject</label><select id="ms" value={sid} onChange={(e) => setSid(e.target.value === '' ? '' : +e.target.value)}><option value="">Choose a subject</option>{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label htmlFor="mt">Test or assignment</label><input id="mt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CIE-1" /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="mc">Marks you got (blank if pending)</label><input id="mc" type="number" step="0.5" value={score} onChange={(e) => setScore(e.target.value)} /></div>
          <div className="field"><label htmlFor="mm">Out of</label><input id="mm" type="number" value={max} onChange={(e) => setMax(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="mw">Counts for how many marks in the subject total</label><input id="mw" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>Add marks</button>
      </form>
    </>
  )
}

function Gpa() {
  const data = useLiveQuery(async () => ({ grades: await db.grades.toArray(), prefs: prefsFrom(await db.settings.toArray()) }))
  const [name, setName] = useState('')
  const [credits, setCredits] = useState('4')
  const [letter, setLetter] = useState('A')
  if (!data) return null
  const { grades, prefs } = data
  const gp = (l: string) => GRADES.find((g) => g[0] === l)?.[1] ?? 0
  const sem = sgpa(grades), cum = cgpa(prefs.prevCgpa, prefs.prevCredits, grades)
  return (
    <>
      <p className="sub">Add this semester’s subjects with their credits and expected grades to see your SGPA and CGPA. Uses a 10-point scale.</p>
      <div className="card">
        <div className="grid2">
          <div><div className="meta">SGPA</div><div className="big num safe">{grades.length ? sem.toFixed(2) : '–'}</div></div>
          <div><div className="meta">CGPA after this semester</div><div className="big num">{grades.length && (prefs.prevCredits > 0 || grades.length) ? cum.toFixed(2) : '–'}</div></div>
        </div>
      </div>
      <div className="card">
        {grades.length === 0 && <div className="meta">No subjects yet.</div>}
        {grades.map((g) => (
          <div className="cls" key={g.id}><span>{g.name} <span className="meta num">{g.credits} credits, {GRADES.find((x) => x[1] === g.gp)?.[0] ?? g.gp}</span></span>
            <button className="btn fit quiet" aria-label={`Remove ${g.name}`} onClick={() => db.grades.delete(g.id)}>Remove</button></div>
        ))}
      </div>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); if (name.trim()) { await db.grades.add({ name: name.trim(), credits: +credits || 0, gp: gp(letter) } as never); setName('') } }}>
        <div className="field"><label htmlFor="gn">Subject</label><input id="gn" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="gc">Credits</label><input id="gc" type="number" value={credits} onChange={(e) => setCredits(e.target.value)} /></div>
          <div className="field"><label htmlFor="gg">Grade</label><select id="gg" value={letter} onChange={(e) => setLetter(e.target.value)}>{GRADES.map(([l, p]) => <option key={l} value={l}>{l} ({p})</option>)}</select></div>
        </div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>Add subject</button>
      </form>
      <h2>Earlier semesters</h2>
      <div className="card grid2">
        <div className="field"><label htmlFor="pc">CGPA so far</label><input id="pc" type="number" step="0.01" defaultValue={prefs.prevCgpa || ''} onBlur={(e) => setPref('prevCgpa', +e.target.value || 0)} /></div>
        <div className="field"><label htmlFor="pr">Credits so far</label><input id="pr" type="number" defaultValue={prefs.prevCredits || ''} onBlur={(e) => setPref('prevCredits', +e.target.value || 0)} /></div>
      </div>
    </>
  )
}

export default function Marks() {
  const [tab, setTab] = useState<'internal' | 'gpa'>('internal')
  return (
    <>
      <h1>Marks and grades</h1>
      <Seg value={tab} onChange={setTab} items={[{ id: 'internal', label: 'Internal marks' }, { id: 'gpa', label: 'SGPA and CGPA' }]} />
      {tab === 'internal' ? <Internal /> : <Gpa />}
    </>
  )
}
