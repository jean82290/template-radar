# Template Radar

Chaque lundi matin, un e-mail avec les projets IA qui décollent sur GitHub et qui n'ont pas encore (ou peu) de template sur Railway. Le but : être le premier à publier le template.

## Ce que fait le programme

1. **Collecte** les dépôts de [GitHub Trending](https://github.com/trending?since=weekly) de la semaine (tous langages, Python, TypeScript, JavaScript, Go, Rust), avec le nombre d'étoiles gagnées dans la semaine.
2. **Ajoute** les dépôts IA tout récents (créés depuis 30 jours, au moins 150 étoiles) via la recherche GitHub, par sujet : `llm`, `ai-agents`, `agents`, `mcp`, `rag`, `generative-ai`.
3. **Garde** seulement les projets IA, puis regarde la racine de chaque dépôt : un `Dockerfile` ou un `docker-compose.yml` veut dire « déployable facilement ». Les bibliothèques, SDK, listes « awesome », cours et « skills » sont écartés.
4. **Vérifie Railway** : compte les templates dont le nom contient celui du projet, dans l'index public `https://railway.com/deploy/index.json`.
5. **Classe** par score d'opportunité = étoiles gagnées cette semaine × facilité de déploiement × place libre sur Railway.
6. **Envoie l'e-mail** (en français) avec les 8 meilleurs, en marquant ceux déjà signalés les semaines précédentes.

La vérification Railway se fait par nom : confirmez toujours sur la marketplace avant de vous lancer.

## Réglages (variables Railway)

| Variable | Obligatoire | Par défaut | Rôle |
|---|---|---|---|
| `RESEND_API_KEY` | oui | | Clé API Resend (resend.com → API Keys). |
| `EMAIL_TO` | oui | | Votre adresse : celle de votre compte Resend. |
| `EMAIL_FROM` | non | `Template Radar <onboarding@resend.dev>` | À changer seulement si vous vérifiez un domaine sur Resend. |
| `GITHUB_TOKEN` | non | | Jeton GitHub sans aucune permission : plus de marge sur les limites de l'API. |
| `STATE_FILE` | non | `/data/state.json` | Mémoire des projets déjà signalés (sur un volume Railway monté sur `/data`). |
| `MAX_RESULTS` | non | `8` | Nombre de projets dans l'e-mail. |
| `NEW_REPO_DAYS` | non | `30` | Âge maximum des « nouveaux » dépôts. |
| `MIN_STARS` | non | `150` | Étoiles minimum pour un nouveau dépôt. |
| `TOPICS` | non | `llm,ai-agents,agents,mcp,rag,generative-ai` | Sujets GitHub surveillés. |

Sans `RESEND_API_KEY`, l'e-mail est simplement affiché dans les logs.

## Pourquoi Resend et pas Gmail

Railway bloque l'envoi d'e-mails par SMTP sur les offres Free, Trial et Hobby, et recommande un service d'e-mail par API HTTPS. Resend est gratuit dans cette configuration ; sans nom de domaine vérifié, il n'envoie qu'à l'adresse de votre compte Resend, ce qui suffit pour vous alerter vous-même.

## Planification

`railway.json` lance le programme chaque lundi à 06:00 UTC (7 h à Paris en hiver, 8 h en été), puis le programme s'arrête : vous ne payez que la minute d'exécution et le petit volume.

## Développement

```bash
npm test     # tests avec de faux GitHub, Railway et Resend, aucune dépendance
npm start    # lance une analyse maintenant
```

## Licence

MIT.
