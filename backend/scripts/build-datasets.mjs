#!/usr/bin/env node
/**
 * Rebuilds the bundled, gzipped verse datasets in prisma/data/.
 * Only maintainers need this: the generated files are committed, so the seed
 * (and production) never depend on these URLs being reachable.
 *
 *   node scripts/build-datasets.mjs
 *
 * Sources
 *  - Bible: King James Version (1769), public domain.
 *      https://github.com/scrollmapper/bible_databases (formats/json/KJV.json)
 *  - Bhagavad Gita: Sanskrit + IAST transliteration (public domain) and the
 *    English rendering by Shri Purohit Swami (1935; author d. 1941, public
 *    domain in India under life+60). Compilation released under The Unlicense.
 *      https://github.com/gita/gita (data/verse.json, data/translation.json)
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

await buildBible();
await buildGita();
