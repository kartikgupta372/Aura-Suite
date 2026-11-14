import { useState } from 'react'
import { useCampus } from '../lib/useCampus'
import Seg from '../components/Seg'
import Overview from './att/Overview'
import Skip from './att/Skip'
import Timetable from './att/Timetable'
import Setup from './att/Setup'

type Sub = 'overview' | 'skip' | 'timetable' | 'setup'

export default function Attendance({ start = 'overview' }: { start?: Sub }) {
  const c = useCampus()
  const [sub, setSub] = useState<Sub>(start)
  if (!c) return null
  return (
    <>
      <h1>Attendance</h1>
      <p className="sub">Know exactly how many classes you can miss, and which ones.</p>
      <Seg value={sub} onChange={setSub} items={[{ id: 'overview', label: 'Subjects' }, { id: 'skip', label: 'Skip planner' }, { id: 'timetable', label: 'Timetable' }, { id: 'setup', label: 'Setup' }]} />
      {sub === 'overview' && <Overview c={c} goSetup={() => setSub('setup')} />}
      {sub === 'skip' && <Skip c={c} goSetup={() => setSub('setup')} />}
      {sub === 'timetable' && <Timetable c={c} />}
      {sub === 'setup' && <Setup c={c} />}
    </>
  )
}
