'use strict';
/**
 * Small natural-language date parser for spoken scheduling:
 * "tomorrow at 3", "friday 10:30am", "next tuesday", "november 5 at noon",
 * "in 2 hours", "tonight", "this afternoon".
 * Returns { date: Date|null, hasTime: boolean, rest: string (text with the date words removed) }.
 */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function parseWhen(input, now = new Date()) {
  let text = ' ' + input.toLowerCase().replace(/[,.!?]/g, ' ') + ' ';
  let date = null;
  let hasTime = false;
  const cut = re => { text = text.replace(re, ' '); };

  // relative: in N minutes/hours/days
  let m = text.match(/\bin (\d+|an?|one|two|three|four|five) (minute|minutes|hour|hours|day|days|week|weeks)\b/);
  if (m) {
    const n = wordNum(m[1]);
    date = new Date(now);
    if (m[2].startsWith('minute')) { date.setMinutes(date.getMinutes() + n); hasTime = true; }
    if (m[2].startsWith('hour')) { date.setHours(date.getHours() + n); hasTime = true; }
    if (m[2].startsWith('day')) date.setDate(date.getDate() + n);
    if (m[2].startsWith('week')) date.setDate(date.getDate() + 7 * n);
    cut(m[0]);
  }

  if (!date && /\b(today|tonight|this (morning|afternoon|evening))\b/.test(text)) {
    date = new Date(now);
    if (/\btonight\b/.test(text)) { date.setHours(19, 0, 0, 0); hasTime = true; }
    if (/\bthis morning\b/.test(text)) { date.setHours(9, 0, 0, 0); hasTime = true; }
    if (/\bthis afternoon\b/.test(text)) { date.setHours(14, 0, 0, 0); hasTime = true; }
    if (/\bthis evening\b/.test(text)) { date.setHours(18, 0, 0, 0); hasTime = true; }
    cut(/\b(today|tonight|this (morning|afternoon|evening))\b/);
  }
  if (!date && /\b(tomorrow|tmrw)\b/.test(text)) {
    date = new Date(now); date.setDate(date.getDate() + 1);
    cut(/\b(tomorrow|tmrw)\b/);
  }
  if (!date && /\bday after tomorrow\b/.test(text)) {
    date = new Date(now); date.setDate(date.getDate() + 2); cut(/\bday after tomorrow\b/);
  }
  if (!date) {
    m = text.match(new RegExp(`\\b(?:on )?(next |this )?(${DAYS.join('|')})\\b`));
    if (m) {
      const target = DAYS.indexOf(m[2]);
      date = new Date(now);
      let diff = (target - date.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (m[1] && m[1].trim() === 'next' && diff < 7) diff += 0; // "next friday" = the coming friday
      date.setDate(date.getDate() + diff);
      cut(m[0]);
    }
  }
  if (!date) {
    m = text.match(new RegExp(`\\b(?:on )?(${MONTHS.join('|')}) (\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (m) {
      date = new Date(now.getFullYear(), MONTHS.indexOf(m[1]), Number(m[2]));
      if (date < startOfToday(now)) date.setFullYear(date.getFullYear() + 1);
      cut(m[0]);
    }
  }

  // time of day
  m = text.match(/\b(?:at |by |@)?(\d{1,2})(?::(\d{2}))? ?(am|pm|a m|p m)\b/) || text.match(/\b(?:at |by )(\d{1,2})(?::(\d{2}))?\b/);
  let timeMatch = m;
  if (!timeMatch && /\b(at )?noon\b/.test(text)) { timeMatch = ['noon', '12', '00', 'pm']; }
  if (!timeMatch && /\b(at )?midnight\b/.test(text)) { timeMatch = ['midnight', '12', '00', 'am']; }
  if (timeMatch) {
    let h = Number(timeMatch[1]);
    const min = Number(timeMatch[2] || 0);
    const ap = (timeMatch[3] || '').replace(/\s/g, '');
    if (h <= 24 && min < 60) {
      if (ap === 'pm' && h < 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      if (!ap && h >= 1 && h <= 7) h += 12; // "at 3" during business means 3 PM
      if (!date) {
        date = new Date(now);
        date.setHours(h, min, 0, 0);
        if (date < now) date.setDate(date.getDate() + 1);
      } else {
        date.setHours(h, min, 0, 0);
      }
      hasTime = true;
      if (timeMatch[0] === 'noon') cut(/\b(at )?noon\b/);
      else if (timeMatch[0] === 'midnight') cut(/\b(at )?midnight\b/);
      else cut(timeMatch[0]);
    }
  }

  if (date && !hasTime) date.setHours(9, 0, 0, 0); // date-only items default to 9 AM

  const rest = text.replace(/\s+/g, ' ').trim();
  return { date, hasTime, rest };
}

function startOfToday(now) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }

function wordNum(w) {
  const map = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
  return map[w] || Number(w) || 1;
}

module.exports = { parseWhen };
