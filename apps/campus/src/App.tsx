import { useState } from 'react'
import Today from './views/Today'
import Subjects from './views/Subjects'
import Exams from './views/Exams'
import Viva from './views/Viva'
import Study from './views/Study'
import More from './views/More'

const tabs = [
  { id: 'today', label: 'Today' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'exams', label: 'Exams' },
  { id: 'viva', label: 'Viva' },
  { id: 'study', label: 'Study' },
  { id: 'more', label: 'More' },
] as const
type Tab = (typeof tabs)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">Aura Campus</div>
        <ul>
          {tabs.map((t) => (
            <li key={t.id}>
              <button className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        {tab === 'today' && <Today go={(t) => setTab(t)} />}
        {tab === 'attendance' && <Subjects />}
        {tab === 'exams' && <Exams />}
        {tab === 'viva' && <Viva />}
        {tab === 'study' && <Study />}
        {tab === 'more' && <More />}
      </main>
    </div>
  )
}
