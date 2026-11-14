import { useState } from 'react'
import { LangProvider, useT } from './lib/i18n'
import Khata from './views/Khata'
import Orders from './views/Orders'
import Stock from './views/Stock'
import Bookings from './views/Bookings'
import Replies from './views/Replies'

const tabs = ['Khata', 'Orders', 'Stock', 'Bookings', 'Replies'] as const
type Tab = (typeof tabs)[number]

function Shell() {
  const [tab, setTab] = useState<Tab>('Khata')
  const { t, lang, toggle } = useT()
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">Aura Counter</div>
        <ul>{tabs.map((x) => (
          <li key={x}><button className="tab" aria-current={tab === x ? 'page' : undefined} onClick={() => setTab(x)}>{t(x)}</button></li>
        ))}</ul>
      </nav>
      <main>
        <button className="lang" onClick={toggle} aria-label={lang === 'en' ? 'हिन्दी में बदलें' : 'Switch to English'}>{lang === 'en' ? 'हि' : 'EN'}</button>
        {tab === 'Khata' && <Khata />}
        {tab === 'Orders' && <Orders />}
        {tab === 'Stock' && <Stock />}
        {tab === 'Bookings' && <Bookings />}
        {tab === 'Replies' && <Replies />}
      </main>
    </div>
  )
}
export default function App() { return <LangProvider><Shell /></LangProvider> }
