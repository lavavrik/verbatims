// npm run eval:answer -- --model claude-haiku-5-5 [--reps 3] [--effort low] [--yes]
import { callStructuredWith } from '../llm';
import { runAnswer } from '../eval/answer';
import { arg, flag, required } from '../eval/args';
import type { Effort } from '../eval/classify';
import { confirmInTerminal } from '../eval/confirm';
import { PRICES } from '../eval/cost';

await runAnswer(
  { model: required('model', Object.keys(PRICES)), reps: Number(arg('reps', '3')), effort: arg('effort', 'low') as Effort, yes: flag('yes') },
  { call: callStructuredWith, confirm: confirmInTerminal, log: console.log, judge: async () => [] },
);
