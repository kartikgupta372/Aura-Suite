import { useState } from 'react'
import Marks from './Marks'
import Viva from './Viva'
import Study from './Study'
import More from './More'

type T = 'menu' | 'marks' | 'viva' | 'study' | 'data'
const items: { id: Exclude<T, 'menu'>; name: string; what: string }[] = [
  { id: 'marks', name: 'Marks and grades', what: 'Track CIE marks, see what you need in the end sem, and work out your SGPA and CGPA.' },
  { id: 'viva', name: 'Viva Coach', what: 'Practise oral exam questions out loud and see which key points you missed.' },
  { id: 'study', name: 'Study Room', what: 'A focus timer you can share with friends.' },
  { id: 'data', name: 'Your data', what: 'Back up everything to a file, or clear this device.' },
]

export default function Tools() {
  const [t, setT] = useState<T>('menu')
  if (t === 'menu') return (
    <>
      <h1>Tools</h1>
      <p className="sub">Everything else a student needs.</p>
      {items.map((i) => (
        <button key={i.id} className="card" style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', minHeight: 44 }} onClick={() => setT(i.id)}>
          <div className="name">{i.name}</div><div className="meta">{i.what}</div>
        </button>
      ))}
    </>
  )
  return (
    <>
      <button className="btn quiet fit" onClick={() => setT('menu')} style={{ marginBottom: 8 }}>Back to Tools</button>
      {t === 'marks' && <Marks />}{t === 'viva' && <Viva />}{t === 'study' && <Study />}{t === 'data' && <More />}
    </>
  )
}
