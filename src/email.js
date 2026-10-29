// French e-mail digest, sent through the Resend HTTP API (Railway blocks SMTP
// on Free/Trial/Hobby plans, HTTPS APIs are the supported way).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
const short = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s || '');

function weekLabel(now) {
  return now.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
}

function ageLabel(createdAt, now) {
  if (!createdAt) return '';
  const days = Math.round((now - new Date(createdAt)) / 86400000);
  if (days < 1) return "créé aujourd'hui";
  if (days < 60) return `créé il y a ${days} j`;
  return `créé il y a ${Math.round(days / 30)} mois`;
}

const DEPLOY_LABEL = {
  docker: (r) => `🐳 Déployable (${r.deploy.reasons.join(', ')})`,
  server: () => '⚙️ Serveur, mais pas de Dockerfile (plus de travail)',
  weak: (r) => `⚠️ Peu adapté : ${r.deploy.reasons.join(', ')}`,
  no: (r) => `⛔ ${r.deploy.reasons.join(', ')}`,
};

function railwayLabel(r) {
  const c = r.railway?.count;
  if (c === null || c === undefined) return '❔ Nom trop court pour vérifier Railway : regardez la marketplace';
  if (c === 0) return '🟢 Aucun template Railway : la place est libre';
  return `🟠 ${c} template${c > 1 ? 's' : ''} Railway déjà : ${r.railway.examples.map((e) => short(e, 40)).join(' · ')}`;
}

export function buildDigest(picks, { now = new Date(), scanned = 0, errors = [] } = {}) {
  const fresh = picks.filter((p) => p.isNew).length;
  const subject = picks.length
    ? `Radar templates : ${picks.length} projet${picks.length > 1 ? 's' : ''} IA à saisir (${fresh} nouveau${fresh > 1 ? 'x' : ''}) — semaine du ${weekLabel(now)}`
    : `Radar templates : rien de solide cette semaine (${weekLabel(now)})`;

  const textLines = [subject, ''];
  const cards = picks.map((r, i) => {
    const meta = [`⭐ ${fmt(r.stars)}`, `+${fmt(r.weekly)} cette semaine`, r.language, ageLabel(r.createdAt, now)].filter(Boolean).join(' · ');
    textLines.push(
      `${i + 1}. ${r.fullName}${r.isNew ? ' [NOUVEAU]' : ''} — score ${fmt(r.score)}`,
      `   ${short(r.description, 200)}`,
      `   ${meta}`,
      `   ${DEPLOY_LABEL[r.deploy.level](r)}`,
      `   ${railwayLabel(r)}`,
      `   https://github.com/${r.fullName}`,
      '',
    );
    return `
      <tr><td style="padding:14px 16px;border:1px solid #e4e1da;border-radius:10px;background:#ffffff;">
        <div style="font-size:16px;font-weight:700;margin:0 0 4px;">
          ${i + 1}. <a href="https://github.com/${esc(r.fullName)}" style="color:#2f5bea;text-decoration:none;">${esc(r.fullName)}</a>
          ${r.isNew ? '<span style="font-size:11px;font-weight:700;color:#1f7a4d;background:#e3f3ea;border-radius:999px;padding:2px 8px;margin-left:6px;">NOUVEAU</span>' : '<span style="font-size:11px;color:#6b6862;margin-left:6px;">déjà signalé</span>'}
        </div>
        <div style="color:#1d1c1a;font-size:14px;margin:0 0 6px;">${esc(short(r.description, 220))}</div>
        <div style="color:#6b6862;font-size:13px;margin:0 0 6px;">${esc(meta)}</div>
        <div style="font-size:13px;margin:0 0 2px;">${esc(DEPLOY_LABEL[r.deploy.level](r))}</div>
        <div style="font-size:13px;margin:0 0 2px;">${esc(railwayLabel(r))}</div>
        <div style="font-size:12px;color:#6b6862;margin-top:6px;">Score d'opportunité : <strong>${fmt(r.score)}</strong></div>
      </td></tr>
      <tr><td style="height:10px;"></td></tr>`;
  });

  const errorNote = errors.length
    ? `<p style="font-size:12px;color:#a3261b;">Sources incomplètes cette semaine : ${esc(errors.join(' ; '))}</p>`
    : '';
  textLines.push(
    `${scanned} dépôts analysés. Sources : GitHub Trending (semaine) et recherche GitHub des dépôts IA récents.`,
    'La vérification Railway se fait par nom dans l\'index public des templates : confirmez sur la marketplace avant de vous lancer.',
    ...(errors.length ? [`Sources incomplètes : ${errors.join(' ; ')}`] : []),
  );

  const html = `<!doctype html><html lang="fr"><body style="margin:0;padding:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1d1c1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f5f2;"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
      <tr><td style="padding:0 0 16px;">
        <div style="font-size:20px;font-weight:700;">Radar templates Railway</div>
        <div style="font-size:14px;color:#6b6862;">Les projets IA qui décollent sur GitHub cette semaine, classés par opportunité de template.</div>
      </td></tr>
      ${picks.length ? cards.join('') : '<tr><td style="padding:14px 16px;background:#ffffff;border:1px solid #e4e1da;border-radius:10px;font-size:14px;">Aucun projet IA déployable et en forte croissance sans template Railway cette semaine. Prochain passage lundi prochain.</td></tr>'}
      <tr><td style="padding:8px 0 0;font-size:12px;color:#6b6862;">
        ${scanned} dépôts analysés. Sources : GitHub Trending (semaine) et recherche GitHub des dépôts IA créés récemment.
        La vérification Railway se fait par nom dans l'index public des templates : confirmez sur la marketplace avant de vous lancer.
        ${errorNote}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  return { subject, html, text: textLines.join('\n') };
}

export async function sendEmail(config, digest, { fetchImpl = fetch, log = console } = {}) {
  if (!config.resendApiKey || !config.emailTo) {
    log.info?.('[email] RESEND_API_KEY or EMAIL_TO missing: printing the digest instead of sending it.');
    log.info?.(digest.text);
    return { sent: false };
  }
  const res = await fetchImpl(config.resendApiUrl, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.resendApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: config.emailFrom,
      to: config.emailTo.split(',').map((s) => s.trim()).filter(Boolean),
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend refused the e-mail (HTTP ${res.status}): ${body.message || body.name || 'unknown error'}`);
  return { sent: true, id: body.id };
}
