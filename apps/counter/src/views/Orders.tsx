import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, isoDate, wa, type Order } from '../lib/db'
import { parseItems } from '../lib/orders'
import { useT } from '../lib/i18n'

export default function Orders() {
  const { t } = useT()
  const orders = useLiveQuery(() => db.orders.toArray())
  const [msg, setMsg] = useState('')
  const [who, setWho] = useState('')
  const [phone, setPhone] = useState('')
  if (!orders) return null
  const open = orders.filter((o) => o.status !== 'delivered').sort((a, b) => b.id - a.id)
  const done = orders.filter((o) => o.status === 'delivered').sort((a, b) => b.id - a.id).slice(0, 10)
  const preview = parseItems(msg)

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (preview.length === 0) return
    await db.orders.add({ customer: who.trim() || 'Customer', phone: phone.trim(), items: preview, status: 'new', date: isoDate() } as never)
    setMsg(''); setWho(''); setPhone('')
  }
  const advance = (o: Order) => db.orders.update(o.id, { status: o.status === 'new' ? 'packed' : 'delivered' })
  const card = (o: Order) => (
    <div className="card" key={o.id}>
      <div className="row"><div className="name">{o.customer}</div><span className="tag">{t(o.status === 'new' ? 'New' : o.status === 'packed' ? 'Packed' : 'Delivered')}</span></div>
      <ul style={{ margin: '8px 0', paddingLeft: 20 }}>{o.items.map((i, k) => <li key={k}>{i}</li>)}</ul>
      {o.status !== 'delivered' && (
        <div className="btns">
          <button className="btn primary" onClick={() => advance(o)}>{t(o.status === 'new' ? 'Mark packed' : 'Mark delivered')}</button>
          {o.phone && <a className="btn" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none', color: 'inherit' }} target="_blank" rel="noreferrer"
            href={wa(o.phone, `Namaste ${o.customer}, aapka order ${o.status === 'packed' ? 'pack ho gaya hai' : 'mil gaya hai, hum pack kar rahe hain'}.`)}>{t('Message customer')}</a>}
          <button className="btn quiet fit" onClick={() => confirm(`${t('Delete')}?`) && db.orders.delete(o.id)}>{t('Delete')}</button>
        </div>
      )}
    </div>
  )

  return (
    <>
      <h1>{t('Orders')}</h1>
      <form className="card" onSubmit={add}>
        <div className="field"><label htmlFor="om">{t('Paste the customer’s message')}</label>
          <textarea id="om" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={'2 kg atta\n1 litre doodh\n5 maggi'} /></div>
        {preview.length > 0 && <ul style={{ margin: '0 0 12px', paddingLeft: 20 }}>{preview.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        <div className="grid2">
          <div className="field"><label htmlFor="ow">{t('Customer name')}</label><input id="ow" value={who} onChange={(e) => setWho(e.target.value)} /></div>
          <div className="field"><label htmlFor="op">WhatsApp</label><input id="op" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919876543210" /></div>
        </div>
        <button className="btn primary" type="submit" style={{ width: '100%' }} disabled={preview.length === 0}>{t('Add order')}</button>
      </form>
      <h2>{t('Open orders')}</h2>
      {open.length === 0 ? <div className="card empty">{t('No open orders.')}</div> : open.map(card)}
      {done.length > 0 && <><h2>{t('Done')}</h2>{done.map(card)}</>}
    </>
  )
}
