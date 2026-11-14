import { useState } from 'react'
import Today from './views/Today'
import Attendance from './views/Attendance'
import Planner from './views/Planner'
import Exams from './views/Exams'
import Tools from './views/Tools'

const tabs = [
  { id: 'today', label: 'Today' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'planner', label: 'Planner' },
  { id: 'exams', label: 'Exams' },
  { id: 'tools', label: 'Tools' },
] as const
type Tab = (typeof tabs)[number]['id']

export default function App() {
  const [tab, setTab] = useState<Tab>('today')
  const [key, setKey] = useState(0) // remount Attendance when other screens send the student to a sub-page
  const [start, setStart] = useState<'overview' | 'skip' | 'timetable' | 'setup'>('overview')
  const go = (t: Tab, sub?: typeof start) => { if (sub) { setStart(sub); setKey((k) => k + 1) } setTab(t) }
  return (
    <div className="shell">
      <nav className="nav" aria-label="Main">
        <div className="brand">Aura Campus</div>
        <ul>
          {tabs.map((t) => (
            <li key={t.id}><button className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button></li>
          ))}
        </ul>
      </nav>
      <main>
        {tab === 'today' && <Today go={go} />}
        {tab === 'attendance' && <Attendance key={key} start={start} />}
        {tab === 'planner' && <Planner />}
        {tab === 'exams' && <Exams />}
        {tab === 'tools' && <Tools />}
      </main>
    </div>
  )
}
