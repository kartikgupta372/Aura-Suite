import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './lib/db'
import ParentGate from './views/ParentGate'
import Parent from './views/Parent'
import Home from './views/Home'
import Reader from './views/Reader'

type Screen = { k: 'who' } | { k: 'gate' } | { k: 'parent' } | { k: 'home'; kid: number } | { k: 'read'; kid: number; story: string }

export default function App() {
  const kids = useLiveQuery(() => db.children.toArray())
  const [s, setS] = useState<Screen>({ k: 'who' })
  if (!kids) return null
  const kidName = (id: number) => kids.find((k) => k.id === id)?.name
  let body
  if (s.k === 'gate') body = <ParentGate onPass={() => setS({ k: 'parent' })} onCancel={() => setS({ k: 'who' })} />
  else if (s.k === 'parent') body = <Parent onBack={() => setS({ k: 'who' })} />
  else if (s.k === 'home' && kidName(s.kid)) body = <Home childId={s.kid} name={kidName(s.kid)!} onPick={(story) => setS({ k: 'read', kid: s.kid, story })} onExit={() => setS({ k: 'who' })} />
  else if (s.k === 'read' && kidName(s.kid)) body = <Reader childId={s.kid} storyId={s.story} onExit={() => setS({ k: 'home', kid: s.kid })} />
  else body = (
    <>
      <h1>Aura Sprout</h1>
      <p className="sub">Who is reading today?</p>
      {kids.length === 0 && <div className="chunk static">A parent needs to add a child first. Tap Parents below.</div>}
      {kids.map((k, i) => (
        <button key={k.id} className="chunk" style={{ background: `var(--c${(i % 5) + 1})`, fontSize: '1.6rem', fontWeight: 800 }} onClick={() => setS({ k: 'home', kid: k.id })}>{k.name}</button>
      ))}
      <button className="btn" style={{ width: '100%', marginTop: 12 }} onClick={() => setS({ k: 'gate' })}>Parents</button>
    </>
  )
  return <main>{body}</main>
}
