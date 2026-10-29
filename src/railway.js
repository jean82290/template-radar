// Railway marketplace check: counts existing templates whose name matches a repository.

export const normalize = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// Generic words removed from repo names before matching ("hermes-agent" stays, "open-webui" -> "openwebui").
export function repoKey(fullName) {
  const name = fullName.split('/').pop();
  return normalize(name);
}

export async function loadRailwayIndex(config, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(config.railwayIndexUrl, {
    headers: { accept: 'application/json', 'user-agent': 'template-radar' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Railway index HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.templates || [];
  return list.map((t) => ({ name: t.name || '', slug: t.slug || '', key: normalize(t.name) }));
}

/** @returns {{ count: number|null, examples: string[] }} count null = name too short to match reliably */
export function railwayMatches(index, fullName) {
  const key = repoKey(fullName);
  if (key.length < 4) return { count: null, examples: [] };
  const hits = index.filter((t) => t.key.includes(key));
  return { count: hits.length, examples: hits.slice(0, 3).map((t) => t.name) };
}
