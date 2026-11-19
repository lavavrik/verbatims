import { expect, test } from 'vitest';
import { classificationMetrics, consistencyMetrics, prf, topicCounts, type ClassifyOutput } from '../../src/eval/classifyMetrics';
import { wilson } from '../../src/eval/stats';
import { evalFixture } from './fixtures';

const u = { input: 1, output: 1 };
const out = (id: string, topics: string[] | undefined, rep = 1, error?: string): ClassifyOutput => ({ id, rep, topics, error, usage: u });

test('wilson(38, 38) is 1 with a lower bound below 1; wilson(0, 0) is null', () => {
  const w = wilson(38, 38)!;
  expect(w.rate).toBe(1);
  expect(w.high).toBeCloseTo(1, 10);
  expect(w.low).toBeGreaterThan(0.85);
  expect(w.low).toBeLessThan(1);
  expect(wilson(0, 0)).toBeNull();
});

test('prf handles zero denominators as null, not NaN', () => {
  const r = prf([new Set()], [new Set()]);
  expect(r).toMatchObject({ precision: null, recall: null, f1: null, tp: 0, fp: 0, fn: 0 });
  const t = prf([new Set(['a'])], [new Set(['b'])], 'c');
  expect(t.precision).toBeNull();
});

test('prf counts true/false positives over (review, topic) pairs', () => {
  const r = prf([new Set(['a', 'b']), new Set(['a'])], [new Set(['a']), new Set(['a', 'c'])]);
  expect(r).toMatchObject({ tp: 2, fp: 1, fn: 1 });
  expect(r.precision).toBeCloseTo(2 / 3, 10);
  expect(r.f1).toBeCloseTo(2 / 3, 10);
});

const split = (d: ReturnType<typeof evalFixture>) => ({
  sampled: { test: ['r0001', 'r0004', 'r0006', 'r0008'], dev: ['r0009', 'r0010'] },
  added: ['r0002', 'r0003'],
});

test('exact-set agreement counts identical sets only, order-insensitive', () => {
  const d = evalFixture();
  const outputs = Object.keys(d.labels).map((id) => out(id, id === 'r0004' ? ['location', 'noise'] : ['location']));
  const m = classificationMetrics(outputs, d, split(d));
  expect(m.test.n).toBe(4);
  expect(m.test.exactSet!.rate).toBeCloseTo(3 / 4, 10);
  expect(m.all.n).toBe(30);
});

test('errored outputs are excluded and counted; only rep 1 is scored', () => {
  const d = evalFixture();
  const outputs = [
    ...Object.keys(d.labels).map((id) => (id === 'r0001' ? out(id, undefined, 1, 'refused') : out(id, ['location']))),
    out('r0004', ['noise'], 2),
  ];
  const m = classificationMetrics(outputs, d, split(d));
  expect(m.test).toMatchObject({ n: 3, errors: 1 });
  expect(m.test.exactSet!.rate).toBe(1);
});

test('languages under 5 labels fold into other; without-translation drops viaTranslation labels', () => {
  const d = evalFixture(); // labelled: 18 eng, 6 fra, 6 deu (deu labels are via translation)
  const outputs = Object.keys(d.labels).map((id) => out(id, ['location']));
  const m = classificationMetrics(outputs, d, split(d));
  expect(Object.keys(m.all.perLanguage).sort()).toEqual(['deu', 'eng', 'fra']);
  expect(Object.keys(m.test.perLanguage)).toEqual(['other']);
  expect(m.all.withoutTranslated.n).toBe(24);
});

test('consistency: identical reps → stable 100%, Jaccard 1; one flip → topic flipRate 1/n', () => {
  const same = [1, 2, 3].flatMap((rep) => [out('r0001', ['location'], rep), out('r0002', ['noise'], rep)]);
  const c1 = consistencyMetrics(same, ['r0001', 'r0002']);
  expect(c1.stable!.rate).toBe(1);
  expect(c1.meanJaccard).toBe(1);
  const flip = [...same.filter((o) => !(o.id === 'r0002' && o.rep === 3)), out('r0002', ['noise', 'location'], 3)];
  const c2 = consistencyMetrics(flip, ['r0001', 'r0002']);
  expect(c2.stable!.rate).toBe(0.5);
  expect(c2.flipRate.location).toBe(0.5);
  expect(c2.flipRate.noise).toBe(0);
  expect(c2.unstable).toEqual(['r0002']);
});

test('consistency skips ids with fewer than two good reps', () => {
  const c = consistencyMetrics([out('r0001', ['location'], 1), out('r0001', undefined, 2, 'err')], ['r0001']);
  expect(c).toMatchObject({ n: 0, skipped: 1 });
  expect(c.stable).toBeNull();
});

test('topicCounts counts rep 1 over all reviews', () => {
  expect(topicCounts([out('r1', ['a', 'b']), out('r2', ['a']), out('r1', ['c'], 2)])).toEqual({ a: 2, b: 1 });
});
