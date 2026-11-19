import { expect, test } from 'vitest';
import { loadListings, loadReviews, normaliseText } from '../src/raw';
import { RATING_KEYS } from '../src/types';

test('normaliseText turns br tags and entities into plain text', () => {
  expect(normaliseText('Great&amp;clean<br/><br/>Would stay again &#39;!')).toBe("Great&clean\n\nWould stay again '!");
  expect(normaliseText('a<br>b<BR />c &quot;x&quot;')).toBe('a\nb\nc "x"');
});

test('loadReviews parses the fixture with normalised text', async () => {
  const rs = await loadReviews('tests/fixtures/reviews.csv');
  expect(rs).toHaveLength(12);
  expect(rs.every((r) => !/<br|&amp;|&#39;/i.test(r.text))).toBe(true);
  expect(rs[0]).toEqual({
    listingId: '1001', sourceId: '1', date: '2022-03-04', reviewerId: '501', reviewerName: 'Anna',
    text: "Great flat&clean\n\nWould stay again '!",
  });
});

test('loadListings maps average sub-scores and host name', async () => {
  const ls = await loadListings('tests/fixtures/listings.csv');
  const l = ls.get('1001')!;
  expect(Object.keys(l.avgScores).sort()).toEqual([...RATING_KEYS].sort());
  expect(l).toMatchObject({ hostName: 'Petr', numberOfReviews: 8, avgScores: { overall: 4.71, cleanliness: 4.52 } });
  expect(ls.get('2002')!.avgScores.accuracy).toBeNull();
});
