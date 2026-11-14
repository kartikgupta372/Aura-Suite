import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, wa } from '../lib/db'
import { useT } from '../lib/i18n'

export default function Stock() {
  const { t } = useT()
  const items = useLiveQuery(() => db.stock.toArray())
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [low, setLow] = useState('5')
  const [sup, setSup] = useState('')
  if (!items) return null
  const lowItems = items.filter((i) => i.qty <= i.low)
  const bySupplier = [...new Set(lowItems.map((i) => i.supplier).filter(Boolean))]

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    await db.stock.add({ name: name.trim(), qty: +qty || 0, low: +low || 0, supplier: sup.trim() } as never)
    setName(''); setQty('')
  }
  return (
    <>
      <h1>{t('Stock')}</h1>
      <h2>{t('Items to order')}</h2>
      {lowItems.length === 0 ? <div className="card empty">{t('Nothing is running low.')}</div> : (
        <div className="card">
          <ul className="ledger">{lowItems.map((i) => <li key={i.id}><span className="name">{i.name}</span><span className="owe num">{i.qty} <span className="tag">{t('Low')}</span></span></li>)}</ul>
          <div className="btns">
            {bySupplier.map((s) => (
              <a key={s} className="btn primary" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} target="_blank" rel="noreferrer"
                href={wa(s, 'Namaste, mujhe ye saaman chahiye:\n' + lowItems.filter((i) => i.supplier === s).map((i) => `- ${i.name}`).join('\n'))}>{t('Order from supplier')} ({s.slice(-4)})</a>
            ))}
          </div>
        </div>
      )}
      <h2>{t('Stock')}</h2>
      <ul className="ledger card">
        {items.map((i) => (
          <li key={i.id}>
            <div className="grow"><div className="name">{i.name}</div><div className="meta">{t('Warn me below')} {i.low}</div></div>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn fit" aria-label={`Decrease ${i.name}`} onClick={() => db.stock.update(i.id, { qty: Math.max(0, i.qty - 1) })}>−</button>
              <span className={`num ${i.qty <= i.low ? 'owe' : ''}`} style={{ minWidth: 34, textAlign: 'center', fontWeight: 700 }}>{i.qty}</span>
              <button className="btn fit" aria-label={`Increase ${i.name}`} onClick={() => db.stock.update(i.id, { qty: i.qty + 1 })}>+</button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="empty" style={{ justifyContent: 'center' }}>{t('Add an item')}</li>}
      </ul>
      <h2>{t('Add an item')}</h2>
      <form className="card" onSubmit={add}>
        <div className="field"><label htmlFor="sn">{t('Item')}</label><input id="sn" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid2">
          <div className="field"><label htmlFor="sq">{t('Quantity')}</label><input id="sq" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="field"><label htmlFor="sl">{t('Warn me below')}</label><input id="sl" type="number" inputMode="numeric" value={low} onChange={(e) => setLow(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="ss">{t('Supplier WhatsApp')}</label><input id="ss" inputMode="tel" value={sup} onChange={(e) => setSup(e.target.value)} placeholder="919876543210" /></div>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>{t('Add item')}</button>
      </form>
    </>
  )
}
