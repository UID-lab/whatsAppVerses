import { Verse, VerseType } from '@prisma/client';

/**
 * Message texts sent on WhatsApp. Edit the wording here.
 * WhatsApp formatting: *bold*, _italic_.
 */

/**
 * First message after sign-up. `firstVerse` says when the first verse arrives, e.g.
 * "today at 9:30 PM", "in a few minutes" or "tomorrow at 9:30 PM".
 */
export function formatWelcomeMessage(name: string, brandName: string, firstVerse: string): string {
  const greeting = name.trim() ? `Hi ${name.trim()},` : 'Hi,';
  return [
    greeting,
    '',
    `Thank you for subscribing to ${brandName}. Your first verse will arrive ${firstVerse}.`,
    '',
    "Let's hold hands and begin the path with joy!",
    '',
    'Reply STOP anytime to unsubscribe.',
  ].join('\n');
}

/** The daily verse. */
export function formatVerseMessage(verse: Verse): string {
  const lines: string[] = [];
  if (verse.type === VerseType.BIBLE) {
    lines.push(`📖 *${verse.reference}*`, '', `"${verse.text}"`, '', `_${verse.reference} (${verse.translation})_`);
  } else if (verse.type === VerseType.QURAN) {
    // e.g. "🌙 *Quran 2:255* (Al-Baqara)"; Arabic: Tanzil Uthmani text (CC BY 3.0), verbatim.
    lines.push(`🌙 *${verse.reference}* (${verse.book})`, '');
    if (verse.originalText) lines.push(verse.originalText, '');
    lines.push(verse.text, '', `_Translation: ${verse.translation}_`);
  } else {
    // English only: no Sanskrit and no translator line (the translation is public domain;
    // credit is kept in README.md).
    lines.push(`🪷 *${verse.reference}*`, '', verse.text);
  }
  lines.push('', 'Reply *STOP* to unsubscribe.');
  return lines.join('\n');
}
