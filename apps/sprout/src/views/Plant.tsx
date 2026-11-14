import { stageOf } from '../lib/plant'

export default function Plant({ stars }: { stars: number }) {
  const s = stageOf(stars)
  return (
    <svg className="plant" width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={`Your plant, stage ${s + 1} of 5`}>
      <ellipse cx="100" cy="186" rx="52" ry="8" fill="#2b2140" opacity=".15" />
      <path d="M64 140h72l-9 42H73z" fill="#e07a3f" stroke="#2b2140" strokeWidth="4" strokeLinejoin="round" />
      <rect x="58" y="130" width="84" height="16" rx="6" fill="#f0955a" stroke="#2b2140" strokeWidth="4" />
      {s === 0 && <ellipse cx="100" cy="130" rx="10" ry="6" fill="#8a5a2b" stroke="#2b2140" strokeWidth="3" />}
      {s >= 1 && <path d="M100 130V100" stroke="#2b2140" strokeWidth="5" strokeLinecap="round" />}
      {s >= 1 && <path d="M100 104q-24-4-26-26 24-2 26 26z" fill="#7bd88f" stroke="#2b2140" strokeWidth="4" strokeLinejoin="round" />}
      {s >= 2 && <path d="M100 100V66" stroke="#2b2140" strokeWidth="5" strokeLinecap="round" />}
      {s >= 2 && <path d="M100 96q24-4 26-26-24-2-26 26z" fill="#7bd88f" stroke="#2b2140" strokeWidth="4" strokeLinejoin="round" />}
      {s >= 3 && <path d="M100 82q-26 0-34-22 26-4 34 22z" fill="#4fc46b" stroke="#2b2140" strokeWidth="4" strokeLinejoin="round" />}
      {s >= 3 && <path d="M100 70q26-2 32-24-26-4-32 24z" fill="#4fc46b" stroke="#2b2140" strokeWidth="4" strokeLinejoin="round" />}
      {s >= 4 && (
        <g>
          <path d="M100 66V46" stroke="#2b2140" strokeWidth="5" strokeLinecap="round" />
          {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="100" cy="26" rx="9" ry="14" fill="#ff8fa3" stroke="#2b2140" strokeWidth="3" transform={`rotate(${a} 100 40)`} />)}
          <circle cx="100" cy="40" r="9" fill="#ffd166" stroke="#2b2140" strokeWidth="3" />
        </g>
      )}
    </svg>
  )
}
