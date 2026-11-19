// Keyword pre-filter for cleanliness complaints. It over-matches on purpose
// ("very clean" won't match, but "not dirty at all" will); the owner confirms every hit.
const STEMS = [
  // English
  'dirt', 'stain', 'dust', 'smell', 'hair', 'unclean', 'not clean', 'mould', 'mold',
  // Czech / Slovak
  'špína', 'špinav', 'prach', 'smrd', 'vlas', 'neuklizen', 'zápach',
  // German
  'schmutz', 'dreckig', 'staub', 'fleck', 'geruch', 'nicht sauber', 'haare',
  // Ukrainian
  'брудн', 'пил', 'плям', 'запах', 'волосс', 'волосин',
  // Russian
  'грязн', 'пыл', 'пятн', 'волос',
];

// A stem must start a word, so "hair" doesn't match "chair".
const PATTERN = new RegExp(`(?<!\\p{L})(${STEMS.map((s) => s.replace(/ /g, '\\s+')).join('|')})`, 'iu');

export function looksLikeCleanlinessComplaint(text: string): boolean {
  return PATTERN.test(text);
}
