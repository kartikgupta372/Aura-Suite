import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { stories } from '../lib/stories'
import { matchReading, words, type ReadResult } from '../lib/reading'

type Rec = { lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void }
const W = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition
const say = (text: string) => { if ('speechSynthesis' in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 0.8; u.lang = 'en-IN'; speechSynthesis.speak(u) } }

export default function Reader({ childId, storyId, onExit }: { childId: number; storyId: string; onExit: () => void }) {
  const story = stories.find((s) => s.id === storyId)!
  const [li, setLi] = useState(0)
  const [res, setRes] = useState<ReadResult | null>(null)
  const [listening, setListening] = useState(false)
  const [earned, setEarned] = useState(false)
  const rec = useRef<Rec | null>(null)
  const mine = useLiveQuery(() => db.progress.where('childId').equals(childId).toArray(), [childId])
  const stars = (mine ?? []).reduce((s, p) => s + p.stars, 0)
  const line = story.lines[li]
  const last = li === story.lines.length - 1
  const w = line.split(/\s+/)

  const listen = () => {
    if (!Ctor) return
    const r = new Ctor(); r.lang = 'en-IN'; r.interimResults = false
    r.onresult = async (e) => {
      const m = matchReading(line, e.results[0][0].transcript)
      setRes(m)
      if (m.score >= 0.8) {
        const already = (await db.progress.where('childId').equals(childId).toArray()).some((p) => p.storyId === story.id && p.line === li)
        if (!already) { await db.progress.add({ childId, storyId: story.id, line: li, stars: 1 } as never); setEarned(true) }
      }
    }
    r.onend = () => setListening(false); r.onerror = () => setListening(false)
    rec.current = r; setListening(true); setRes(null); setEarned(false); r.start()
  }
  const next = () => { setRes(null); setEarned(false); if (last) onExit(); else setLi(li + 1) }

  return (
    <>
      <div className="row"><button className="btn small" onClick={onExit}>Back</button><span className="stars" aria-label={`${stars} stars`}>⭐ {stars}</span></div>
      <h1>{story.title}</h1>
      <p className="sub">Line {li + 1} of {story.lines.length}. Tap a word to hear it.</p>
      <div className="chunk static" aria-live="polite">
        <p className="line">
          {w.map((x, i) => (
            <button key={i} className={`word ${res ? (res.hit[i] ? 'hit' : 'miss') : ''}`} onClick={() => say(words(x).join(' '))}>{x}</button>
          ))}
        </p>
      </div>
      {res && <p className={`msg ${res.score >= 0.8 ? 'good' : 'try'}`}>{res.score >= 0.8 ? (earned ? 'Wonderful! You earned a star!' : 'Great reading again!') : 'Nice try! Tap the orange words, then read it again.'}</p>}
      {!Ctor && <p className="try">This browser cannot hear you. You can still tap the words. Chrome or Edge can listen.</p>}
      <div className="btns">
        <button className="btn" onClick={() => say(line)}>Hear it</button>
        <button className="btn go" disabled={!Ctor || listening} onClick={listen}>{listening ? 'Listening…' : 'I will read it'}</button>
      </div>
      <div className="btns"><button className="btn warm" onClick={next}>{last ? 'Finish story' : 'Next line'}</button></div>
    </>
  )
}
