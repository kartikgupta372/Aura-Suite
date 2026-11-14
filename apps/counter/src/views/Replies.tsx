import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, wa } from '../lib/db'
import { fillTemplate } from '../lib/orders'
import { useT } from '../lib/i18n'

const SEED = [
  { title: 'Opening hours', body: 'Namaste {name}! {shop} subah 9 baje se raat 9 baje tak khula hai.' },
  { title: 'Item not available', body: 'Namaste {name}, abhi ye saaman {shop} par available nahi hai. Kal tak aa jayega, main aapko bata dunga.' },
  { title: 'Order ready', body: 'Namaste {name}, aapka order ready hai. Aap {shop} se le sakte hain ya hum bhej denge.' },
  { title: 'Thank you', body: 'Dhanyavaad {name}! {shop} mein phir aaiyega.' },
]

export default function Replies() {
  const { t } = useT()
  const list = useLiveQuery(() => db.replies.toArray())
  const [shop, setShop] = useState(() => localStorage.getItem('counter-shop') ?? '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  useEffect(() => { void db.replies.count().then((n) => { if (n === 0) void db.replies.bulkAdd(SEED as never[]) }) }, [])
  if (!list) return null
  const vars = { name: name.trim() || 'ji', shop: shop.trim() || 'hamari dukaan' }
  const copy = async (id: number, text: string) => { await navigator.clipboard?.writeText(text); setCopied(id); setTimeout(() => setCopied(null), 1500) }

  return (
    <>
      <h1>{t('Replies')}</h1>
      <div className="card">
        <div className="grid2">
          <div className="field"><label htmlFor="rs">{t('Shop name')}</label><input id="rs" value={shop} onChange={(e) => { setShop(e.target.value); localStorage.setItem('counter-shop', e.target.value) }} /></div>
          <div className="field"><label htmlFor="rn">{t('Name')}</label><input id="rn" value={name} onChange={(e) => setName(e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor="rp">{t('Customer number')}</label><input id="rp" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="919876543210" /></div>
      </div>
      <h2>{t('Ready replies')}</h2>
      {list.map((r) => {
        const text = fillTemplate(r.body, vars)
        return (
          <div className="card" key={r.id}>
            <div className="name">{r.title}</div>
            <p style={{ margin: '6px 0', lineHeight: 1.45 }}>{text}</p>
            <div className="btns">
              {phone.replace(/\D/g, '').length >= 10 && <a className="btn primary" style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }} target="_blank" rel="noreferrer" href={wa(phone, text)}>{t('Send on WhatsApp')}</a>}
              <button className="btn" onClick={() => copy(r.id, text)}>{copied === r.id ? t('Copied') : t('Copy')}</button>
              <button className="btn quiet fit" onClick={() => confirm(`${t('Delete')}?`) && db.replies.delete(r.id)}>{t('Delete')}</button>
            </div>
          </div>
        )
      })}
      <h2>{t('Add a reply')}</h2>
      <form className="card" onSubmit={async (e) => { e.preventDefault(); if (title.trim() && body.trim()) { await db.replies.add({ title: title.trim(), body: body.trim() } as never); setTitle(''); setBody('') } }}>
        <div className="field"><label htmlFor="rt">{t('Title')}</label><input id="rt" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor="rb">{t('Message')}</label><textarea id="rb" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Namaste {name}, ..." /></div>
        <p className="meta">Use {'{name}'} and {'{shop}'} to fill in automatically.</p>
        <button className="btn primary" type="submit" style={{ width: '100%' }}>{t('Save reply')}</button>
      </form>
    </>
  )
}
