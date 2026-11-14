import { createContext, useContext, useState, type ReactNode } from 'react'

const hi: Record<string, string> = {
  'Khata': 'खाता', 'Orders': 'ऑर्डर', 'Stock': 'स्टॉक', 'Bookings': 'बुकिंग', 'Replies': 'जवाब',
  'Total to collect': 'कुल वसूली बाकी', 'Add a customer': 'नया ग्राहक जोड़ें', 'Name': 'नाम', 'Add customer': 'ग्राहक जोड़ें',
  'WhatsApp number (with country code)': 'WhatsApp नंबर (देश कोड के साथ)', 'No customers yet. Add the first one below.': 'अभी कोई ग्राहक नहीं। नीचे पहला जोड़ें।',
  'Back': 'वापस', 'Gave on credit': 'उधार दिया', 'Got payment': 'पैसे मिले', 'Amount (₹)': 'रकम (₹)', 'Note': 'नोट', 'Remind on WhatsApp': 'WhatsApp पर याद दिलाएँ',
  'Clear': 'चुकता', 'All clear': 'सब चुकता', 'Credit': 'उधार', 'Payment': 'भुगतान',
  'New order': 'नया ऑर्डर', 'Paste the customer’s message': 'ग्राहक का मैसेज यहाँ डालें', 'Customer name': 'ग्राहक का नाम', 'Add order': 'ऑर्डर जोड़ें',
  'New': 'नया', 'Packed': 'पैक', 'Delivered': 'दे दिया', 'Mark packed': 'पैक हो गया', 'Mark delivered': 'दे दिया', 'Message customer': 'ग्राहक को मैसेज', 'Delete': 'हटाएँ',
  'No open orders.': 'कोई खुला ऑर्डर नहीं।', 'Open orders': 'खुले ऑर्डर', 'Done': 'पूरे हुए',
  'Items to order': 'मँगाने वाला सामान', 'Order from supplier': 'सप्लायर को ऑर्डर भेजें', 'Add an item': 'सामान जोड़ें', 'Item': 'सामान', 'Quantity': 'मात्रा', 'Warn me below': 'इससे कम होने पर बताएँ', 'Supplier WhatsApp': 'सप्लायर WhatsApp',
  'Low': 'कम', 'Enough stock.': 'स्टॉक ठीक है।', 'Nothing is running low.': 'कुछ भी कम नहीं है।', 'Add item': 'जोड़ें',
  'New booking': 'नई बुकिंग', 'Date': 'तारीख', 'Time': 'समय', 'What for': 'किसलिए', 'Add booking': 'बुकिंग जोड़ें', 'Upcoming': 'आने वाली', 'No upcoming bookings.': 'कोई बुकिंग नहीं।', 'Remind customer': 'ग्राहक को याद दिलाएँ',
  'Ready replies': 'तैयार जवाब', 'Shop name': 'दुकान का नाम', 'Send on WhatsApp': 'WhatsApp पर भेजें', 'Copy': 'कॉपी', 'Copied': 'कॉपी हो गया', 'Customer number': 'ग्राहक का नंबर', 'Add a reply': 'नया जवाब', 'Title': 'शीर्षक', 'Message': 'मैसेज', 'Save reply': 'जवाब सेव करें',
  'Stored on this phone for now.': 'अभी सारा डेटा इसी फोन में रहता है।',
}
type Lang = 'en' | 'hi'
const Ctx = createContext<{ lang: Lang; t: (s: string) => string; toggle: () => void }>({ lang: 'en', t: (s) => s, toggle: () => {} })

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('counter-lang') as Lang) || 'en')
  const toggle = () => setLang((l) => { const n = l === 'en' ? 'hi' : 'en'; localStorage.setItem('counter-lang', n); return n })
  const t = (s: string) => (lang === 'hi' ? hi[s] ?? s : s)
  return <Ctx.Provider value={{ lang, t, toggle }}>{children}</Ctx.Provider>
}
export const useT = () => useContext(Ctx)
export const missingHindi = (keys: string[]) => keys.filter((k) => !hi[k])
