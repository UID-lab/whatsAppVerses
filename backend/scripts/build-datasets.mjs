#!/usr/bin/env node
/**
 * Rebuilds the bundled, gzipped verse datasets in prisma/data/.
 * Only maintainers need this: the generated files are committed, so the seed
 * (and production) never depend on these URLs being reachable. The seed loads
 * them into the MySQL `verses` table; the app only ever reads verses from MySQL.
 *
 *   node scripts/build-datasets.mjs              # all datasets
 *   node scripts/build-datasets.mjs quran        # only one (bible | quran | ramayana | mahabharata)
 *
 * Sources
 *  - Bible: King James Version (1769), public domain.
 *      https://github.com/scrollmapper/bible_databases (formats/json/KJV.json)
 *  - Quran: English translation by Mohammed Marmaduke Pickthall (1930; author d. 1936),
 *    public domain. Arabic (Uthmani script) from the Tanzil Project, CC BY 3.0 — used
 *    verbatim with attribution: "Tanzil Quran Text (Uthmani), https://tanzil.net".
 *      https://api.alquran.cloud/v1/quran/en.pickthall
 *      https://api.alquran.cloud/v1/quran/quran-uthmani
 *  - Ramayana: Valmiki's Ramayana in English verse by Ralph T. H. Griffith (1870–1874; d. 1906),
 *    public domain. Project Gutenberg eBook #24869.
 *  - Mahabharata: English prose translation by Kisari Mohan Ganguli (1883–1896; d. 1908),
 *    public domain. Project Gutenberg eBooks #15474–#15477 (volumes 1–4).
 *
 * The Ramayana is sent as a story in order (consecutive daily parts of the whole text). For the
 * Mahabharata the builder keeps only short passages that read as a complete teaching on their own
 * (duty, truth, virtue, wisdom …) and scores them: higher-scoring passages form tier 1 of the daily
 * rotation, the rest tier 2. Story passages (battles, journeys, dialogue fragments) are left out.
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'data');
const KJV_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json';
const QURAN_EN_URL = 'https://api.alquran.cloud/v1/quran/en.pickthall';
const QURAN_AR_URL = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
// The API prefixes verse 1 of every surah (except 1 and 9) with the four-word Bismillah;
// Tanzil's original text does not, so it is removed to keep the text verbatim.
const BISMILLAH_FIRST_WORD = 'بِسْمِ';

// Project Gutenberg's main site is sometimes down for maintenance; its mirror serves the same files.
const GUTENBERG_MIRRORS = [
  (id) => `https://gutenberg.pglaf.org/${String(id).split('').slice(0, -1).join('/')}/${id}`,
  (id) => `https://www.gutenberg.org/files/${id}`,
];

const gutenbergText = async (id, names) => {
  for (const dir of GUTENBERG_MIRRORS) {
    for (const name of names) {
      const res = await fetch(`${dir(id)}/${name}`).catch(() => null);
      if (res?.ok) return (await res.text()).replace(/^\uFEFF/, '').replace(/\r/g, '');
    }
  }
  throw new Error(`Could not download Project Gutenberg eBook #${id}`);
};

const getJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
};

const normalizeBook = (name) =>
  name
    .replace(/^III /, '3 ')
    .replace(/^II /, '2 ')
    .replace(/^I /, '1 ')
    .replace(/^Revelation of John$/, 'Revelation');

const clean = (s) => s.replace(/\[|\]/g, '').replace(/\s+/g, ' ').trim();

async function buildBible() {
  const kjv = await getJson(KJV_URL);
  const rows = [];
  for (const book of kjv.books) {
    for (const ch of book.chapters) {
      for (const v of ch.verses) {
        rows.push({ b: normalizeBook(book.name), c: ch.chapter, v: v.verse, t: clean(v.text) });
      }
    }
  }
  writeFileSync(join(OUT, 'bible-kjv.json.gz'), gzipSync(JSON.stringify(rows), { level: 9 }));
  console.log(`bible-kjv: ${rows.length} verses`);
}

async function buildQuran() {
  const [en, ar] = await Promise.all([getJson(QURAN_EN_URL), getJson(QURAN_AR_URL)]);
  const rows = [];
  en.data.surahs.forEach((surah, si) => {
    const arSurah = ar.data.surahs[si];
    if (arSurah.number !== surah.number) throw new Error(`Surah mismatch at ${si}`);
    surah.ayahs.forEach((ayah, ai) => {
      let arabic = arSurah.ayahs[ai].text.replace(/^\uFEFF/, '').trim();
      if (ayah.numberInSurah === 1 && surah.number !== 1 && surah.number !== 9 && arabic.startsWith(BISMILLAH_FIRST_WORD)) {
        arabic = arabic.split(/\s+/).slice(4).join(' ');
      }
      rows.push({
        s: surah.number,
        n: surah.englishName,
        v: ayah.numberInSurah,
        ar: arabic,
        en: clean(ayah.text),
      });
    });
  });
  if (rows.length !== 6236) throw new Error(`Expected 6236 ayahs, got ${rows.length}`);
  writeFileSync(join(OUT, 'quran.json.gz'), gzipSync(JSON.stringify(rows), { level: 9 }));
  console.log(`quran: ${rows.length} ayahs`);
}

// ---- Ramayana & Mahabharata ---------------------------------------------------------------------

const romanToInt = (r) => {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let n = 0;
  for (let i = 0; i < r.length; i++) n += v[r[i]] < (v[r[i + 1]] ?? 0) ? -v[r[i]] : v[r[i]];
  return n;
};
const count = (re, s) => (s.match(re) ?? []).length;
/** Removes dialogue quote marks but keeps apostrophes inside words (o’er, Duty’s). */
const stripQuotes = (s) =>
  s
    .replace(/(?<=[A-Za-zÀ-ɏ])[’'](?=[A-Za-zÀ-ɏ])/g, '\u0001')
    .replace(/[“”"‘’`']/g, ' ')
    .replace(/\u0001/g, '’');
/** Words that mark a passage as teaching (vs. story). */
const TEACHING_WORDS =
  /\b(duty|duty’s|duties|virtue|virtue’s|virtues|virtuous|truth|truth’s|truthful|righteous|righteousness|justice|faith|wisdom|wise|knowledge|honour|sin|sins|sinful|fate|destiny|mortal|mortals|soul|law|laws|pure|vow|vows|deeds|acts|conduct|merit|mercy|compassion|kindness|forgive|forgiveness|patience|patient|anger|wrath|pride|greed|covetousness|desire|desires|contentment|peace|tranquillity|self-restraint|joy|happiness|sorrow|misery|grief|fame|glory|heaven|good|evil|wicked|noble|religion|bliss|wealth|poverty|pleasure|pain|gain|reward|life|death|time|fortune|prudent|folly|fool|fools|charity|gifts|gratitude|friend|friends|exertion|humility|falsehood|yoga|mind|senses|heart)\b/gi;
const PAST_WORDS =
  /\b(\w+ed|was|were|had|did|came|went|said|spoke|saw|stood|fell|rose|cried|bore|sprang|flew|fought|slew|struck|gave|took|knew|thought|heard|made|ran|led|drew|threw|wept|beheld|replied|answered|addressed|proceeded|thereupon|having)\b/g;
const STORY_WORDS = /\b(arrows|shafts|car|chariot|steeds|elephants|battle|army|troops|weapons|slain|wounded|mace|bow)\b/gi;
/** First words that need the previous sentence to make sense. */
const NEEDS_CONTEXT =
  /^(And|But|Then|So|Thus|There|Here|He|She|They|His|Her|Their|This|That|These|Those|Him|Them|It|Till|Until|Which|Whose|Whom|Or|Nor|Yet|While|Where|When|Now|Thereupon|Hearing|Having|After|Therefore|Hence|For|Thou|Thy|Thee|I|We|Saying|Even|Also|Again|Accordingly|Upon|On|In this|In that)\b/;

const RAMAYANA_KANDAS = ['Bala Kanda', 'Ayodhya Kanda', 'Aranya Kanda', 'Kishkindha Kanda', 'Sundara Kanda', 'Yuddha Kanda'];
/** Lines per daily part of the Ramayana: cut at a stanza end once MIN is reached, else at a sentence end. */
const RAMAYANA_PART = { min: 10, target: 14, clause: 20, max: 26, tail: 5 };

/**
 * The Ramayana is sent as a story, in order: the whole of Griffith's text (Books I–VI) is cut into
 * consecutive daily parts that never cross a canto. Nothing is skipped.
 */
async function buildRamayana() {
  const raw = await gutenbergText(24869, ['24869-0.txt', '24869.txt']);
  const start = raw.indexOf('BOOK I.(6)');
  const end = raw.indexOf('\nAPPENDIX.', start);
  if (start < 0 || end < 0) throw new Error('Unexpected Ramayana layout');
  const cantos = [];
  let book = 0;
  for (const line of raw.slice(start, end).split('\n')) {
    let m = line.match(/^BOOK ([IVX]+)\./);
    if (m) { book = romanToInt(m[1]); continue; }
    m = line.match(/^Canto ([IVXLC]+)\.\s*(.*)$/);
    if (m) {
      cantos.push({ book, canto: romanToInt(m[1]), title: m[2].replace(/\(\d+\)/g, '').replace(/\.$/, '').trim(), lines: [] });
      continue;
    }
    const c = cantos[cantos.length - 1];
    if (!c) continue;
    const text = line.replace(/\(\d+\)/g, '').replace(/\s+/g, ' ').trim(); // footnote markers
    if (text || (c.lines.length && c.lines[c.lines.length - 1] !== '')) c.lines.push(text); // '' = stanza break
  }

  const sentenceEnd = /[.!?][”’"]*\)?$/;
  const clauseEnd = /[,;:—][”’"]*$/;
  const rows = [];
  for (const c of cantos) {
    const parts = [];
    let cur = [];
    const verses = () => cur.filter(Boolean).length;
    const cut = () => {
      while (cur[cur.length - 1] === '') cur.pop();
      while (cur[0] === '') cur.shift();
      if (cur.length) parts.push(cur);
      cur = [];
    };
    c.lines.forEach((line, i) => {
      cur.push(line);
      if (!line) return;
      const n = verses();
      const stanzaEnds = c.lines[i + 1] === '' || i === c.lines.length - 1;
      if (
        (n >= RAMAYANA_PART.min && stanzaEnds && sentenceEnd.test(line)) ||
        (n >= RAMAYANA_PART.target && sentenceEnd.test(line)) ||
        (n >= RAMAYANA_PART.clause && n % 2 === 0 && clauseEnd.test(line)) ||
        n >= RAMAYANA_PART.max
      )
        cut();
    });
    cut();
    // A short leftover at the end of a canto joins the part before it.
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last.filter(Boolean).length < RAMAYANA_PART.tail) {
      parts.pop();
      parts[parts.length - 1].push('', ...last);
    }
    parts.forEach((lines, k) =>
      rows.push({ k: c.book, kn: RAMAYANA_KANDAS[c.book - 1], c: c.canto, ct: c.title, p: k + 1, t: lines.join('\n') }),
    );
  }
  const lineCount = cantos.reduce((n, c) => n + c.lines.filter(Boolean).length, 0);
  const sent = rows.reduce((n, r) => n + r.t.split('\n').filter(Boolean).length, 0);
  if (sent !== lineCount) throw new Error(`Ramayana parts lost lines: ${sent} of ${lineCount}`);
  writeFileSync(join(OUT, 'ramayana.json.gz'), gzipSync(JSON.stringify(rows), { level: 9 }));
  console.log(`ramayana: ${rows.length} daily parts from ${cantos.length} cantos (${lineCount} lines, in order)`);
}

const MAHABHARATA_PARVAS = [
  'Adi Parva', 'Sabha Parva', 'Vana Parva', 'Virata Parva', 'Udyoga Parva', 'Bhishma Parva',
  'Drona Parva', 'Karna Parva', 'Shalya Parva', 'Sauptika Parva', 'Stri Parva', 'Shanti Parva',
  'Anushasana Parva', 'Ashvamedhika Parva', 'Ashramavasika Parva', 'Mausala Parva',
  'Mahaprasthanika Parva', 'Svargarohana Parva',
];
/** Translator's notes and glosses that ended up in the running text. */
const MB_NOTES =
  /\b(i\.e\.|viz\.|lit\.|sense seems|the meaning|commentator|Nilakantha|Burdwan|translat\w*|rendered|the text|the original|verse|sloka|Singha|Bombay text|Bengal text|above|aforesaid|former|latter)\b/i;
const MB_GENERIC = /\b(O|God|Gods|Brahman|Brahmana|Brahmanas|Vedas|Yoga|Kshatriya|Kshatriyas|Vaisya|Sudra|Supreme|Creator|Self)\b/g;

async function buildMahabharata() {
  const sections = [];
  for (const id of [15474, 15475, 15476, 15477]) {
    let raw = await gutenbergText(id, [`${id}-0.txt`, `${id}.txt`]);
    const endMark = raw.search(/\*\*\* ?END OF (THE|THIS) PROJECT GUTENBERG/);
    if (endMark > 0) raw = raw.slice(0, endMark);
    let book = 0;
    let section = 0;
    let buf = [];
    const flush = () => {
      if (book && section && buf.length) sections.push({ book, section, text: buf.join('\n') });
      buf = [];
    };
    for (const line of raw.split('\n')) {
      let m = line.match(/^BOOK (\d+)\s*$/);
      if (m) { flush(); book = Number(m[1]); section = 0; continue; }
      m = line.match(/^SECTION ([IVXLCDM]+)\s*$/);
      if (m && book) { flush(); section = romanToInt(m[1]); continue; }
      m = line.match(/^(\d+)\s*$/); // books 8–11 and 16–18 number their sections 1, 2, 3 …
      if (m && book && Number(m[1]) === section + 1) { flush(); section = Number(m[1]); continue; }
      if (section) buf.push(line);
    }
    flush();
  }
  if (sections.length < 2000) throw new Error(`Expected ~2100 Mahabharata sections, got ${sections.length}`);

  const rows = [];
  for (const sec of sections) {
    const text = stripQuotes(
      sec.text
        .replace(/\([^()]*continued\)/g, '')
        .replace(/And so ends[^\n]*/g, '')
        .replace(/\[\d+\]/g, '') // footnote markers
        .replace(/--/g, ' — '),
    )
      .replace(/\s+/g, ' ')
      .trim();
    const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    const candidates = [];
    for (let i = 0; i < sentences.length; i++) {
      for (const n of [1, 2, 3]) {
        if (i + n > sentences.length) break;
        const t = sentences.slice(i, i + n).join(' ');
        if (t.length < 90 || t.length > 420) continue;
        const first = sentences[i];
        if (NEEDS_CONTEXT.test(first)) continue;
        if (/\b(however|also|such|thus|likewise|accordingly|therefore|on the other hand|in its turn)\b/i.test(first)) continue;
        if (/(said|continued|replied|answered|asked)\s*[:,]/.test(t.slice(0, 60))) continue;
        if (MB_NOTES.test(t)) continue;
        if (count(/\(/g, t) > 1 || count(/\(/g, t) !== count(/\)/g, t)) continue;
        if (!/[.!]$/.test(t) || t.includes('?')) continue; // questions need the answer around them
        const names = count(/(?<![.!?] )(?<!^)\b[A-Z][a-z]{2,}/g, t) - count(MB_GENERIC, t);
        const raw =
          count(TEACHING_WORDS, t) * 2 +
          count(/\b(is|are|should|must|never|ever|always|becomes|become|attains|obtains|succeeds|regarded|considered|called|said to be|who|whoever|that man|one who|he who|those who|the wise|the good|men)\b/g, t) -
          count(PAST_WORDS, t) * 2 -
          count(/\b(I|me|my|mine|we|us|our)\b/g, t) * 1.5 -
          count(STORY_WORDS, t) * 2 -
          Math.max(names, 0) * 0.7 -
          (/^O /.test(t) ? 2 : 0);
        candidates.push({ score: raw / (1 + 0.15 * (t.length / 100)), i, n, t });
      }
    }
    // The best non-overlapping passages, at most 3 per section so the pool covers the whole epic.
    candidates.sort((a, b) => b.score - a.score || a.i - b.i);
    const used = new Set();
    const picked = [];
    for (const c of candidates) {
      if (c.score < 6 || picked.length >= 3) break;
      if (Array.from({ length: c.n }, (_, k) => c.i + k).some((k) => used.has(k))) continue;
      for (let k = c.i; k < c.i + c.n; k++) used.add(k);
      picked.push(c);
    }
    picked.sort((a, b) => a.i - b.i);
    picked.forEach((c, k) =>
      rows.push({ b: sec.book, bn: MAHABHARATA_PARVAS[sec.book - 1], s: sec.section, p: k + 1, t: c.t, tier: c.score >= 8 ? 1 : 2 }),
    );
  }
  writeFileSync(join(OUT, 'mahabharata.json.gz'), gzipSync(JSON.stringify(rows), { level: 9 }));
  console.log(`mahabharata: ${rows.length} passages (${rows.filter((r) => r.tier === 1).length} tier 1) from ${sections.length} sections`);
}

const only = process.argv[2]?.toLowerCase();
if (!only || only === 'bible') await buildBible();
if (!only || only === 'quran') await buildQuran();
if (!only || only === 'ramayana') await buildRamayana();
if (!only || only === 'mahabharata') await buildMahabharata();
