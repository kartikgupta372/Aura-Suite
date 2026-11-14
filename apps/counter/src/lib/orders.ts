const GREETING = /^(hi|hello|namaste|bhaiya|sir|please|pls|thanks|thank you|ji)[\s!.,]*$/i

/** Turns a pasted WhatsApp message into a list of items. Splits on new lines, commas, "aur", "and" and "+"; drops bullets, list numbers and greetings. */
export function parseItems(text: string): string[] {
  return text
    .split(/\n|,|;|\baur\b|\band\b|\+/i)
    .map((s) => s.trim().replace(/^[-•*]+\s*/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter((s) => s.length > 1 && !GREETING.test(s))
}

export function fillTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
}
