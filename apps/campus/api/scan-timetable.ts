// Vercel serverless function: reads a photo of a class timetable with Gemini and returns structured classes.
// The image is sent to Google for this one request and is not stored by Aura Campus.
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
const MAX_B64 = 3_500_000 // ~2.6 MB of image; Vercel's body limit is 4.5 MB
const hits = new Map<string, { n: number; t: number }>()

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    classes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          day: { type: 'INTEGER', description: '0 Sunday, 1 Monday ... 6 Saturday' },
          start: { type: 'STRING', description: '24-hour HH:MM' },
          end: { type: 'STRING', description: '24-hour HH:MM' },
          subject: { type: 'STRING' },
          kind: { type: 'STRING', enum: ['theory', 'lab'] },
          room: { type: 'STRING' },
        },
        required: ['day', 'start', 'end', 'subject', 'kind'],
      },
    },
    notes: { type: 'STRING', description: 'Anything unclear, such as unreadable cells' },
  },
  required: ['classes'],
}

const PROMPT = `This is a photo of a college or school class timetable.
List every class period as a separate item with the weekday (0 = Sunday, 1 = Monday, ... 6 = Saturday), start and end time in 24-hour HH:MM (convert 1:00 PM to 13:00; school hours such as 1 to 5 are afternoon), the subject name exactly as written (use the short code if only a code is shown), kind ("lab" for lab, practical, workshop or sessional, otherwise "theory") and room if shown.
If a cell spans several periods (a 3-hour lab), return one item covering the whole span.
Ignore breaks, lunch, free periods and empty cells. If a period has no class, do not invent one.
If something is unreadable, mention it in notes. Return JSON only.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' })
  const key = process.env.GEMINI_API_KEY
  if (!key) return res.status(500).json({ error: 'Photo scan is not set up on this server yet.' })

  // light abuse guard: 12 scans an hour per IP (per server instance)
  const ip = String(req.headers['x-forwarded-for'] ?? 'x').split(',')[0].trim()
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.t > 3_600_000) hits.set(ip, { n: 1, t: now })
  else if (++h.n > 12) return res.status(429).json({ error: 'Too many scans. Try again in an hour, or enter the timetable by hand.' })

  const { image, mime } = (req.body ?? {}) as { image?: string; mime?: string }
  if (!image || typeof image !== 'string') return res.status(400).json({ error: 'Send the photo as base64 in "image".' })
  if (image.length > MAX_B64) return res.status(413).json({ error: 'That photo is too large. Try a smaller one.' })
  const type = mime && /^image\/(jpeg|png|webp)$/.test(mime) ? mime : 'image/jpeg'

  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: type, data: image } }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
      }),
    })
    if (!r.ok) {
      console.error('gemini error', r.status, (await r.text()).slice(0, 300))
      return res.status(502).json({ error: 'The scanner is busy right now. Try again in a minute, or enter the timetable by hand.' })
    }
    const data = (await r.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    const parsed = JSON.parse(text) as { classes?: unknown[]; notes?: string }
    return res.status(200).json({ classes: Array.isArray(parsed.classes) ? parsed.classes : [], notes: parsed.notes ?? '' })
  } catch (e) {
    console.error('scan failed', e)
    return res.status(500).json({ error: 'Could not read that photo. Try a clearer, straight-on picture.' })
  }
}
