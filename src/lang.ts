import { franc } from 'franc';

/** ISO 639-3 language code, or 'und' when the text is too short or unclear. */
export function detectLanguage(text: string): string {
  return franc(text, { minLength: 20 });
}
