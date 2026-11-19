// npm run eval:classify -- --model claude-haiku-5-5 --prompt v2 [--reps 5] [--effort low] [--yes]
import { callStructuredWith } from '../llm';
import { arg, flag, required } from '../eval/args';
import { runClassify, type Effort } from '../eval/classify';
import { CLASSIFY_VERSIONS, type ClassifyVersion } from '../eval/prompts';
import { confirmInTerminal } from '../eval/confirm';
import { PRICES } from '../eval/cost';

await runClassify(
  {
    model: required('model', Object.keys(PRICES)),
    version: required('prompt', CLASSIFY_VERSIONS) as ClassifyVersion,
    reps: Number(arg('reps', '5')),
    effort: (arg('effort', 'low') as Effort),
    yes: flag('yes'),
  },
  { call: callStructuredWith, confirm: confirmInTerminal, log: console.log },
);
