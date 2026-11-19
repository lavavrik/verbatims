export type Span = { start: number; length: number };
/** A redaction is stored by position only, never by the name it hides. */
export type Redaction = { id: string } & Span;

export const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word, case-insensitive, Unicode-aware matches of `name` in `text` (JS string indices). */
export function findOccurrences(text: string, name: string): Span[] {
  const n = name.trim();
  if (!n) return [];
  // Scripts written without spaces (Han, kana, Hangul) can't use word boundaries: match as a substring.
  const re = UNSPACED.test(n)
    ? new RegExp(escape(n), 'gu')
    : new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escape(n)}(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
  return [...text.matchAll(re)].map((m) => ({ start: m.index!, length: m[0].length }));
}

/** Sorts per review and merges duplicate, nested or overlapping spans into one. */
export function mergeRedactions(rs: Redaction[]): Redaction[] {
  const sorted = [...rs].sort((a, b) => a.id.localeCompare(b.id) || a.start - b.start || b.length - a.length);
  const out: Redaction[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && last.id === r.id && r.start < last.start + last.length) {
      last.length = Math.max(last.length, r.start + r.length - last.start);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/**
 * Combines a fresh detect-names run with what is already committed: manual additions stay,
 * and spans the owner removed (recorded by id + start) stay removed.
 */
export function combineRedactions(auto: Redaction[], existing: Redaction[], removed: { id: string; start: number }[]): Redaction[] {
  const isRemoved = (r: Redaction) => removed.some((x) => x.id === r.id && x.start === r.start);
  return mergeRedactions([...existing, ...auto].filter((r) => !isRemoved(r)));
}

/** Replaces each span with "[name]", right to left so earlier offsets stay valid. */
export function applyRedactions(text: string, rs: Redaction[]): string {
  const spans = [...rs].sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].start + spans[i - 1].length) throw new Error(`Redactions overlap in ${spans[i].id} at ${spans[i].start}`);
  }
  let out = text;
  for (const s of spans.reverse()) {
    if (s.start < 0 || s.start + s.length > out.length) throw new Error(`Redaction out of range in ${s.id}`);
    out = out.slice(0, s.start) + '[name]' + out.slice(s.start + s.length);
  }
  return out;
}
