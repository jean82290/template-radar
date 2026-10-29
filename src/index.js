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
      ...(details ? { createdAt: details.createdAt, topics: details.topics.length ? details.topics : r.topics, files: details.files, dockerServes: details.dockerServes, stars: details.stars || r.stars } : {}),
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
    .map((r) => ({ ...r, isNew: !state.reported[r.fullName.toLowerCase()]?.emailed }));

  const digest = buildDigest(picks, { now, scanned: byName.size, errors });
  const result = await sendEmail(config, digest, { fetchImpl, log });

  // Only an e-mail that actually left counts as "reported"; a dry run (no Resend key) changes nothing.
  if (result.sent) {
    for (const p of picks) {
      const k = p.fullName.toLowerCase();
      state.reported[k] = { firstReported: state.reported[k]?.emailed ? state.reported[k].firstReported : now.toISOString(), lastScore: p.score, emailed: true };
    }
  }
  state.runs.push({ at: now.toISOString(), picks: picks.length, scanned: byName.size, sent: result.sent });
  await saveState(config.stateFile, state, log);

  log.info?.(`[radar] done: ${picks.length} picks, e-mail ${result.sent ? 'sent' : 'not sent'}`);
  return { picks, digest, result, errors };
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return { weekday: get('weekday'), hour: Number(get('hour')) };
}

/**
 * The cron fires on Monday at the two UTC hours that can be SEND_HOUR local time (winter and
 * summer time). The run whose local hour is one off from SEND_HOUR is the wrong one and stops.
 * Manual runs at any other time are never skipped.
 */
export function isWrongScheduledSlot(now, { sendHour, timeZone }) {
  if (now.getUTCMinutes() >= 10) return false; // cron fires at minute 0
  const { weekday, hour } = localParts(now, timeZone);
  return weekday === 'Mon' && Math.abs(hour - sendHour) === 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const cfg = loadConfig();
  if (isWrongScheduledSlot(new Date(), cfg)) {
    console.log(`[radar] not ${cfg.sendHour}:00 in ${cfg.timeZone} yet (summer/winter time slot), skipping this run.`);
    process.exit(0);
  }
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[radar] failed:', err.message);
      process.exit(1);
    });
}
