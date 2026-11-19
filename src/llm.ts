import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

export const MODEL = 'claude-opus-5-5';
export const EFFORT = 'low' as const;

let client: Anthropic | undefined;

/** One structured-output call. Throws on refusal or unparseable output; the SDK retries transient errors. */
export async function callStructured<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: EFFORT, format: zodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error(`Model refused: ${res.stop_details?.category ?? 'unknown'}`);
  if (res.parsed_output == null) throw new Error(`No parsed output (stop_reason: ${res.stop_reason})`);
  return res.parsed_output as T;
}

/** Runs `fn` over items with at most `limit` in flight; calls onDone after each. */
export async function pool<I>(items: I[], limit: number, fn: (item: I) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
