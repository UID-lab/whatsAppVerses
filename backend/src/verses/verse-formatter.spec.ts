import { Verse } from '@prisma/client';
import { formatVerseMessage, formatWelcomeMessage } from './verse-formatter';

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

describe('formatWelcomeMessage', () => {
  it('greets by name and says verses start tomorrow', () => {
    expect(formatWelcomeMessage('Priya', 'U!D Labs')).toBe(
      [
        'Hi Priya,',
        '',
        'Thank you for subscribing to U!D Labs. Your verses will start from tomorrow morning.',
        '',
        "Let's hold hands and begin the path with joy!",
        '',
        'Reply STOP anytime to unsubscribe.',
      ].join('\n'),
    );
  });

  it('falls back gracefully without a name', () => {
    expect(formatWelcomeMessage('', 'U!D Labs').startsWith('Hi,\n')).toBe(true);
  });
});

describe('formatVerseMessage', () => {
  it('formats a Bible verse with an opt-out hint', () => {
    const text = formatVerseMessage(bible);
    expect(text).toContain('*John 3:16*');
    expect(text).toContain('"For God so loved the world…"');
    expect(text).toContain('Reply *STOP* to unsubscribe.');
  });

  it('formats a Gita verse with Sanskrit and translation credit', () => {
    const text = formatVerseMessage(gita);
    expect(text).toContain('कर्मण्येवाधिकारस्ते मा फलेषु कदाचन');
    expect(text).not.toContain('2.47।।');
    expect(text).toContain('Translation: Shri Purohit Swami');
  });
});
