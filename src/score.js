// Decides whether a repository is about AI, whether it can become a Railway
// template (a long-running server), and how big the opportunity is.

const AI_WORDS = /\b(ai|a\.i\.|llms?|gpt|agents?|agentic|rag|mcp|claude|openai|anthropic|gemini|deepseek|qwen|llama|ollama|mistral|diffusion|transformers?|embeddings?|vector|chatbot|copilot|inference|genai|generative|machine learning|ml|neural|speech|tts|voice|whisper|multimodal|vlm|prompt)\b/i;
const AI_TOPICS = /^(ai|llm|llms|ai-agent|ai-agents|agents|agent|mcp|rag|generative-ai|genai|chatgpt|openai|claude|gemini|deepseek|ollama|local-llm|langchain|llmops|machine-learning|deep-learning|artificial-intelligence)$/;

const SERVER_WORDS = /\b(self[- ]?host(?:ed|able)?|server|web ?ui|webui|dashboard|platform|gateway|proxy|api|backend|bot|service|app|workflow|automation|chat ui|studio|playground|hub|router)\b/i;
const NOT_DEPLOYABLE = /\b(awesome|curated list|list of|tutorials?|course|paper|papers|dataset|benchmark|prompts?|cheat ?sheet|roadmap|book|interview|notes|guide|skills?)\b/i;
const LIBRARY_WORDS = /\b(library|sdk|framework|cli|command[- ]line|vs ?code|extension|plugin|python package|npm package|desktop app|ios|android|chrome extension|scanner|linter)\b/i;
// Things that run on the user's own machine or in their browser: nothing to host on Railway.
const LOCAL_APP_WORDS = /\b(desktop|games?|cad|3d model(?:l)?ing|parametric|wasm|webassembly|browser extension|chrome extension|firefox add-?on|vs ?code|neovim|vim|emacs|jetbrains|ios|android|mobile app|macos app|windows app|electron|tauri|egui|game engine)\b/i;

const DOCKER_FILES = /^(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i;
const RAILWAY_FILES = /^(railway\.json|railway\.toml)$/i;
const RUNTIME_FILES = /^(package\.json|pyproject\.toml|requirements\.txt|go\.mod|cargo\.toml|procfile|nixpacks\.toml)$/i;

export function isAI(repo) {
  const text = `${repo.fullName.split('/').pop().replace(/[-_]/g, ' ')} ${repo.description || ''}`;
  return AI_WORDS.test(text) || (repo.topics || []).some((t) => AI_TOPICS.test(t));
}

/** @returns {{ level: 'docker'|'server'|'weak'|'no', reasons: string[] }} */
export function deployability(repo) {
  const files = repo.files || [];
  const text = `${repo.description || ''} ${(repo.topics || []).join(' ')}`;
  const docker = files.find((f) => DOCKER_FILES.test(f));
  const railway = files.find((f) => RAILWAY_FILES.test(f));
  // dockerServes is known only after details(); undefined means "not checked" and keeps the old behaviour.
  const serves = railway || (docker && repo.dockerServes !== false);

  if (serves) return { level: 'docker', reasons: [railway || docker, ...(repo.dockerServes ? ['ouvre un port'] : [])] };
  if (LOCAL_APP_WORDS.test(text)) return { level: 'no', reasons: ['application de bureau, navigateur ou jeu'] };
  if (NOT_DEPLOYABLE.test(text)) return { level: 'no', reasons: ['liste, cours ou contenu'] };
  if (docker) return { level: 'weak', reasons: ['Dockerfile sans port : outil en ligne de commande'] };
  const server = SERVER_WORDS.test(text);
  const runtime = files.some((f) => RUNTIME_FILES.test(f));
  if (server && runtime && !LIBRARY_WORDS.test(text)) return { level: 'server', reasons: ['serveur sans Dockerfile'] };
  if (LIBRARY_WORDS.test(text)) return { level: 'weak', reasons: ['bibliothèque ou outil local'] };
  return { level: runtime ? 'weak' : 'no', reasons: runtime ? ['pas de serveur évident'] : ['rien à déployer'] };
}

/** Estimated stars per week: Trending gives it directly, new repos use their age. */
export function weeklyStars(repo, now = new Date()) {
  if (repo.starsThisPeriod) return repo.starsThisPeriod;
  if (!repo.createdAt) return 0;
  const days = Math.max(1, (now.getTime() - new Date(repo.createdAt).getTime()) / 86400000);
  return Math.round((repo.stars / days) * Math.min(7, days));
}

// Libraries, CLIs and content repos cannot become a Railway template: they score 0 and stay out of the e-mail.
const DEPLOY_FACTOR = { docker: 1, server: 0.5, weak: 0, no: 0 };

export function score(repo) {
  const deploy = DEPLOY_FACTOR[repo.deploy?.level ?? 'no'];
  const count = repo.railway?.count;
  const competition = count === null || count === undefined ? 0.6 : count === 0 ? 1 : count <= 2 ? 0.35 : 0.1;
  return Math.round(repo.weekly * deploy * competition);
}
