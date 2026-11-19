import { expect, test } from 'vitest';
import type { AnswerOutput, Verdict } from '../../src/eval/answer';
import { answerMetrics } from '../../src/eval/answerMetrics';
import { judgeInput, makeJudge } from '../../src/eval/judge';
import { evalFixture } from './fixtures';

const u = { input: 1, output: 1 };
const d = evalFixture(40); // groundTruth r0002, r0003; confirmed complaints include r0005, r0007…
const claim = (text: string, reviewIds: string[]) => ({ text, reviewIds });
const ans = (questionId: string, claims: ReturnType<typeof claim>[], extra = {}): AnswerOutput => ({ questionId, rep: 1, answer: { answer: 'a', claims, ...extra }, usage: u });
const v = (outputIndex: number, claimIndex: number, reviewId: string, supported: boolean): Verdict => ({ outputIndex, claimIndex, reviewId, supported, reason: '' });

test('invalid or malformed ids count as invalid and are never judged', async () => {
  const outputs = [ans('Q3', [claim('x', ['r0001', 'r12', '12', 'r9999'])])];
  const judged: string[] = [];
  const judge = makeJudge((async (_o: unknown, _s: unknown, _sys: string, user: string) => { judged.push(user); return { value: { supported: true, reason: '' }, usage: u }; }) as never);
  const verdicts = await judge(outputs, d);
  expect(verdicts.map((x) => x.reviewId)).toEqual(['r0001']);
  const m = answerMetrics(outputs, verdicts, d).Q3;
  expect(m).toMatchObject({ citations: 4, invalidCitations: 3, claims: 1 });
});

test('a claim with only invalid citations is unsupported', () => {
  const m = answerMetrics([ans('Q3', [claim('x', ['nope'])])], [], d).Q3;
  expect(m.unsupportedClaims).toMatchObject({ k: 1, n: 1 });
});

test('a claim is supported when at least one valid citation is judged supported', () => {
  const outputs = [ans('Q3', [claim('x', ['r0001', 'r0004']), claim('y', ['r0006'])])];
  const m = answerMetrics(outputs, [v(0, 0, 'r0001', false), v(0, 0, 'r0004', true), v(0, 1, 'r0006', false)], d).Q3;
  expect(m.unsupportedClaims).toMatchObject({ k: 1, n: 2 });
});

test('Q1 is correct only when both category and month match', () => {
  const outputs = [
    ans('Q1', [], { category: 'cleanliness', month: '2024-06' }),
    ans('Q1', [], { category: 'cleanliness', month: '2024-07' }),
    ans('Q1', [], { category: 'value', month: '2024-06' }),
  ];
  expect(answerMetrics(outputs, [], d).Q1.q1Correct).toMatchObject({ k: 1, n: 3 });
});

test('Q2 precision counts confirmed complaints from other months as wrong, and reports them as offMonthRelevant', () => {
  const m = answerMetrics([ans('Q2', [claim('dirty', ['r0002', 'r0005', 'r0008'])])], [], d).Q2.q2!;
  expect(m.precision).toMatchObject({ k: 1, n: 3 });
  expect(m.offMonthRelevant).toBe(1);
});

test('Q2 recall is the share of ground-truth ids cited at least once', () => {
  const m = answerMetrics([ans('Q2', [claim('a', ['r0002']), claim('b', ['r0002'])])], [], d).Q2.q2!;
  expect(m.recall).toMatchObject({ k: 1, n: 2 });
});

test('errored outputs are counted, not scored', () => {
  const m = answerMetrics([{ questionId: 'Q3', rep: 1, error: 'boom', usage: u }], [], d).Q3;
  expect(m).toMatchObject({ n: 0, errors: 1, claims: 0 });
});

test('judge agreement is reported per class', () => {
  const checks = [
    { judge: true, owner: true }, { judge: true, owner: false }, { judge: false, owner: false }, { judge: false, owner: false },
  ].map((c, i) => ({ resultFile: 'f', outputIndex: i, claimIndex: 0, reviewId: 'r0001', ...c }));
  const m = answerMetrics([], [], d, checks);
  expect(m.judgeAgreement.onSupported).toMatchObject({ k: 1, n: 2 });
  expect(m.judgeAgreement.onUnsupported).toMatchObject({ k: 2, n: 2 });
});

test('the judge sees id, date, ratings and text', () => {
  const r = d.reviews[0];
  const s = judgeInput('claim', r);
  for (const part of [r.id, r.date, r.text, 'cleanliness 5']) expect(s).toContain(part);
});
