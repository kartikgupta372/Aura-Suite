import { db } from '../lib/db'

export default function More() {
  const exportAll = async () => {
    const data = { subjects: await db.subjects.toArray(), slots: await db.slots.toArray(), records: await db.records.toArray(), exams: await db.exams.toArray(), viva: await db.viva.toArray(), focus: await db.focus.toArray() }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    a.download = 'aura-campus-backup.json'
    a.click()
  }
  const wipe = async () => {
    if (!confirm('Delete everything stored in Aura Campus on this device? This cannot be undone.')) return
    await Promise.all([db.subjects.clear(), db.slots.clear(), db.records.clear(), db.exams.clear(), db.viva.clear(), db.focus.clear()])
  }
  return (
    <>
      <h1>About your data</h1>
      <p className="sub">Everything you enter stays on this device. Study rooms share only your nickname and timer state while you are in a room.</p>
      <div className="card"><div className="name">Back up</div><div className="meta">Download all your attendance, exams, viva questions and focus time as a file.</div>
        <div className="btns"><button className="btn primary" onClick={exportAll}>Download backup</button></div></div>
      <div className="card"><div className="name">Clear this device</div><div className="meta">Remove every subject, record, exam and question.</div>
        <div className="btns"><button className="btn" onClick={wipe}>Delete all data</button></div></div>
      <p className="meta">Aura Campus is part of Aura Suite.</p>
    </>
  )
}
