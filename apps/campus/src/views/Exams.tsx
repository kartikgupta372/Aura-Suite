import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isoDate, type Exam } from '../lib/db'

const daysLeft = (date: string) => Math.ceil((new Date(date + 'T00:00:00').getTime() - new Date(isoDate() + 'T00:00:00').getTime()) / 86400000)

export default function Exams() {
  const exams = useLiveQuery(() => db.exams.orderBy('date').toArray())
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [topics, setTopics] = useState('')
  if (!exams) return null

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!subject.trim() || !date) return
    const list = topics.split('\n').map((t) => t.trim()).filter(Boolean).map((name) => ({ name, done: false }))
    await db.exams.add({ subject: subject.trim(), title: title.trim() || 'Exam', date, topics: list } as never)
    setSubject(''); setTitle(''); setDate(''); setTopics('')
  }
  const toggle = (ex: Exam, i: number) => db.exams.update(ex.id, { topics: ex.topics.map((t, j) => (j === i ? { ...t, done: !t.done } : t)) })
  const remove = async (ex: Exam) => { if (confirm(`Delete ${ex.subject} ${ex.title}?`)) await db.exams.delete(ex.id) }

  return (
    <>
      <h1>Exams</h1>
      <p className="sub">Add the syllabus topics and you get a daily target.</p>
      {exams.length === 0 && <div className="card empty">No exams yet. Add one below.</div>}
      {exams.map((ex) => {
        const left = daysLeft(ex.date)
        const remaining = ex.topics.filter((t) => !t.done).length
        const perDay = left > 0 ? Math.ceil(remaining / left) : remaining
        const c = left <= 3 ? 'danger' : left <= 7 ? 'edge' : 'safe'
        return (
          <div className="card" key={ex.id}>
            <div className="row">
              <div className="grow"><div className="name">{ex.subject}: {ex.title}</div>
                <div className="meta">{new Date(ex.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</div></div>
              <div className={`big num ${left < 0 ? '' : c}`}>{left < 0 ? 'Over' : left === 0 ? 'Today' : `${left}d`}</div>
            </div>
            {ex.topics.length > 0 && left >= 0 && (
              <div className="meta" style={{ margin: '8px 0' }}>{remaining === 0 ? 'Every topic covered.' : `${remaining} topics left. Cover ${perDay} a day${left > 0 ? '' : ' (exam is today)'}.`}</div>
            )}
            {ex.topics.map((t, i) => (
              <label className="check" key={i}><input type="checkbox" checked={t.done} onChange={() => toggle(ex, i)} /><span className={t.done ? 'done' : ''}>{t.name}</span></label>
            ))}
            <div className="btns"><button className="btn quiet fit" onClick={() => remove(ex)}>Delete exam</button></div>
          </div>
        )
      })}
      <h2>Add an exam</h2>
      <form className="card" onSubmit={add}>
        <div className="field"><label htmlFor="es">Subject</label><input id="es" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="et">Exam name</label><input id="et" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="CIE-3" /></div>
          <div className="field"><label htmlFor="ed">Date</label><input id="ed" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="eo">Topics, one per line</label><textarea id="eo" rows={5} value={topics} onChange={(e) => setTopics(e.target.value)} /></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>Add exam</button>
      </form>
    </>
  )
}
