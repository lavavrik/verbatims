import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { z } from 'zod';
import { readJsonOr } from '../src/decisions';
import { createLabelStore, OWNER_READS, type Mode } from '../src/labelApi';
import { callStructured } from '../src/llm';
import type { RatingsDecision } from '../src/pipeline/rate';
import { applyRedactions, type Redaction } from '../src/pipeline/redact';
import { loadSampled } from '../src/workspace';

async function makeStore() {
  const { items } = await loadSampled();
  const redactions = await readJsonOr<Redaction[]>('decisions/redactions.json', []);
  const ratings = await readJsonOr<RatingsDecision | null>('decisions/ratings.json', null);
  const redate = await readJsonOr<{ moves: { id: string }[] } | null>('decisions/redate.json', null);
  return createLabelStore({
    dir: '.',
    items: items.map((it) => ({
      id: it.id,
      language: it.language,
      date: it.source.date,
      text: applyRedactions(it.source.text, redactions.filter((r) => r.id === it.id)),
      ratings: ratings?.results[it.id],
    })),
    redated: redate?.moves.map((m) => m.id),
    translate: async (text) =>
      (await callStructured(z.object({ translation: z.string() }), 'Translate this guest review into English. Keep "[name]" placeholders as they are.', text)).translation,
  });
}

function api(): Plugin {
  return {
    name: 'label-api',
    async configureServer(server) {
      const store = await makeStore();
      const topics = await readJsonOr('topics.json', []);
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', 'http://local');
        const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        try {
          const mode = url.searchParams.get('mode') as Mode;
          if (url.pathname === '/config') return send(200, { topics, ownerReads: OWNER_READS });
          if (url.pathname === '/queue') return send(200, store.nextItem(mode));
          if (url.pathname === '/translate') return send(200, { translation: await store.translate(url.searchParams.get('id') ?? '') });
          if (url.pathname === '/label' && req.method === 'POST') {
            let raw = '';
            for await (const chunk of req) raw += chunk;
            await store.saveLabel(mode, JSON.parse(raw));
            return send(200, store.nextItem(mode));
          }
          send(404, { error: 'not found' });
        } catch (e) {
          send(400, { error: (e as Error).message });
        }
      });
    },
  };
}

export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), plugins: [api()], server: { host: '127.0.0.1' } });
