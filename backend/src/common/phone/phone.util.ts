import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

export type NormalizedPhone = { e164: string; digits: string };

/**
 * Validates and normalizes user input to E.164 ("+918971775506").
 * Numbers typed without a country code are interpreted in `defaultRegion` (India by default),
 * so "89717 75506", "089717-75506" and "+91 8971775506" all normalize to the same value.
 * Only mobile-capable numbers are accepted, since WhatsApp needs a mobile number.
 */
export function normalizePhone(input: string, defaultRegion: CountryCode = 'IN'): NormalizedPhone | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().replace(/^00/, '+');
  if (!/^[+\d\s().-]{6,24}$/.test(cleaned)) return null;

  const parsed = parsePhoneNumberFromString(cleaned, defaultRegion);
  if (!parsed || !parsed.isValid()) return null;

  const type = parsed.getType();
  // undefined = metadata can't tell (some regions); allow those, reject clear landlines etc.
  if (type && !['MOBILE', 'FIXED_LINE_OR_MOBILE'].includes(type)) return null;

  return { e164: parsed.number, digits: parsed.number.slice(1) };
}

/** "+918971775506" -> "+91 ••••••5506" for logs and API responses. */
export function maskPhone(e164: string): string {
  return e164.length <= 6 ? '••••' : `${e164.slice(0, 3)} ••••••${e164.slice(-4)}`;
}
