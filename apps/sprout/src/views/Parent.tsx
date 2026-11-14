import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { stories } from '../lib/stories'

export default function Parent({ onBack }: { onBack: () => void }) {
  const kids = useLiveQuery(() => db.children.toArray())
  const progress = useLiveQuery(() => db.progress.toArray())
  const [n, setN] = useState('')
  if (!kids || !progress) return null
  return (
    <>
      <h1>For parents</h1>
      <p className="sub">We keep only a first name and progress, on this device. Reading practice is never recorded or uploaded. Your child’s voice is handled by the browser’s own speech tool while they read.</p>
      {kids.map((k) => {
        const mine = progress.filter((p) => p.childId === k.id)
        return (
          <div className="chunk static" key={k.id}>
            <div className="row"><div className="grow"><b>{k.name}</b><div className="meta">{mine.reduce((s, p) => s + p.stars, 0)} stars</div></div>
              <button className="btn small" onClick={async () => { if (confirm(`Delete ${k.name} and all their progress?`)) { await db.progress.where('childId').equals(k.id).delete(); await db.children.delete(k.id) } }}>Delete</button></div>
            {stories.map((s) => { const d = new Set(mine.filter((p) => p.storyId === s.id).map((p) => p.line)).size; return d > 0 ? <div className="meta" key={s.id}>{s.title}: {d} of {s.lines.length} lines</div> : null })}
          </div>
        )
      })}
      <form className="chunk static" onSubmit={async (e) => { e.preventDefault(); if (n.trim()) { await db.children.add({ name: n.trim().split(' ')[0] } as never); setN('') } }}>
        <div className="field"><label htmlFor="cn">Add a child (first name only)</label><input id="cn" value={n} onChange={(e) => setN(e.target.value)} maxLength={20} /></div>
        <button className="btn go" type="submit" style={{ width: '100%' }}>Add child</button>
      </form>
      <button className="btn warm" style={{ width: '100%' }} onClick={onBack}>Back to reading</button>
    </>
  )
}
