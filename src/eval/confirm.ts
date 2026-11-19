import { createInterface } from 'node:readline/promises';

/** Asks y/N in the terminal. */
export async function confirmInTerminal(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}
