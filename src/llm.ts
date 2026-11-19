import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

export const MODEL = 'claude-opus-5-5';
export const EFFORT = 'low' as const;

let client: Anthropic | undefined;

/** A failed call that still used (and billed) tokens. */
export class LlmError extends Error {
  constructor(message: string, readonly usage: { input: number; output: number }) { super(message); }
}

export type CallOptions = { model: string; effort: 'low' | 'medium' | 'high'; maxTokens?: number; cacheSystem?: boolean };

/**
 * One structured-output call on any model. Throws on refusal or unparseable output; the SDK
 * retries transient errors. Usage counts cache reads and writes as input.
 */
export async function callStructuredWith<T>(opts: CallOptions, schema: z.ZodType<T>, system: string, user: string): Promise<{ value: T; usage: { input: number; output: number } }> {
  client ??= new Anthropic();
  const res = await client.messages.parse({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 1024,
    output_config: { effort: opts.effort, format: zodOutputFormat(schema) },
    system: opts.cacheSystem ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system,
    messages: [{ role: 'user', content: user }],
  });
  const u = res.usage;
  const usage = { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens };
  if (res.stop_reason === 'refusal') throw new LlmError(`Model refused: ${res.stop_details?.category ?? 'unknown'}`, usage);
  if (res.parsed_output == null) throw new LlmError(`No parsed output (stop_reason: ${res.stop_reason})`, usage);
  return { value: res.parsed_output as T, usage };
}

/** Step-1 helper: the default model and effort, value only. */
export async function callStructured<T>(schema: z.ZodType<T>, system: string, user: string): Promise<T> {
  return (await callStructuredWith({ model: MODEL, effort: EFFORT }, schema, system, user)).value;
}

/** Runs `fn` over items with at most `limit` in flight; calls onDone after each. */
export async function pool<I>(items: I[], limit: number, fn: (item: I) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => { while (next < items.length) await fn(items[next++]); };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
