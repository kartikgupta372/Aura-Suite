import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isoDate } from '../lib/db'
import { supabase, roomCode, type Peer } from '../lib/room'

const FOCUS = 25 * 60, BREAK = 5 * 60
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export default function Study() {
  const [mode, setMode] = useState<'focus' | 'break'>('focus')
  const [left, setLeft] = useState(FOCUS)
  const [running, setRunning] = useState(false)
  const endsAt = useRef<number | null>(null)
  const [nick, setNick] = useState(() => localStorage.getItem('campus-nick') ?? '')
  const [code, setCode] = useState('')
  const [joined, setJoined] = useState<string | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const ch = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const log = useLiveQuery(() => db.focus.toArray())

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      const rem = Math.max(0, Math.round(((endsAt.current ?? 0) - Date.now()) / 1000))
      setLeft(rem)
      if (rem === 0) {
        setRunning(false)
        if (mode === 'focus') { void db.focus.add({ date: isoDate(), minutes: 25 } as never); setMode('break'); setLeft(BREAK) } else { setMode('focus'); setLeft(FOCUS) }
        endsAt.current = null
      }
    }, 500)
    return () => clearInterval(t)
  }, [running, mode])

  const share = (state: Peer['state'], ends: number | null) => { void ch.current?.track({ name: nick || 'Guest', state, endsAt: ends } satisfies Peer) }
  const start = () => { endsAt.current = Date.now() + left * 1000; setRunning(true); share(mode, endsAt.current) }
  const pause = () => { setRunning(false); setLeft(Math.max(0, Math.round(((endsAt.current ?? 0) - Date.now()) / 1000))); endsAt.current = null; share('idle', null) }
  const reset = () => { setRunning(false); endsAt.current = null; setLeft(mode === 'focus' ? FOCUS : BREAK); share('idle', null) }

  const join = (c: string) => {
    const room = c.trim().toUpperCase()
    if (!room || !nick.trim()) return
    localStorage.setItem('campus-nick', nick.trim())
    const channel = supabase.channel(`campus-room-${room}`, { config: { presence: { key: nick.trim() + '-' + Math.random().toString(36).slice(2, 6) } } })
    channel.on('presence', { event: 'sync' }, () => setPeers(Object.values(channel.presenceState()).flat().map((p) => p as unknown as Peer)))
    channel.subscribe(async (s) => { if (s === 'SUBSCRIBED') await channel.track({ name: nick.trim(), state: running ? mode : 'idle', endsAt: endsAt.current } satisfies Peer) })
    ch.current = channel; setJoined(room)
  }
  const leave = async () => { if (ch.current) await supabase.removeChannel(ch.current); ch.current = null; setJoined(null); setPeers([]) }
  useEffect(() => () => { if (ch.current) void supabase.removeChannel(ch.current) }, [])

  const week = (log ?? []).filter((l) => l.date >= isoDate(new Date(Date.now() - 6 * 86400000))).reduce((s, l) => s + l.minutes, 0)
  const todayMin = (log ?? []).filter((l) => l.date === isoDate()).reduce((s, l) => s + l.minutes, 0)

  return (
    <>
      <h1>Study Room</h1>
      <p className="sub">A 25 minute focus timer. Share a room code and friends see when you are focusing.</p>
      <div className="card">
        <div className={`meta ${mode === 'focus' ? 'safe' : 'edge'}`} style={{ textAlign: 'center' }}>{mode === 'focus' ? 'Focus' : 'Break'}</div>
        <div className="timer num" role="timer" aria-live="off">{fmt(left)}</div>
        <div className="btns">
          {running ? <button className="btn primary" onClick={pause}>Pause</button> : <button className="btn primary" onClick={start}>{left === (mode === 'focus' ? FOCUS : BREAK) ? 'Start' : 'Resume'}</button>}
          <button className="btn" onClick={reset}>Reset</button>
        </div>
        <div className="meta num" style={{ marginTop: 14, textAlign: 'center' }}>{todayMin} min focused today. {week} min this week.</div>
      </div>

      <h2>Study together</h2>
      {!joined ? (
        <div className="card">
          <div className="field"><label htmlFor="nk">Your nickname</label><input id="nk" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={20} /></div>
          <div className="field"><label htmlFor="rc">Room code</label><input id="rc" value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} placeholder="Ask a friend, or make one" /></div>
          <div className="btns">
            <button className="btn" disabled={!nick.trim() || !code.trim()} onClick={() => join(code)}>Join room</button>
            <button className="btn primary" disabled={!nick.trim()} onClick={() => join(roomCode())}>Create a room</button>
          </div>
          <p className="meta">Rooms only show nicknames and timer state while you are in them. Nothing is saved.</p>
        </div>
      ) : (
        <div className="card">
          <div className="row"><div><div className="meta">Room code, share it</div><div className="big num">{joined}</div></div><button className="btn fit" onClick={leave}>Leave</button></div>
          <ul className="people">
            {peers.map((p, i) => (
              <li key={i}><span>{p.name}</span><span className={p.state === 'focus' ? 'safe' : 'meta'}>{p.state === 'focus' ? 'Focusing' : p.state === 'break' ? 'On a break' : 'Idle'}</span></li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
