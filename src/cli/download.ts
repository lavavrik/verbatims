import { download } from '../pipeline/download';
const info = await download();
console.log(`Downloaded Prague scrape ${info.scrapeDate} into raw/ on ${info.downloadedAt}.`);
