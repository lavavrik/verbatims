import { franc } from 'franc';

/**
 * Languages that plausibly appear in Prague guest reviews. Restricting the detector to these
 * stops short English texts coming back as Scots, Quechua or Hmong.
 */
export const GUEST_LANGUAGES = [
  'eng', 'fra', 'deu', 'spa', 'ita', 'por', 'nld', 'rus', 'ukr', 'pol', 'ces', 'slk', 'hun',
  'swe', 'dan', 'nob', 'fin', 'ell', 'tur', 'heb', 'ron', 'bul', 'hrv', 'slv', 'lit', 'lav', 'est',
  'kor', 'cmn', 'jpn', 'arb', 'cat',
];

/** ISO 639-3 language code, or 'und' when the text is too short or unclear. */
export function detectLanguage(text: string): string {
  return franc(text, { minLength: 20, only: GUEST_LANGUAGES });
}
