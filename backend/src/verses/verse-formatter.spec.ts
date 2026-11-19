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
  rotationTier: 1,
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
  it('greets by name and says when the first verse arrives', () => {
    expect(formatWelcomeMessage('Priya', 'U!D Labs', 'today at 9:30 PM')).toBe(
      [
        'Hi Priya,',
        '',
        'Thank you for subscribing to U!D Labs. Your first verse will arrive today at 9:30 PM.',
        '',
        "Let's hold hands and begin the path with joy!",
        '',
        'Reply STOP anytime to unsubscribe.',
      ].join('\n'),
    );
  });

  it('falls back gracefully without a name', () => {
    expect(formatWelcomeMessage('', 'U!D Labs', 'in a few minutes').startsWith('Hi,\n')).toBe(true);
  });
});

const quran: Verse = {
  ...bible,
  id: 3,
  type: 'QURAN',
  reference: 'Quran 94:5',
  book: 'Ash-Sharh',
  chapter: 94,
  verse: 5,
  text: 'But lo! with hardship goeth ease,',
  originalText: 'فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا',
  translation: 'Pickthall',
};

describe('formatVerseMessage', () => {
  it('formats a Quran ayah with surah name, Arabic and translation credit', () => {
    const text = formatVerseMessage(quran);
    expect(text).toContain('🌙 *Quran 94:5* (Ash-Sharh)');
    expect(text).toContain('فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا');
    expect(text).toContain('Translation: Pickthall');
  });

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
