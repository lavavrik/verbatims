import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { SourceInfo } from '../types';

export const SCRAPE_DATE = '2026-09-20';
const BASE = `https://data.insideairbnb.com/czech-republic/prague/prague/${SCRAPE_DATE}/data`;
export const REVIEWS_URL = `${BASE}/reviews.csv.gz`;
export const LISTINGS_URL = `${BASE}/listings.csv.gz`;

async function fetchTo(url: string, path: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}. Check insideairbnb.com/get-the-data for the current Prague link.`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
}

export const sha256File = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');

type Hashes = { reviewsSha256: string; listingsSha256: string };

/** Problems if the raw files differ from the ones the decisions were made on. */
export function checkRawHashes(expected: Hashes, actual: Hashes): string[] {
  const out: string[] = [];
  if (expected.reviewsSha256 !== actual.reviewsSha256) out.push('raw/reviews.csv.gz differs from the file the decisions were made on');
  if (expected.listingsSha256 !== actual.listingsSha256) out.push('raw/listings.csv.gz differs from the file the decisions were made on');
  return out;
}

/**
 * Downloads the raw files into raw/ (git-ignored: they contain personal data). The first
 * download is also recorded in decisions/source.json (committed: URLs, dates, file hashes),
 * which the build reads, so a later re-download can't change the published manifest.
 */
export async function download(dir = 'raw'): Promise<SourceInfo> {
  await mkdir(dir, { recursive: true });
  await fetchTo(REVIEWS_URL, `${dir}/reviews.csv.gz`);
  await fetchTo(LISTINGS_URL, `${dir}/listings.csv.gz`);
  const info: SourceInfo = {
    reviewsUrl: REVIEWS_URL, listingsUrl: LISTINGS_URL, scrapeDate: SCRAPE_DATE, downloadedAt: new Date().toISOString().slice(0, 10),
    reviewsSha256: await sha256File(`${dir}/reviews.csv.gz`), listingsSha256: await sha256File(`${dir}/listings.csv.gz`),
  };
  if (!existsSync('decisions/source.json')) {
    await mkdir('decisions', { recursive: true });
    await writeFile('decisions/source.json', JSON.stringify(info, null, 2) + '\n');
  } else {
    const recorded = JSON.parse(await readFile('decisions/source.json', 'utf8')) as SourceInfo;
    const problems = checkRawHashes(recorded, info);
    if (problems.length) console.warn(problems.join('\n') + '\nThe build will refuse to run until the files match decisions/source.json.');
  }
  return info;
}
