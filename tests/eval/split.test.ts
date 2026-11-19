import { expect, test } from 'vitest';
import { addedLabelIds, makeSplit, sampledLabelIds } from '../../src/eval/split';
import { evalFixture } from './fixtures';

test('added ids are the re-dated reviews plus the next 10 confirmed complaints, in file order', () => {
  expect(addedLabelIds(evalFixture())).toEqual(['r0002', 'r0003', 'r0005', 'r0007', 'r0011', 'r0013', 'r0017', 'r0019', 'r0023', 'r0029', 'r0031', 'r0037']);
});

test('sampled ids are the labelled ones minus the added ones', () => {
  const d = evalFixture();
  const sampled = sampledLabelIds(d);
  expect(sampled).not.toContain('r0002');
  expect(sampled.length + addedLabelIds(d).filter((id) => id in d.labels).length).toBe(30);
});

test('makeSplit is deterministic, disjoint, complete and balanced per language', () => {
  const d = evalFixture();
  const ids = sampledLabelIds(d);
  const lang = (id: string) => d.byId.get(id)!.language;
  const a = makeSplit(ids, lang), b = makeSplit([...ids].reverse(), lang);
  expect(a).toEqual(b);
  expect(a.dev.filter((id) => a.test.includes(id))).toEqual([]);
  expect([...a.dev, ...a.test].sort()).toEqual([...ids].sort());
  for (const l of ['eng', 'fra', 'deu']) {
    const dev = a.dev.filter((id) => lang(id) === l).length, test = a.test.filter((id) => lang(id) === l).length;
    expect(Math.abs(dev - test)).toBeLessThanOrEqual(1);
  }
});

test('makeSplit halves differ by at most one overall, even with many odd-sized languages', () => {
  const ids = ['a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'i1', 'j1'];
  const s = makeSplit(ids, (id) => id[0]); // ten languages with one review each
  expect(Math.abs(s.dev.length - s.test.length)).toBeLessThanOrEqual(1);
});
