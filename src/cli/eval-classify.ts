// npm run eval:classify -- --model claude-haiku-5-5 --prompt v2 [--reps 5] [--effort low] [--yes]
import { callStructuredWith } from '../llm';
import { arg, flag, required } from '../eval/args';
import { runClassify, type Effort } from '../eval/classify';
import { confirmInTerminal } from '../eval/confirm';
import { PRICES } from '../eval/cost';

await runClassify(
  {
    model: required('model', Object.keys(PRICES)),
    version: required('prompt', ['v1', 'v2']) as 'v1' | 'v2',
    reps: Number(arg('reps', '5')),
    effort: (arg('effort', 'low') as Effort),
    yes: flag('yes'),
  },
  { call: callStructuredWith, confirm: confirmInTerminal, log: console.log },
);
