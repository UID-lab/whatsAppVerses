#!/usr/bin/env node
/**
 * Rebuilds the bundled, gzipped verse datasets in prisma/data/.
 * Only maintainers need this: the generated files are committed, so the seed
 * (and production) never depend on these URLs being reachable. The seed loads
 * them into the MySQL `verses` table; the app only ever reads verses from MySQL.
 *
 *   node scripts/build-datasets.mjs              # all datasets
 *   node scripts/build-datasets.mjs quran        # only one (bible | gita | quran)
 *
 * Sources
 *  - Bible: King James Version (1769), public domain.
 *      https://github.com/scrollmapper/bible_databases (formats/json/KJV.json)
 *  - Bhagavad Gita: Sanskrit + IAST transliteration (public domain) and the
 *    English rendering by Shri Purohit Swami (1935; author d. 1941, public
 *    domain in India under life+60). Compilation released under The Unlicense.
 *      https://github.com/gita/gita (data/verse.json, data/translation.json)
 *  - Quran: English translation by Mohammed Marmaduke Pickthall (1930; author d. 1936),
 *    public domain. Arabic (Uthmani script) from the Tanzil Project, CC BY 3.0 — used
 *    verbatim with attribution: "Tanzil Quran Text (Uthmani), https://tanzil.net".
 *      https://api.alquran.cloud/v1/quran/en.pickthall
 *      https://api.alquran.cloud/v1/quran/quran-uthmani
 */
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'data');
const KJV_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/KJV.json';
const GITA_VERSES_URL = 'https://raw.githubusercontent.com/gita/gita/main/data/verse.json';
const GITA_TRANSLATIONS_URL = 'https://raw.githubusercontent.com/gita/gita/main/data/translation.json';
const GITA_TRANSLATOR = 'Shri Purohit Swami';
const QURAN_EN_URL = 'https://api.alquran.cloud/v1/quran/en.pickthall';
const QURAN_AR_URL = 'https://api.alquran.cloud/v1/quran/quran-uthmani';
// The API prefixes verse 1 of every surah (except 1 and 9) with the four-word Bismillah;
// Tanzil's original text does not, so it is removed to keep the text verbatim.
const BISMILLAH_FIRST_WORD = 'بِسْمِ';

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

async function buildGita() {
  const [verses, translations] = await Promise.all([getJson(GITA_VERSES_URL), getJson(GITA_TRANSLATIONS_URL)]);
  const english = new Map(
    translations.filter((t) => t.authorName === GITA_TRANSLATOR).map((t) => [t.verse_id, clean(t.description)]),
  );
  const rows = verses
    .sort((a, b) => a.chapter_number - b.chapter_number || a.verse_number - b.verse_number)
    .map((v) => ({
      c: v.chapter_number,
      v: v.verse_number,
      sa: v.text.replace(/\n\s*\n/g, '\n').trim(),
      tr: v.transliteration.trim(),
      en: english.get(v.id) ?? null,
    }));
  writeFileSync(join(OUT, 'gita.json.gz'), gzipSync(JSON.stringify(rows), { level: 9 }));
  console.log(`gita: ${rows.length} verses (${rows.filter((r) => r.en).length} with English)`);
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

const only = process.argv[2]?.toLowerCase();
if (!only || only === 'bible') await buildBible();
if (!only || only === 'gita') await buildGita();
if (!only || only === 'quran') await buildQuran();
