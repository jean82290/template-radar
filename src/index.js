// Weekly run: collect candidates, keep AI repositories, check how deployable they
// are and whether Railway already has a template, then e-mail the best ones.

import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { createGitHub } from './github.js';
import { loadRailwayIndex, railwayMatches } from './railway.js';
import { isAI, deployability, weeklyStars, score } from './score.js';
import { buildDigest, sendEmail } from './email.js';
import { loadState, saveState, prune } from './state.js';

const MAX_DETAIL_LOOKUPS = 25;

export async function run({ env = process.env, fetchImpl = fetch, sleep, log = console, now = new Date() } = {}) {
  const config = loadConfig(env);
  const errors = [];
  const gh = createGitHub(config, { fetchImpl, sleep, log });

  const [trending, fresh, railwayIndex] = await Promise.all([
    gh.trending(),
    gh.newRepos(now),
    loadRailwayIndex(config, { fetchImpl }).catch((err) => {
      errors.push(`index Railway indisponible (${err.message})`);
      return null;
    }),
  ]);
  if (trending.length === 0) errors.push('GitHub Trending vide ou inaccessible');
  log.info?.(`[radar] trending=${trending.length} new=${fresh.length} railwayTemplates=${railwayIndex?.length ?? 'n/a'}`);

  // Merge both sources; Trending's weekly star count wins when a repo is in both.
  const byName = new Map();
  for (const r of [...fresh, ...trending]) {
    const k = r.fullName.toLowerCase();
    byName.set(k, { ...byName.get(k), ...r, topics: r.topics || byName.get(k)?.topics || [] });
  }
  const candidates = [...byName.values()]
    .filter(isAI)
    .map((r) => ({ ...r, weekly: weeklyStars(r, now) }))
    .sort((a, b) => b.weekly - a.weekly)
    .slice(0, MAX_DETAIL_LOOKUPS);

  const scored = [];
  for (const r of candidates) {
    let details = null;
    try {
      details = await gh.details(r.fullName);
    } catch (err) {
      log.error?.(`[radar] details ${r.fullName}: ${err.message}`);
    }
    if (details?.archived || details?.fork) continue;
    const repo = {
      ...r,
      ...(details ? { createdAt: details.createdAt, topics: details.topics.length ? details.topics : r.topics, files: details.files, stars: details.stars || r.stars } : {}),
    };
    repo.weekly = weeklyStars(repo, now);
    repo.deploy = deployability(repo);
    repo.railway = railwayIndex ? railwayMatches(railwayIndex, repo.fullName) : { count: null, examples: [] };
    repo.score = score(repo);
    scored.push(repo);
  }

  const state = prune(await loadState(config.stateFile, log), now);
  const picks = scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxResults)
    .map((r) => ({ ...r, isNew: !state.reported[r.fullName.toLowerCase()] }));

  const digest = buildDigest(picks, { now, scanned: byName.size, errors });
  const result = await sendEmail(config, digest, { fetchImpl, log });

  for (const p of picks) {
    const k = p.fullName.toLowerCase();
    state.reported[k] = { firstReported: state.reported[k]?.firstReported || now.toISOString(), lastScore: p.score };
  }
  state.runs.push({ at: now.toISOString(), picks: picks.length, scanned: byName.size, sent: result.sent });
  await saveState(config.stateFile, state, log);

  log.info?.(`[radar] done: ${picks.length} picks, e-mail ${result.sent ? 'sent' : 'not sent'}`);
  return { picks, digest, result, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[radar] failed:', err.message);
      process.exit(1);
    });
}
