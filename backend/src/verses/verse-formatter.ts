import { DeliveryKind, Verse, VerseType } from '@prisma/client';

export interface FormatOptions {
  kind: DeliveryKind;
  /** Web link to unsubscribe (included in the welcome message). */
  manageUrl?: string;
}

/** Renders a verse as a WhatsApp message (WhatsApp supports *bold* and _italic_). */
export function formatVerseMessage(verse: Verse, opts: FormatOptions): string {
  const lines: string[] = [];

  if (opts.kind === 'WELCOME') {
    const what = verse.type === VerseType.BIBLE ? 'a Bible verse' : 'a verse from the Bhagavad Gita';
    lines.push(`🙏 Welcome! You'll receive ${what} here every day. Here is your first one:`, '');
  }

  if (verse.type === VerseType.BIBLE) {
    lines.push(`📖 *${verse.reference}*`, '', `"${verse.text}"`, '', `_${verse.reference} (${verse.translation})_`);
  } else {
    lines.push(`🪷 *${verse.reference}*`, '');
    if (verse.originalText) lines.push(verse.originalText.replace(/।।\s*[\d.]+\s*।।\s*$/u, '').trim(), '');
    lines.push(verse.text, '', `_Translation: ${verse.translation}_`);
  }

  lines.push('', 'Reply *STOP* to unsubscribe.');
  if (opts.kind === 'WELCOME' && opts.manageUrl) lines.push(`Manage: ${opts.manageUrl}`);
  return lines.join('\n');
}
