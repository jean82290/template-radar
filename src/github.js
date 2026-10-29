// GitHub data: the weekly Trending pages (stars gained this week) and the
// Search API (brand-new AI repositories), plus repository details for scoring.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' };

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e);
}

const clean = (html) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const num = (s) => Number.parseInt(String(s).replace(/[^\d]/g, ''), 10) || 0;

/** Parses github.com/trending HTML into [{ fullName, description, language, stars, starsThisPeriod }]. */
export function parseTrending(html) {
  const out = [];
  const blocks = html.split(/<article\b[^>]*class="[^"]*Box-row[^"]*"[^>]*>/).slice(1);
  for (const block of blocks) {
    const body = block.split('</article>')[0];
    const link = body.match(/<h2[^>]*>[\s\S]*?<a\b[^>]*href="\/([^"/?#]+\/[^"/?#]+)"/);
    if (!link) continue;
    const fullName = decode(link[1]);
    const desc = body.match(/<p\b[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const lang = body.match(/itemprop="programmingLanguage"[^>]*>([^<]*)</);
    const starsEsc = fullName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const total = body.match(new RegExp(`href="/${starsEsc}/stargazers"[^>]*>([\\s\\S]*?)</a>`));
    const period = body.match(/([\d,.\s]+)\s+stars?\s+(?:this week|today|this month)/i);
    out.push({
      fullName,
      description: desc ? clean(desc[1]) : '',
      language: lang ? clean(lang[1]) : '',
      stars: total ? num(clean(total[1])) : 0,
      starsThisPeriod: period ? num(period[1]) : 0,
      source: 'trending',
    });
  }
  return out;
}

export function createGitHub(config, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console } = {}) {
  const apiHeaders = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'template-radar',
    ...(config.githubToken ? { authorization: `Bearer ${config.githubToken}` } : {}),
  };

  async function api(path) {
    const res = await fetchImpl(`${config.githubApiUrl}${path}`, { headers: apiHeaders, signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status} on ${path.split('?')[0]}: ${body.slice(0, 160)}`);
    }
    return res.json();
  }

  return {
    async trending() {
      const all = new Map();
      for (const lang of config.trendingLanguages) {
        const url = `${config.githubWebUrl}/trending${lang ? `/${encodeURIComponent(lang)}` : ''}?since=weekly`;
        try {
          const res = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (template-radar)', accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          for (const repo of parseTrending(await res.text())) {
            const prev = all.get(repo.fullName.toLowerCase());
            if (!prev || repo.starsThisPeriod > prev.starsThisPeriod) all.set(repo.fullName.toLowerCase(), repo);
          }
        } catch (err) {
          log.error?.(`[github] trending ${lang || 'all'} failed: ${err.message}`);
        }
      }
      return [...all.values()];
    },

    // Repositories created recently that already gathered many stars, per AI topic.
    async newRepos(now = new Date()) {
      const since = new Date(now.getTime() - config.newRepoDays * 86400000).toISOString().slice(0, 10);
      const all = new Map();
      for (const [i, topic] of config.topics.entries()) {
        if (i > 0) await sleep(config.searchDelayMs); // stays under the Search API rate limit
        const q = encodeURIComponent(`topic:${topic} created:>${since} stars:>=${config.minStars} archived:false`);
        try {
          const data = await api(`/search/repositories?q=${q}&sort=stars&order=desc&per_page=30`);
          for (const r of data?.items || []) {
            if (all.has(r.full_name.toLowerCase())) continue;
            all.set(r.full_name.toLowerCase(), {
              fullName: r.full_name,
              description: r.description || '',
              language: r.language || '',
              stars: r.stargazers_count,
              createdAt: r.created_at,
              topics: r.topics || [],
              source: 'new',
            });
          }
        } catch (err) {
          log.error?.(`[github] search topic:${topic} failed: ${err.message}`);
        }
      }
      return [...all.values()];
    },

    // Root file names, topics, creation date, archive and fork flags for one repository,
    // plus whether its Docker setup actually serves something on a port.
    async details(fullName) {
      const [repo, contents] = await Promise.all([
        api(`/repos/${fullName}`),
        api(`/repos/${fullName}/contents/`),
      ]);
      if (!repo) return null;
      const files = Array.isArray(contents) ? contents.map((c) => c.name) : [];
      return {
        createdAt: repo.created_at,
        topics: repo.topics || [],
        homepage: repo.homepage || '',
        archived: Boolean(repo.archived),
        fork: Boolean(repo.fork),
        license: repo.license?.spdx_id || '',
        stars: repo.stargazers_count,
        files,
        dockerServes: await dockerServes(fullName, files),
      };
    },
  };

  // Raw file contents come from raw.githubusercontent.com, which does not use the API quota.
  async function raw(fullName, path) {
    try {
      const res = await fetchImpl(`${config.githubRawUrl}/${fullName}/HEAD/${path}`, {
        headers: { 'user-agent': 'template-radar' },
        signal: AbortSignal.timeout(15000),
      });
      return res.ok ? (await res.text()).slice(0, 200000) : '';
    } catch {
      return '';
    }
  }

  // A Dockerfile that only runs a one-shot command (a scanner, a CLI) is not a template.
  // It serves something when it EXPOSEs a port, starts a web server, or compose maps ports.
  async function dockerServes(fullName, files) {
    const dockerfile = files.find((f) => /^dockerfile$/i.test(f));
    const compose = files.find((f) => /^(docker-)?compose\.ya?ml$/i.test(f));
    if (dockerfile && servesFromDockerfile(await raw(fullName, dockerfile))) return true;
    if (compose && /^\s*ports\s*:/m.test(await raw(fullName, compose))) return true;
    return false;
  }
}

export function servesFromDockerfile(text) {
  return /^\s*EXPOSE\s+\S+/mi.test(text)
    || /\b(uvicorn|gunicorn|hypercorn|--port\b|--listen\b|--host[= ]0\.0\.0\.0|next start|serve\b)/i.test(text);
}
