export {};
type Ratings = Record<string, number>;
type Item = { id: string; language: string; date: string; text: string; ratings?: Ratings };
type Queue = { item: Item | null; done: number; total: number };
type Mode = 'topics' | 'ratings' | 'complaints';

const $ = (id: string) => document.getElementById(id)!;
const HELP: Record<Mode, string> = {
  complaints: 'Is this a genuine complaint about cleanliness?  y = yes, n = no',
  ratings: '↑/↓ pick a rating, ←/→ change it, Enter saves (unchanged = accepted as generated)',
  topics: '1–0 toggle topics, t = translation, Enter saves (no topic is allowed)',
};

const config: { topics: { name: string; description: string }[]; ownerReads: string[] } = await (await fetch('/api/config')).json();
let mode: Mode = (localStorage.getItem('mode') as Mode) || 'complaints';
let current: Queue = { item: null, done: 0, total: 0 };
let chosen = new Set<string>();
let edited: Ratings = {};
let focus = 0;
let viaTranslation = false;

async function call(path: string, init?: RequestInit) {
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body;
}

async function load() {
  current = await call(`/api/queue?mode=${mode}`);
  chosen = new Set(); edited = {}; focus = 0; viaTranslation = false;
  render();
}

function render() {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.mode === mode));
  ($('bar') as HTMLElement).style.width = `${current.total ? (current.done / current.total) * 240 : 0}px`;
  $('count').textContent = `${current.done} / ${current.total}`;
  $('help').textContent = HELP[mode];
  const it = current.item;
  $('translation').hidden = true;
  if (!it) { $('meta').textContent = ''; $('text').textContent = 'All done in this mode.'; $('panel').innerHTML = ''; $('translate').hidden = true; return; }
  $('meta').textContent = `${it.id} · ${it.date} · ${it.language}`;
  $('text').textContent = it.text;
  $('translate').hidden = config.ownerReads.includes(it.language);
  const panel = $('panel');
  if (mode === 'topics') {
    panel.innerHTML = config.topics.map((t, i) => `<button class="topic ${chosen.has(t.name) ? 'on' : ''}" data-topic="${t.name}">${(i + 1) % 10}. ${t.name}<small>${t.description}</small></button>`).join('');
  } else if (mode === 'ratings') {
    const r = { ...it.ratings, ...edited };
    panel.innerHTML = Object.entries(r).map(([k, v], i) => `<div class="rating ${i === focus ? 'focus' : ''} ${k in edited ? 'changed' : ''}"><span>${k}</span><b>${'★'.repeat(v)}${'☆'.repeat(5 - v)} ${v}</b></div>`).join('');
  } else {
    panel.innerHTML = '<div><button data-answer="y">Yes, a cleanliness complaint</button> <button data-answer="n">No</button></div>';
  }
}

async function save(body: Record<string, unknown>) {
  if (!current.item) return;
  try {
    current = await call(`/api/label?mode=${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: current.item.id, ...body }) });
    $('status').textContent = '';
    chosen = new Set(); edited = {}; focus = 0; viaTranslation = false;
    render();
  } catch (e) { $('status').textContent = `Not saved: ${(e as Error).message}`; }
}

async function showTranslation() {
  if (!current.item) return;
  $('status').textContent = 'Translating…';
  try {
    const { translation } = await call(`/api/translate?id=${current.item.id}`);
    $('translation').textContent = translation; $('translation').hidden = false; viaTranslation = true; $('status').textContent = '';
  } catch (e) { $('status').textContent = (e as Error).message; }
}

function toggleTopic(name: string) { chosen.has(name) ? chosen.delete(name) : chosen.add(name); render(); }

function adjust(delta: number) {
  const it = current.item; if (!it?.ratings) return;
  const key = Object.keys(it.ratings)[focus];
  const v = Math.min(5, Math.max(1, (edited[key] ?? it.ratings[key]) + delta));
  if (v === it.ratings[key]) delete edited[key]; else edited[key] = v;
  render();
}

document.querySelector('nav')!.addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).dataset.mode as Mode | undefined;
  if (m) { mode = m; try { localStorage.setItem('mode', m); } catch {} load(); }
});
$('panel').addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest('[data-topic],[data-answer]') as HTMLElement | null;
  if (t?.dataset.topic) toggleTopic(t.dataset.topic);
  if (t?.dataset.answer) save({ confirmed: t.dataset.answer === 'y' });
});
$('translate').addEventListener('click', showTranslation);
document.addEventListener('keydown', (e) => {
  if (!current.item) return;
  if (mode === 'complaints' && (e.key === 'y' || e.key === 'n')) save({ confirmed: e.key === 'y' });
  if (mode === 'topics') {
    const n = '1234567890'.indexOf(e.key);
    if (n > -1 && config.topics[n]) toggleTopic(config.topics[n].name);
    if (e.key === 't' && !$('translate').hidden) showTranslation();
    if (e.key === 'Enter') save({ topics: [...chosen], viaTranslation });
  }
  if (mode === 'ratings') {
    const keys = Object.keys(current.item.ratings ?? {});
    if (e.key === 'ArrowDown') { focus = Math.min(keys.length - 1, focus + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { focus = Math.max(0, focus - 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowRight') adjust(1);
    if (e.key === 'ArrowLeft') adjust(-1);
    if (e.key === 'Enter') save({ corrected: edited });
  }
});

await load();
