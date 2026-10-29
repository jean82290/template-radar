// Configuration from environment variables. Base URLs are overridable for tests.

const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? d : n;
};

export function loadConfig(env = process.env) {
  return {
    githubToken: (env.GITHUB_TOKEN || '').trim(),
    resendApiKey: (env.RESEND_API_KEY || '').trim(),
    emailTo: (env.EMAIL_TO || '').trim(),
    emailFrom: (env.EMAIL_FROM || 'Template Radar <onboarding@resend.dev>').trim(),
    maxResults: int(env.MAX_RESULTS, 8),
    newRepoDays: int(env.NEW_REPO_DAYS, 30),
    minStars: int(env.MIN_STARS, 150),
    topics: (env.TOPICS || 'llm,ai-agents,agents,mcp,rag,generative-ai')
      .split(',').map((s) => s.trim()).filter(Boolean),
    trendingLanguages: (env.TRENDING_LANGUAGES || ',python,typescript,javascript,go,rust')
      .split(',').map((s) => s.trim()), // '' = all languages
    stateFile: env.STATE_FILE || '/data/state.json',
    githubWebUrl: (env.GITHUB_WEB_URL || 'https://github.com').replace(/\/+$/, ''),
    githubApiUrl: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
    githubRawUrl: (env.GITHUB_RAW_URL || 'https://raw.githubusercontent.com').replace(/\/+$/, ''),
    // E-mail time: Railway cron runs in UTC, so the job is scheduled at both UTC hours that can
    // be SEND_HOUR in TIME_ZONE (winter and summer time) and the wrong one exits early.
    sendHour: int(env.SEND_HOUR, 16),
    timeZone: env.TIME_ZONE || 'Europe/Paris',
    railwayIndexUrl: env.RAILWAY_INDEX_URL || 'https://railway.com/deploy/index.json',
    resendApiUrl: env.RESEND_API_URL || 'https://api.resend.com/emails',
    searchDelayMs: int(env.SEARCH_DELAY_MS, env.GITHUB_TOKEN ? 2500 : 7000),
  };
}
