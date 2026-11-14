import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, balanceOf, rupees, isoDate, wa, type Customer } from '../lib/db'
import { useT } from '../lib/i18n'

export default function Khata() {
  const { t } = useT()
  const data = useLiveQuery(async () => ({ customers: await db.customers.toArray(), entries: await db.entries.toArray() }))
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [open, setOpen] = useState<Customer | null>(null)
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  if (!data) return null
  const { customers, entries } = data
  const owed = customers.map((c) => ({ c, bal: balanceOf(entries.filter((e) => e.customerId === c.id)) })).sort((a, b) => b.bal - a.bal)
  const total = owed.reduce((s, x) => s + Math.max(0, x.bal), 0)

  const addCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await db.customers.add({ name: name.trim(), phone: phone.trim() } as never)
    setName(''); setPhone('')
  }
  const post = async (sign: 1 | -1) => {
    const n = Math.round(parseFloat(amt) * 100)
    if (!open || !(n > 0)) return
    await db.entries.add({ customerId: open.id, amount: sign * n, note: note.trim(), date: isoDate() } as never)
    setAmt(''); setNote('')
  }

  if (open) {
    const mine = entries.filter((e) => e.customerId === open.id).sort((a, b) => b.id - a.id)
    const bal = balanceOf(mine)
    return (
      <>
        <button className="btn quiet fit" onClick={() => setOpen(null)}>{t('Back')}</button>
        <h1>{open.name}</h1>
        <div className="hisaab"><div className={`big num ${bal > 0 ? 'owe' : 'ok'}`}>{bal === 0 ? t('All clear') : rupees(bal)}</div></div>
        <div className="card">
          <div className="field"><label htmlFor="am">{t('Amount (₹)')}</label><input id="am" type="number" inputMode="decimal" min="0" value={amt} onChange={(e) => setAmt(e.target.value)} /></div>
          <div className="field"><label htmlFor="nt">{t('Note')}</label><input id="nt" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <div className="btns">
            <button className="btn" onClick={() => post(1)}>{t('Gave on credit')}</button>
            <button className="btn primary" onClick={() => post(-1)}>{t('Got payment')}</button>
          </div>
          {bal > 0 && open.phone && (
            <div className="btns"><a className="btn" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none', color: 'inherit' }} target="_blank" rel="noreferrer"
              href={wa(open.phone, `Namaste ${open.name}, aapka ${rupees(bal)} baaki hai. Dhanyavaad!`)}>{t('Remind on WhatsApp')}</a></div>
          )}
        </div>
        <ul className="ledger card">
          {mine.map((e) => (
            <li key={e.id}><div><div className="name">{e.note || (e.amount > 0 ? t('Credit') : t('Payment'))}</div><div className="meta num">{e.date}</div></div>
              <div className={`num ${e.amount > 0 ? 'owe' : 'ok'}`}>{e.amount > 0 ? '+' : '−'}{rupees(e.amount)}</div></li>
          ))}
        </ul>
      </>
    )
  }

  return (
    <>
      <h1>{t('Khata')}</h1>
      <div className="hisaab" aria-live="polite">
        <div className="meta">{t('Total to collect')}</div>
        <div className="big num owe">{rupees(total)}</div>
      </div>
      {customers.length === 0 && <div className="card empty">{t('No customers yet. Add the first one below.')}</div>}
      {customers.length > 0 && (
        <ul className="ledger card">
          {owed.map(({ c, bal }) => (
            <li key={c.id}>
              <button style={{ all: 'unset', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', minHeight: 56, cursor: 'pointer' }} onClick={() => setOpen(c)}>
                <span><span className="name">{c.name}</span><br /><span className="meta">{c.phone}</span></span>
                <span className={`num ${bal > 0 ? 'owe' : 'ok'}`} style={{ fontWeight: 700 }}>{bal === 0 ? t('Clear') : rupees(bal)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <h2>{t('Add a customer')}</h2>
      <form className="card" onSubmit={addCustomer}>
        <div className="field"><label htmlFor="cn">{t('Name')}</label><input id="cn" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="cp">{t('WhatsApp number (with country code)')}</label><input id="cp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919876543210" /></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>{t('Add customer')}</button>
      </form>
      <p className="meta">{t('Stored on this phone for now.')}</p>
    </>
  )
}
