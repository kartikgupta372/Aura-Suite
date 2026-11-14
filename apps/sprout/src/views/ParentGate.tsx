import { useMemo, useState } from 'react'

/** A small sum a young child cannot do. Not a security boundary, a speed bump. */
export default function ParentGate({ onPass, onCancel }: { onPass: () => void; onCancel: () => void }) {
  const [a, b] = useMemo(() => [7 + Math.floor(Math.random() * 6), 6 + Math.floor(Math.random() * 7)], [])
  const [v, setV] = useState('')
  const [bad, setBad] = useState(false)
  return (
    <form className="chunk static" onSubmit={(e) => { e.preventDefault(); +v === a * b ? onPass() : (setBad(true), setV('')) }}>
      <h1>Parents only</h1>
      <div className="field"><label htmlFor="g">What is {a} × {b}?</label><input id="g" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} /></div>
      {bad && <p className="try" role="alert">That is not right. Try again.</p>}
      <div className="btns"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button className="btn go" type="submit">Continue</button></div>
    </form>
  )
}
