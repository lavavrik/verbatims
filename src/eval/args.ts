/** Tiny --flag value parser for the eval commands. */
export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
export const flag = (name: string) => process.argv.includes(`--${name}`);
export function required(name: string, allowed?: string[]): string {
  const v = arg(name);
  if (!v || (allowed && !allowed.includes(v))) throw new Error(`--${name} is required${allowed ? ` (one of: ${allowed.join(', ')})` : ''}`);
  return v;
}
