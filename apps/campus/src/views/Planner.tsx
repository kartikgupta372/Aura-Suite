import { useState } from 'react'
import { db, type TaskKind } from '../lib/db'
import { addDays } from '../lib/dates'
import { useCampus } from '../lib/useCampus'

const fmt = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const daysTo = (iso: string, today: string) => Math.round((new Date(iso + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
const KINDS: TaskKind[] = ['assignment', 'lab record', 'project', 'other']

export default function Planner() {
  const c = useCampus()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [subjectId, setSubjectId] = useState<number | ''>('')
  const [kind, setKind] = useState<TaskKind>('assignment')
  if (!c) return null

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !due) return
    await db.tasks.add({ title: title.trim(), due, done: false, kind, subjectId: subjectId === '' ? undefined : subjectId } as never)
    setTitle(''); setDue('')
  }
  const subName = (id?: number) => c.subjects.find((s) => s.id === id)?.name
  const open = c.tasks.filter((t) => !t.done).sort((a, b) => a.due.localeCompare(b.due))
  const overdue = open.filter((t) => t.due < c.today)
  const week = Array.from({ length: 7 }, (_, i) => addDays(c.today, i))
  const exams = c.exams.filter((e) => e.date >= c.today).sort((a, b) => a.date.localeCompare(b.date))

  return (
    <>
      <h1>Planner</h1>
      <p className="sub">Your week in one place: classes, deadlines, exams and what to study today.</p>

      {overdue.length > 0 && <div className="note bad"><b>{overdue.length} overdue:</b> {overdue.map((t) => t.title).join('; ')}</div>}

      {exams.length > 0 && (
        <>
          <h2>Study today</h2>
          {exams.map((e) => {
            const left = Math.max(1, daysTo(e.date, c.today))
            const todo = e.topics.filter((t) => !t.done)
            const n = Math.ceil(todo.length / left)
            return (
              <div className="card" key={e.id}>
                <div className="row"><div className="name">{e.subject}: {e.title}</div><div className={`num ${left <= 3 ? 'danger' : left <= 7 ? 'edge' : 'safe'}`} style={{ fontWeight: 700 }}>{daysTo(e.date, c.today) === 0 ? 'Today' : `${daysTo(e.date, c.today)} days`}</div></div>
                {e.topics.length === 0 ? <div className="meta">Add topics in the Exams tab to get a daily plan.</div>
                  : todo.length === 0 ? <div className="safe">Every topic covered.</div>
                  : <div className="meta" style={{ marginTop: 6 }}>Cover {n} {n === 1 ? 'topic' : 'topics'} today: <b style={{ color: 'var(--text)' }}>{todo.slice(0, n).map((t) => t.name).join(', ')}</b>. {todo.length} left in total.</div>}
              </div>
            )
          })}
        </>
      )}

      <h2>This week</h2>
      <div className="card">
        {week.map((d) => {
          const classes = c.upcoming.filter((o) => o.date === d)
          const tasks = open.filter((t) => t.due === d)
          const ex = exams.filter((e) => e.date === d)
          const hol = c.holidays.find((h) => h.date === d)
          const free = c.plan?.freeDays.includes(d)
          return (
            <div className="day" key={d}>
              <h3>{d === c.today ? 'Today' : fmt(d)} {hol && <span className="meta">{hol.name}</span>} {free && <span className="tag safe" style={{ marginLeft: 6 }}>Free day</span>}</h3>
              {ex.map((e) => <div className="cls danger" key={e.id}><b>Exam: {e.subject} {e.title}</b></div>)}
              {tasks.map((t) => <div className="cls edge" key={t.id}><span>Due: {t.title}</span></div>)}
              {classes.length === 0 && !hol && ex.length === 0 && tasks.length === 0 && <div className="meta">Nothing scheduled.</div>}
              {classes.map((o) => {
                const sk = c.plan?.skips.has(`${d}|${o.slotId}`)
                return <div className="cls" key={o.slotId}><span><span className="num meta">{o.start}</span> {c.subjects.find((s) => s.id === o.subjectId)?.name}</span>{sk && <span className="safe" style={{ fontWeight: 600 }}>Can skip</span>}</div>
              })}
            </div>
          )
        })}
      </div>

      <h2>Deadlines</h2>
      <div className="card">
        {open.length === 0 && <div className="meta">Nothing due. Add assignments, lab records and projects below.</div>}
        {open.map((t) => {
          const dd = daysTo(t.due, c.today)
          return (
            <div className="cls" key={t.id} style={{ minHeight: 48 }}>
              <label className="check" style={{ flex: 1 }}><input type="checkbox" checked={false} onChange={() => db.tasks.update(t.id, { done: true })} />
                <span>{t.title}<span className="meta"> {subName(t.subjectId) ? `· ${subName(t.subjectId)} ` : ''}· {t.kind}</span></span></label>
              <span className={`num ${dd < 0 ? 'danger' : dd <= 2 ? 'edge' : 'meta'}`}>{dd < 0 ? `${-dd}d late` : dd === 0 ? 'Today' : dd === 1 ? 'Tomorrow' : fmt(t.due)}</span>
            </div>
          )
        })}
        {c.tasks.some((t) => t.done) && <div className="btns"><button className="btn quiet fit" onClick={() => db.tasks.filter((t) => t.done).delete()}>Clear completed</button></div>}
      </div>

      <h2>Add a deadline</h2>
      <form className="card" onSubmit={add}>
        <div className="field"><label htmlFor="tt">What is due</label><input id="tt" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Maths assignment 2" /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="td">Due date</label><input id="td" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <div className="field"><label htmlFor="tk">Type</label><select id="tk" value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>{KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="ts">Subject (optional)</label><select id="ts" value={subjectId} onChange={(e) => setSubjectId(e.target.value === '' ? '' : +e.target.value)}><option value="">None</option>{c.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>Add deadline</button>
      </form>
    </>
  )
}
