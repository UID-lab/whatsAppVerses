import { Verse } from '@prisma/client';
import { formatVerseMessage } from './verse-formatter';

const bible: Verse = {
  id: 1,
  type: 'BIBLE',
  reference: 'John 3:16',
  book: 'John',
  chapter: 3,
  verse: 16,
  text: 'For God so loved the world…',
  originalText: null,
  transliteration: null,
  translation: 'KJV',
  rotationIndex: 0,
};

const gita: Verse = {
  ...bible,
  id: 2,
  type: 'GITA',
  reference: 'Bhagavad Gita 2.47',
  book: 'Bhagavad Gita',
  chapter: 2,
  verse: 47,
  text: 'You have the right to work, but never to the fruit of work.',
  originalText: 'कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।।2.47।।',
  translation: 'Shri Purohit Swami',
};

describe('formatVerseMessage', () => {
  it('formats a daily Bible verse with an opt-out hint', () => {
    const text = formatVerseMessage(bible, { kind: 'DAILY' });
    expect(text).toContain('*John 3:16*');
    expect(text).toContain('"For God so loved the world…"');
    expect(text).toContain('Reply *STOP* to unsubscribe.');
    expect(text).not.toContain('Welcome');
  });

  it('formats a Gita welcome message with Sanskrit, translation credit and manage link', () => {
    const text = formatVerseMessage(gita, { kind: 'WELCOME', manageUrl: 'https://x.test/manage?token=abc' });
    expect(text).toContain('Welcome');
    expect(text).toContain('कर्मण्येवाधिकारस्ते मा फलेषु कदाचन');
    expect(text).not.toContain('2.47।।');
    expect(text).toContain('Translation: Shri Purohit Swami');
    expect(text).toContain('https://x.test/manage?token=abc');
  });
});
