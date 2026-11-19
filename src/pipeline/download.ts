import { mkdir, writeFile } from 'node:fs/promises';
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

/** Downloads the raw files into raw/ (git-ignored: they contain personal data). */
export async function download(dir = 'raw'): Promise<SourceInfo> {
  await mkdir(dir, { recursive: true });
  await fetchTo(REVIEWS_URL, `${dir}/reviews.csv.gz`);
  await fetchTo(LISTINGS_URL, `${dir}/listings.csv.gz`);
  const info: SourceInfo = { reviewsUrl: REVIEWS_URL, listingsUrl: LISTINGS_URL, scrapeDate: SCRAPE_DATE, downloadedAt: new Date().toISOString().slice(0, 10) };
  await writeFile(`${dir}/source.json`, JSON.stringify(info, null, 2));
  return info;
}
