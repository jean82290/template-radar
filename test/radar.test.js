import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTrending } from '../src/github.js';
import { isAI, deployability, weeklyStars, score } from '../src/score.js';
import { railwayMatches, normalize } from '../src/railway.js';
import { buildDigest } from '../src/email.js';
import { run } from '../src/index.js';

// Same structure as github.com/trending (checked against the live page on 2026-10-29).
function trendingHtml(rows) {
  return `<html><body><div class="Box">${rows.map((r) => `
  <article class="Box-row">
    <div class="float-right"><a href="/login?return_to=%2F${r.name}">Star</a></div>
    <h2 class="h3 lh-condensed">
      <a data-view-component="true" class="Link" href="/${r.name}"><svg aria-hidden="true"><path d="M0"></path></svg>
        <span data-view-component="true" class="text-normal">${r.name.split('/')[0]} /</span>
        ${r.name.split('/')[1]}
      </a>
    </h2>
    <p class="col-9 color-fg-muted my-1 tmp-pr-4">
      ${r.desc}
    </p>
    <div class="f6 color-fg-muted mt-2">
      ${r.lang ? `<span class="d-inline-block ml-0 mr-3"><span class="repo-language-color"></span><span itemprop="programmingLanguage">${r.lang}</span></span>` : ''}
      <a class="Link Link--muted d-inline-block mr-3" href="/${r.name}/stargazers"><svg><path d="M1"></path></svg>
        ${r.stars}</a>
      <a class="Link Link--muted d-inline-block mr-3" href="/${r.name}/forks"><svg></svg> 1,024</a>
      <span class="d-inline-block float-sm-right"><svg></svg>
        ${r.week} stars this week</span>
    </div>
  </article>`).join('')}</div></body></html>`;
}

test('parses the GitHub Trending page', () => {
  const rows = parseTrending(trendingHtml([
    { name: 'acme/agent-hub', desc: 'Self-hosted AI agent platform &amp; web UI', lang: 'TypeScript', stars: '12,345', week: '3,210' },
    { name: 'foo/no-lang', desc: 'A list', lang: '', stars: '99', week: '12' },
  ]));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    fullName: 'acme/agent-hub', description: 'Self-hosted AI agent platform & web UI', language: 'TypeScript',
    stars: 12345, starsThisPeriod: 3210, source: 'trending',
  });
  assert.equal(rows[1].language, '');
});

test('AI detection, deployability and scoring', () => {
  assert.ok(isAI({ fullName: 'x/hermes-agent', description: 'An autonomous agent' }));
  assert.ok(isAI({ fullName: 'x/thing', description: 'fast tool', topics: ['llm'] }));
  assert.ok(!isAI({ fullName: 'php/php-src', description: 'The PHP Interpreter' }));

  assert.equal(deployability({ description: 'Self-hosted AI chat', files: ['Dockerfile', 'src'] }).level, 'docker');
  assert.equal(deployability({ description: 'Self-hosted AI web UI server', files: ['package.json'] }).level, 'server');
  assert.equal(deployability({ description: 'Python SDK for LLM agents', files: ['pyproject.toml'] }).level, 'weak');
  assert.equal(deployability({ description: 'Awesome list of AI agents', files: ['README.md'] }).level, 'no');
  assert.equal(deployability({ description: 'Agent skills for Claude Code', files: ['SKILL.md'] }).level, 'no');

  const now = new Date('2026-11-02T06:00:00Z');
  assert.equal(weeklyStars({ starsThisPeriod: 500 }, now), 500);
  assert.equal(weeklyStars({ stars: 1400, createdAt: '2026-10-19T06:00:00Z' }, now), 700, '14 days old: half its stars this week');
  assert.equal(weeklyStars({ stars: 300, createdAt: '2026-10-30T06:00:00Z' }, now), 300, 'younger than a week: all of them');

  const base = { weekly: 1000, deploy: { level: 'docker' } };
  assert.equal(score({ ...base, railway: { count: 0 } }), 1000);
  assert.equal(score({ ...base, railway: { count: 2 } }), 350);
  assert.equal(score({ ...base, railway: { count: 40 } }), 100);
  assert.equal(score({ ...base, deploy: { level: 'no' }, railway: { count: 0 } }), 0);
});

test('Railway matching by name', () => {
  const index = ['Hermes Agent by Nous Research', 'Hermes Agent', 'N8N (w/ workers)', 'Open WebUI'].map((name) => ({ name, key: normalize(name) }));
  assert.deepEqual(railwayMatches(index, 'NousResearch/hermes-agent').count, 2);
  assert.equal(railwayMatches(index, 'open-webui/open-webui').count, 1);
  assert.equal(railwayMatches(index, 'acme/brand-new-thing').count, 0);
  assert.equal(railwayMatches(index, 'x/ai').count, null, 'too short to match reliably');
});

test('digest is in French and lists the picks', () => {
  const pick = {
    fullName: 'acme/agent-hub', description: 'Self-hosted AI agent platform', stars: 12345, weekly: 3210, language: 'TypeScript',
    createdAt: '2026-10-20T00:00:00Z', deploy: { level: 'docker', reasons: ['Dockerfile'] }, railway: { count: 0, examples: [] }, score: 3210, isNew: true,
  };
  const d = buildDigest([pick], { now: new Date('2026-11-02T06:00:00Z'), scanned: 42 });
  assert.match(d.subject, /1 projet IA à saisir \(1 nouveau\)/);
  assert.match(d.text, /acme\/agent-hub \[NOUVEAU\]/);
  assert.match(d.text, /Aucun template Railway/);
  assert.match(d.html, /href="https:\/\/github\.com\/acme\/agent-hub"/);
  assert.match(buildDigest([], { scanned: 3 }).subject, /rien de solide/);
});

test('end-to-end weekly run with fake GitHub, Railway and Resend', async () => {
  const sent = [];
  const pages = {
    '': trendingHtml([
      { name: 'acme/agent-hub', desc: 'Self-hosted AI agent platform with web UI', lang: 'TypeScript', stars: '12,345', week: '3,210' },
      { name: 'php/php-src', desc: 'The PHP Interpreter', lang: 'C', stars: '41,000', week: '1,200' },
      { name: 'nous/hermes-agent', desc: 'Autonomous AI agent with tools', lang: 'Python', stars: '50,000', week: '9,000' },
      { name: 'cool/llm-sdk', desc: 'Python SDK for LLM apps', lang: 'Python', stars: '8,000', week: '2,500' },
    ]),
  };
  const repos = {
    'acme/agent-hub': { files: ['Dockerfile', 'package.json'], created_at: '2026-10-01T00:00:00Z' },
    'nous/hermes-agent': { files: ['Dockerfile'], created_at: '2026-01-01T00:00:00Z' },
    'cool/llm-sdk': { files: ['pyproject.toml'], created_at: '2026-06-01T00:00:00Z' },
    'fresh/rag-server': { files: ['docker-compose.yml'], created_at: '2026-10-28T00:00:00Z' },
  };

  const fakeFetch = async (url, init = {}) => {
    const u = new URL(url);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u.host === 'gh.test') {
      const lang = u.pathname.replace(/^\/trending\/?/, '');
      return new Response(pages[lang] ?? trendingHtml([]), { status: 200 });
    }
    if (u.host === 'api.test') {
      if (u.pathname === '/search/repositories') {
        const q = u.searchParams.get('q');
        assert.match(q, /created:>2026-10-03/);
        return json({ items: q.includes('topic:rag') ? [{ full_name: 'fresh/rag-server', description: 'RAG server you can self-host', language: 'Go', stargazers_count: 900, created_at: '2026-10-28T00:00:00Z', topics: ['rag'] }] : [] });
      }
      const m = u.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/contents\/)?$/);
      const r = m && repos[m[1]];
      if (!r) return json({ message: 'Not Found' }, 404);
      if (m[2]) return json(r.files.map((name) => ({ name, type: 'file' })));
      return json({ created_at: r.created_at, topics: [], stargazers_count: 0, archived: false, fork: false });
    }
    if (u.host === 'railway.test') {
      return json([{ slug: 'a', name: 'Hermes Agent by Nous Research' }, { slug: 'b', name: 'Hermes Agent' }, { slug: 'c', name: 'Hermes Agent (Updated)' }]);
    }
    if (u.host === 'resend.test') {
      assert.equal(init.headers.authorization, 'Bearer re_test');
      sent.push(JSON.parse(init.body));
      return json({ id: 'email_1' });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const env = {
    GITHUB_WEB_URL: 'http://gh.test', GITHUB_API_URL: 'http://api.test', RAILWAY_INDEX_URL: 'http://railway.test/index.json',
    RESEND_API_URL: 'http://resend.test/emails', RESEND_API_KEY: 're_test', EMAIL_TO: 'me@example.com',
    STATE_FILE: join(dir, 'state.json'), TRENDING_LANGUAGES: ',python', SEARCH_DELAY_MS: '0',
  };
  const quiet = { info() {}, error() {} };
  const now = new Date('2026-11-02T06:00:00Z');

  const first = await run({ env, fetchImpl: fakeFetch, log: quiet, now, sleep: async () => {} });
  const names = first.picks.map((p) => p.fullName);
  assert.deepEqual(names, ['acme/agent-hub', 'nous/hermes-agent', 'fresh/rag-server'], 'ranked by score, PHP and the SDK filtered out');
  assert.equal(first.picks[0].railway.count, 0);
  assert.equal(first.picks[1].railway.count, 3);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['me@example.com']);
  assert.match(sent[0].from, /onboarding@resend\.dev/);
  assert.match(sent[0].subject, /3 projets IA à saisir \(3 nouveaux\)/);

  const state = JSON.parse(await readFile(env.STATE_FILE, 'utf8'));
  assert.ok(state.reported['acme/agent-hub']);
  assert.equal(state.runs.length, 1);

  const second = await run({ env, fetchImpl: fakeFetch, log: quiet, now: new Date('2026-11-09T06:00:00Z'), sleep: async () => {} });
  assert.ok(second.picks.every((p) => !p.isNew), 'a week later the same repos are marked as already reported');
  assert.match(sent[1].subject, /\(0 nouveau\)/);

  // A dry run (no Resend key) must not mark anything as reported.
  const dryState = join(dir, 'dry.json');
  const dryEnv = { ...env, RESEND_API_KEY: '', STATE_FILE: dryState };
  await run({ env: dryEnv, fetchImpl: fakeFetch, log: quiet, now, sleep: async () => {} });
  const afterDry = await run({ env: { ...dryEnv, RESEND_API_KEY: 're_test' }, fetchImpl: fakeFetch, log: quiet, now, sleep: async () => {} });
  assert.ok(afterDry.picks.every((p) => p.isNew), 'picks found during a dry run are still new in the first real e-mail');
});

test('without Resend settings the digest is printed, not sent', async () => {
  const lines = [];
  const fakeFetch = async (url) => {
    const u = new URL(url);
    if (u.host === 'railway.test') return new Response('[]', { status: 200 });
    if (u.host === 'api.test') return new Response(JSON.stringify({ items: [] }), { status: 200 });
    return new Response(trendingHtml([]), { status: 200 });
  };
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const out = await run({
    env: { GITHUB_WEB_URL: 'http://gh.test', GITHUB_API_URL: 'http://api.test', RAILWAY_INDEX_URL: 'http://railway.test/i', STATE_FILE: join(dir, 's.json'), TRENDING_LANGUAGES: '', SEARCH_DELAY_MS: '0' },
    fetchImpl: fakeFetch, log: { info: (l) => lines.push(l), error() {} }, sleep: async () => {},
  });
  assert.equal(out.result.sent, false);
  assert.ok(lines.some((l) => /rien de solide/.test(l)));
  assert.ok(out.errors.some((e) => /Trending/.test(e)));
});
