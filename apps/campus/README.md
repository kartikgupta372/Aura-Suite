# Aura Campus

One student app: Attendance Guard, Exam Planner, Viva Coach (next), Study Room (next).
Local-first: data lives on the device (IndexedDB via Dexie). Installable PWA.

## Run
    npm install
    npm run dev        # http://localhost:5173
    npm run build      # production build in dist/

## Done
- Attendance Guard: subjects, weekly timetable, mark present/absent/cancelled, "can miss N" / "attend next N" per subject
- Exam Planner: exams with topic checklist and a daily target

## Next
Sign-in and Supabase sync (`campus` schema), Viva Coach (Groq), Study Room (Realtime), Android wrapper (Capacitor).
