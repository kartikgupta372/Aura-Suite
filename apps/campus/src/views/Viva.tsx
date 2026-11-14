import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isoDate } from '../lib/db'
import { coverage, review } from '../lib/viva'

type Rec = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start(): void; stop(): void }
const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition

export default function Viva() {
  const today = isoDate()
  const cards = useLiveQuery(() => db.viva.toArray())
  const [q, setQ] = useState('')
  const [pts, setPts] = useState('')
  const [idx, setIdx] = useState<number | null>(null)
  const [answer, setAnswer] = useState('')
  const [checked, setChecked] = useState(false)
  const [listening, setListening] = useState(false)
  const rec = useRef<Rec | null>(null)
  if (!cards) return null
  const due = cards.filter((c) => c.due <= today)
  const card = idx != null ? due[idx] : undefined

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const points = pts.split('\n').map((p) => p.trim()).filter(Boolean)
    if (!q.trim() || points.length === 0) return
    await db.viva.add({ question: q.trim(), points, box: 1, due: today } as never)
    setQ(''); setPts('')
  }
  const ask = () => { if (card && 'speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(card.question)) } }
  const listen = () => {
    if (!Ctor) return
    const r = new Ctor(); r.lang = 'en-IN'; r.continuous = true; r.interimResults = false
    r.onresult = (e) => setAnswer(Array.from(e.results).map((x) => x[0].transcript).join(' '))
    r.onend = () => setListening(false)
    rec.current = r; setListening(true); r.start()
  }
  const stop = () => rec.current?.stop()
  const finish = async (good: boolean) => {
    if (!card) return
    await db.viva.update(card.id, review(card.box, good, today))
    setAnswer(''); setChecked(false)
    setIdx(due.length - 1 > (idx ?? 0) ? idx : null) // the answered card leaves "due", so the next one takes this index
  }
  const result = card && checked ? coverage(card.points, answer) : null

  if (card) {
    return (
      <>
        <button className="btn quiet fit" onClick={() => { setIdx(null); setAnswer(''); setChecked(false) }}>Back</button>
        <h1>Viva practice</h1>
        <p className="sub">{due.length} due today. Say your answer out loud, then check which key points you covered.</p>
        <div className="card">
          <p className="q">{card.question}</p>
          <div className="btns">
            <button className="btn" onClick={ask}>Hear the question</button>
            {Ctor && (listening ? <button className="btn primary" onClick={stop}>Stop listening</button> : <button className="btn primary" onClick={listen}>Answer by voice</button>)}
          </div>
          <div className="field" style={{ marginTop: 14 }}><label htmlFor="ans">Your answer</label>
            <textarea id="ans" rows={5} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={Ctor ? 'Speak, or type here' : 'Type your answer'} /></div>
          {!checked && <button className="btn primary" style={{ width: '100%' }} onClick={() => setChecked(true)}>Check my answer</button>}
        </div>
        {result && (
          <div className="card">
            <div className={`big num ${result.score >= 0.7 ? 'safe' : result.score >= 0.4 ? 'edge' : 'danger'}`}>{Math.round(result.score * 100)}% of key points</div>
            {result.results.map((r, i) => <div key={i} className={`check ${r.covered ? 'safe' : 'danger'}`}>{r.covered ? 'Covered:' : 'Missed:'} {r.point}</div>)}
            <div className="btns">
              <button className="btn" onClick={() => finish(false)}>Ask me again tomorrow</button>
              <button className="btn primary" onClick={() => finish(true)}>I know this</button>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <h1>Viva Coach</h1>
      <p className="sub">Write a question and the key points a good answer needs. The coach asks it, listens, and shows what you missed. Questions you miss come back sooner.</p>
      <div className="card">
        <div className="row"><div><div className="name">{due.length} due today</div><div className="meta">{cards.length} questions in total</div></div>
          <button className="btn primary fit" disabled={due.length === 0} onClick={() => setIdx(0)}>Start practice</button></div>
      </div>
      <h2>Add a question</h2>
      <form className="card" onSubmit={add}>
        <div className="field"><label htmlFor="vq">Question</label><input id="vq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Difference between TCP and UDP?" /></div>
        <div className="field"><label htmlFor="vp">Key points, one per line</label><textarea id="vp" rows={4} value={pts} onChange={(e) => setPts(e.target.value)} placeholder={'TCP is connection oriented\nUDP is faster but unreliable'} /></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>Add question</button>
      </form>
      {cards.length > 0 && <h2>All questions</h2>}
      {cards.map((c) => (
        <div className="card row" key={c.id}>
          <div className="grow"><div className="name">{c.question}</div><div className="meta">Box {c.box} of 5. Next {c.due <= today ? 'today' : c.due}</div></div>
          <button className="btn fit quiet" aria-label={`Delete question ${c.question}`} onClick={() => confirm('Delete this question?') && db.viva.delete(c.id)}>Delete</button>
        </div>
      ))}
    </>
  )
}
