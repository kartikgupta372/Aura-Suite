import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isoDate, wa } from '../lib/db'
import { useT } from '../lib/i18n'

export default function Bookings() {
  const { t } = useT()
  const items = useLiveQuery(() => db.bookings.toArray())
  const [date, setDate] = useState(isoDate())
  const [time, setTime] = useState('11:00')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [what, setWhat] = useState('')
  if (!items) return null
  const today = isoDate()
  const upcoming = items.filter((b) => b.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const clash = items.some((b) => b.date === date && b.time === time)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || clash) return
    await db.bookings.add({ date, time, name: name.trim(), phone: phone.trim(), what: what.trim() } as never)
    setName(''); setPhone(''); setWhat('')
  }
  return (
    <>
      <h1>{t('Bookings')}</h1>
      <h2>{t('Upcoming')}</h2>
      {upcoming.length === 0 ? <div className="card empty">{t('No upcoming bookings.')}</div> : (
        <ul className="ledger card">
          {upcoming.map((b) => (
            <li key={b.id} style={{ flexWrap: 'wrap', paddingBlock: 10 }}>
              <div className="grow"><div className="name">{b.name}{b.what && `, ${b.what}`}</div><div className="meta num">{b.date === today ? 'Today' : b.date} {b.time}</div></div>
              <div className="row" style={{ gap: 6 }}>
                {b.phone && <a className="btn fit" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none', color: 'inherit' }} target="_blank" rel="noreferrer"
                  href={wa(b.phone, `Namaste ${b.name}, yaad dilana tha: ${b.date === today ? 'aaj' : b.date} ${b.time} baje aapki booking hai.`)}>{t('Remind customer')}</a>}
                <button className="btn fit quiet" onClick={() => confirm(`${t('Delete')}?`) && db.bookings.delete(b.id)}>{t('Delete')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <h2>{t('New booking')}</h2>
      <form className="card" onSubmit={add}>
        <div className="grid2">
          <div className="field"><label htmlFor="bd">{t('Date')}</label><input id="bd" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor="bt">{t('Time')}</label><input id="bt" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        </div>
        {clash && <p className="owe" role="alert" style={{ margin: '0 0 10px' }}>This time is already booked. Pick another.</p>}
        <div className="field"><label htmlFor="bn">{t('Name')}</label><input id="bn" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="bp">WhatsApp</label><input id="bp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="field"><label htmlFor="bw">{t('What for')}</label><input id="bw" value={what} onChange={(e) => setWhat(e.target.value)} /></div>
        </div>
        <button className="btn primary" type="submit" style={{ width: '100%' }} disabled={clash}>{t('Add booking')}</button>
      </form>
    </>
  )
}
