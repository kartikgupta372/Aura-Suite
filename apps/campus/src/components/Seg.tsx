export default function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string }[] }) {
  return (
    <div className="seg2" role="group">
      {items.map((i) => <button key={i.id} aria-pressed={value === i.id} onClick={() => onChange(i.id)}>{i.label}</button>)}
    </div>
  )
}
