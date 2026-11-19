import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type RunKind = 'classify' | 'answer';

export type ResultFile<O = unknown, M = any> = {
  runId: string;
  kind: RunKind;
  createdAt: string;
  model: string;
  effort: string;
  promptVersion: string;
  prompt: string;
  promptHash: string;
  datasetHash: string;
  splitHash: string;
  reps: number;
  outputs: O[];
  usage: { inputTokens: number; outputTokens: number; estCostUsd: number };
  metrics: M;
  judge?: { model: string; effort: string; prompt: string; verdicts: any[]; usage?: { input: number; output: number }; estCostUsd?: number };
};

/** results/<date>-<kind>-<model>-<prompt>.json, with -2, -3… when that name is taken. */
export function resultPath(kind: RunKind, model: string, promptVersion: string, date: string, dir = '.'): string {
  const base = join(dir, 'results', `${date}-${kind}-${model}-${promptVersion}`);
  if (!existsSync(`${base}.json`)) return `${base}.json`;
  for (let i = 2; ; i++) if (!existsSync(`${base}-${i}.json`)) return `${base}-${i}.json`;
}

export async function writeResult(path: string, file: ResultFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 2) + '\n');
}

export const readResult = async <O = unknown>(path: string) => JSON.parse(await readFile(path, 'utf8')) as ResultFile<O>;

/** Progress for an interrupted run is only reused for exactly the same model, effort, prompt and data. */
export const cacheKey = (p: { kind: RunKind; model: string; effort: string; promptHash: string; datasetHash: string }) =>
  `${p.kind}-${p.model}-${p.effort}-${p.promptHash}-${p.datasetHash.slice(0, 16)}`;

export async function readCache<V>(dir: string, key: string): Promise<Record<string, V>> {
  try { return JSON.parse(await readFile(join(dir, 'cache/runs', `${key}.json`), 'utf8')); } catch { return {}; }
}

export async function writeCache(dir: string, key: string, value: unknown): Promise<void> {
  await mkdir(join(dir, 'cache/runs'), { recursive: true });
  await writeFile(join(dir, 'cache/runs', `${key}.json`), JSON.stringify(value));
}
