import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { stories } from '../lib/stories'
import { starsToNext } from '../lib/plant'
import Plant from './Plant'

export default function Home({ childId, name, onPick, onExit }: { childId: number; name: string; onPick: (id: string) => void; onExit: () => void }) {
  const mine = useLiveQuery(() => db.progress.where('childId').equals(childId).toArray(), [childId])
  if (!mine) return null
  const stars = mine.reduce((s, p) => s + p.stars, 0)
  const next = starsToNext(stars)
  return (
    <>
      <div className="row"><button className="btn small" onClick={onExit}>Not {name}?</button><span className="stars" aria-label={`${stars} stars`}>⭐ {stars}</span></div>
      <h1>Hi {name}!</h1>
      <Plant stars={stars} />
      <p className="sub" style={{ textAlign: 'center' }}>{next > 0 ? `${next} more star${next > 1 ? 's' : ''} and your plant grows!` : 'Your plant is in full bloom!'}</p>
      <h2>Pick a story</h2>
      <div className="stories">
        {stories.map((s) => {
          const done = new Set(mine.filter((p) => p.storyId === s.id).map((p) => p.line)).size
          return (
            <button key={s.id} className="chunk" style={{ background: s.color }} onClick={() => onPick(s.id)}>
              <div style={{ fontWeight: 800, fontSize: '1.3rem' }}>{s.title}</div>
              <div className="meta" style={{ color: 'var(--ink)' }}>{done} of {s.lines.length} lines {done === s.lines.length ? '✓' : ''}</div>
            </button>
          )
        })}
      </div>
    </>
  )
}
