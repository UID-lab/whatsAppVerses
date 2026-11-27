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
  chapterTitle: null,
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

const ramayana: Verse = {
  ...bible,
  id: 4,
  type: 'RAMAYANA',
  reference: 'Ramayana 2.21.3',
  book: 'Ayodhya Kanda',
  chapter: 21,
  verse: 3,
  chapterTitle: 'Kaikeyí’s Request',
  text: 'Truth, only truth protects the land,\nBy truth unharmed our houses stand;',
  originalText: null,
  translation: 'Ralph T. H. Griffith',
  rotationIndex: 213,
};

const mahabharata: Verse = {
  ...bible,
  id: 5,
  type: 'MAHABHARATA',
  reference: 'Mahabharata · Udyoga Parva, Section 35',
  book: 'Udyoga Parva',
  chapter: 35,
  verse: 1,
  text: 'Prosperity taketh its birth in good deeds, groweth in consequence of activity.',
  originalText: null,
  translation: 'Kisari Mohan Ganguli',
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

  it('formats a Ramayana part with part number, kanda, canto title and a continuation line', () => {
    const text = formatVerseMessage(ramayana);
    expect(text.startsWith('🏹 *Ramayana · Part 214*\n_Ayodhya Kanda · Canto 21 · Kaikeyí’s Request_\n\n')).toBe(true);
    expect(text).toContain('Truth, only truth protects the land,\nBy truth unharmed our houses stand;');
    expect(text).toContain('_To be continued tomorrow…_');
    expect(text).not.toContain('Translation:');
    expect(text).toContain('Reply *STOP* to unsubscribe.');
  });

  it('ends the story on the last Ramayana part', () => {
    const text = formatVerseMessage(ramayana, { poolSize: 214 });
    expect(text).toContain('_The end of the Ramayana. 🙏_');
    expect(text).not.toContain('To be continued');
  });

  it('formats a Mahabharata passage with parva and section', () => {
    const text = formatVerseMessage(mahabharata);
    expect(text.startsWith('🐚 *Mahabharata · Udyoga Parva, Section 35*\n\n')).toBe(true);
    expect(text).toContain(mahabharata.text);
    expect(text).not.toContain('Ganguli');
  });

  it('formats a Gita verse in English only (no Sanskrit, no translator line)', () => {
    const text = formatVerseMessage(gita);
    expect(text).toContain('🪷 *');
    expect(text).toContain(gita.text);
    expect(text).not.toMatch(/[\u0900-\u097F]/u); // no Devanagari
    expect(text).not.toContain('Translation:');
    expect(text).not.toContain('Purohit');
  });
});
