// @ts-check
/**
 * SITUATION DU DÉPÔT — un point unique au lieu d'une pluie de notifications.
 *
 * Exécuté par `situation.yml`. Rassemble dans UNE issue, réécrite à chaque
 * passage :
 *   1. ce qui demande une action, par priorité ;
 *   2. les workflows en échec sur `main` (et depuis quand) ;
 *   3. les alertes de sécurité ouvertes, par gravité ;
 *   4. les PR Dependabot, avec la raison exacte du blocage — la même que celle
 *      qui a empêché `fusion.mjs` de fusionner (même module `tri.mjs`).
 *
 * ── ANTI-BRUIT ──────────────────────────────────────────────────────────────
 * Modifier le corps d'une issue ne notifie personne. La seule notification
 * émise est un COMMENTAIRE, et seulement quand un élément prioritaire NOUVEAU
 * apparaît (clé absente du passage précédent, mémorisée dans le corps). Une
 * alerte qui reste ouverte ne re-sonne pas chaque jour.
 *
 * ── RÈGLE CARDINALE ─────────────────────────────────────────────────────────
 * Une source illisible est affichée comme POINT MORT, jamais comme « 0 ».
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluer } from './evaluation.mjs';
import { client } from './github.mjs';
import { assainir, code, lien } from './markdown.mjs';
import { AUTEUR_DEPENDABOT } from './tri.mjs';

export const ETIQUETTE = 'situation-depot';
export const AUTEUR_ISSUE = 'github-actions[bot]';
const TITRE = 'Situation du dépôt — point unique, mis à jour automatiquement';
const MARQUEUR = /<!-- situation-etat:([A-Za-z0-9+/=]*) -->/;
const PAR_SECTION = 15;
const GRAVITES = ['critical', 'high', 'medium', 'low'];
/** Nom du workflow qui produit ce récapitulatif : on ne se juge pas soi-même. */
const SOI = 'Situation du dépôt';

/** @template T @typedef {import('./github.mjs').Reponse<T>} Reponse */

/**
 * @typedef {{ nom: string, conclusion: string, url: string, date: string, depuis: string | null }} EtatWorkflow
 * @typedef {{ cle: string, gravite: string, paquet: string, resume: string, portee: string, url: string, date: string }} Alerte
 * @typedef {{
 *   genereLe: string,
 *   urlRun: string,
 *   workflows: Reponse<EtatWorkflow[]>,
 *   mainSansCi: { sha: string, url: string } | null,
 *   dependabot: Reponse<Alerte[]>,
 *   codeScanning: Reponse<Alerte[]>,
 *   secrets: Reponse<Alerte[]>,
 *   prs: Reponse<Awaited<ReturnType<typeof evaluer>>[]>,
 *   fusionActive: boolean,
 * }} Donnees
 * @typedef {{ cle: string, texte: string }} Priorite
 */

// --- Collecte ----------------------------------------------------------------

/**
 * @param {import('./github.mjs').Client} api jeton du run
 * @param {import('./github.mjs').Client} apiAlertes `ALERTS_TOKEN` si posé, sinon le jeton du run
 * @param {string} depot
 * @returns {Promise<Omit<Donnees, 'genereLe' | 'urlRun' | 'fusionActive'>>}
 */
export async function collecter(api, apiAlertes, depot) {
  return {
    workflows: await lireWorkflows(api, depot),
    mainSansCi: await lireMainSansCi(api, depot),
    dependabot: await lireAlertes(
      apiAlertes,
      `repos/${depot}/dependabot/alerts?state=open&per_page=100`,
      (a) => ({
        cle: `dependabot:${a.number}`,
        gravite: String(
          a.security_advisory?.severity ??
            a.security_vulnerability?.severity ??
            'inconnue',
        ),
        paquet: String(a.dependency?.package?.name ?? '?'),
        resume: String(a.security_advisory?.summary ?? ''),
        portee: String(a.dependency?.scope ?? ''),
        url: String(a.html_url ?? ''),
        date: String(a.created_at ?? ''),
      }),
    ),
    codeScanning: await lireAlertes(
      api,
      `repos/${depot}/code-scanning/alerts?state=open&per_page=100`,
      (a) => ({
        cle: `codeql:${a.number}`,
        gravite: String(
          a.rule?.security_severity_level ?? a.rule?.severity ?? 'inconnue',
        ),
        paquet: String(a.most_recent_instance?.location?.path ?? '?'),
        resume: String(a.rule?.description ?? ''),
        portee: '',
        url: String(a.html_url ?? ''),
        date: String(a.created_at ?? ''),
      }),
    ),
    // Le jeton d'un workflow ne lit JAMAIS les alertes de secrets (limite de la
    // plateforme) : seul `ALERTS_TOKEN` le peut, s'il en a le droit.
    secrets: await lireAlertes(
      apiAlertes,
      `repos/${depot}/secret-scanning/alerts?state=open&per_page=100`,
      (a) => ({
        cle: `secret:${a.number}`,
        gravite: 'critical',
        paquet: String(a.secret_type_display_name ?? a.secret_type ?? '?'),
        resume: 'secret exposé',
        portee: '',
        url: String(a.html_url ?? ''),
        date: String(a.created_at ?? ''),
      }),
    ),
    prs: await lirePrs(api, depot),
  };
}

/**
 * @param {import('./github.mjs').Client} api
 * @param {string} chemin
 * @param {(a: any) => Alerte} convertir
 * @returns {Promise<Reponse<Alerte[]>>}
 */
async function lireAlertes(api, chemin, convertir) {
  const r = await api.lister(chemin);
  return r.ok ? { ok: true, donnees: r.donnees.map(convertir) } : r;
}

/**
 * Dernier run TERMINÉ de chaque workflow actif sur `main`, et, s'il est en
 * échec, la date du premier échec de la série (dans les 20 derniers runs).
 *
 * @param {import('./github.mjs').Client} api
 * @param {string} depot
 * @returns {Promise<Reponse<EtatWorkflow[]>>}
 */
async function lireWorkflows(api, depot) {
  const liste = await api.lister(
    `repos/${depot}/actions/workflows?per_page=100`,
    'workflows',
  );
  if (!liste.ok) return liste;
  /** @type {EtatWorkflow[]} */
  const etats = [];
  for (const w of liste.donnees) {
    if (w.state !== 'active' || w.name === SOI) continue;
    const runs = await api.lire(
      `repos/${depot}/actions/workflows/${w.id}/runs?branch=main&status=completed&per_page=20`,
    );
    if (!runs.ok) return runs;
    const liste = Array.isArray(runs.donnees?.workflow_runs)
      ? runs.donnees.workflow_runs
      : [];
    if (liste.length === 0) continue; // jamais exécuté sur main (ex. release sur tag)
    const dernier = liste[0];
    let depuis = null;
    if (dernier.conclusion !== 'success') {
      for (const r of liste) {
        if (r.conclusion === 'success') break;
        depuis = String(r.created_at ?? '');
      }
    }
    etats.push({
      nom: String(w.name ?? '?'),
      conclusion: String(dernier.conclusion ?? 'inconnue'),
      url: String(dernier.html_url ?? ''),
      date: String(dernier.created_at ?? ''),
      depuis,
    });
  }
  return { ok: true, donnees: etats };
}

/**
 * Le dernier commit de `main` a-t-il été vérifié par la CI ? Une fusion faite
 * par le jeton d'un workflow NE DÉCLENCHE PAS les workflows `push` (règle de la
 * plateforme) : ses gates ont tourné sur la PR, mais la publication des images
 * et la référence de couverture attendent le push suivant. On le dit.
 *
 * @param {import('./github.mjs').Client} api
 * @param {string} depot
 */
async function lireMainSansCi(api, depot) {
  const tete = await api.lire(`repos/${depot}/commits/main`);
  if (!tete.ok) return null;
  const sha = String(tete.donnees?.sha ?? '');
  if (sha === '') return null;
  const runs = await api.lire(
    `repos/${depot}/actions/runs?head_sha=${sha}&event=push&per_page=1`,
  );
  if (!runs.ok || (runs.donnees?.total_count ?? 0) > 0) return null;
  return { sha, url: String(tete.donnees?.html_url ?? '') };
}

/**
 * @param {import('./github.mjs').Client} api
 * @param {string} depot
 * @returns {Promise<Reponse<Awaited<ReturnType<typeof evaluer>>[]>>}
 */
async function lirePrs(api, depot) {
  const liste = await api.lister(
    `repos/${depot}/pulls?state=open&per_page=100&sort=created&direction=asc`,
  );
  if (!liste.ok) return liste;
  const verdicts = [];
  for (const p of liste.donnees.filter(
    (x) => x.user?.login === AUTEUR_DEPENDABOT,
  )) {
    const detail = await api.lire(`repos/${depot}/pulls/${p.number}`);
    if (!detail.ok) return detail;
    verdicts.push(await evaluer(api, depot, detail.donnees));
  }
  return { ok: true, donnees: verdicts };
}

// --- Rendu (pur) -------------------------------------------------------------

/** @param {string} iso @param {string} maintenant */
function age(iso, maintenant) {
  const ms = Date.parse(maintenant) - Date.parse(iso);
  if (!Number.isFinite(ms)) return '?';
  const jours = Math.floor(ms / 86_400_000);
  return jours <= 0 ? "aujourd'hui" : `${jours} j`;
}

/** @param {string} g */
function gravite(g) {
  const n = g.toLowerCase();
  if (n === 'moderate') return 'medium';
  if (n === 'error') return 'high';
  if (n === 'warning' || n === 'note') return 'low';
  return GRAVITES.includes(n) ? n : 'inconnue';
}

/**
 * Éléments qui demandent une action, du plus urgent au moins urgent. Chaque
 * élément porte une CLÉ stable : c'est elle qui décide si l'élément est nouveau.
 *
 * @param {Donnees} d
 * @returns {Priorite[]}
 */
export function priorites(d) {
  /** @type {Priorite[]} */
  const p = [];
  if (d.secrets.ok) {
    for (const a of d.secrets.donnees) {
      p.push({
        cle: a.cle,
        texte: `Secret exposé : ${code(a.paquet)} ${lien('(alerte)', a.url)}`,
      });
    }
  }
  for (const source of [d.dependabot, d.codeScanning]) {
    if (!source.ok) continue;
    for (const a of source.donnees) {
      const g = gravite(a.gravite);
      // Une `high` sur l'outillage de développement (non livré) n'est pas une
      // urgence : elle reste détaillée en section 3, sans notifier. Une
      // `critical` notifie toujours, quelle que soit la portée.
      if (g === 'critical' || (g === 'high' && !horsProduction(a))) {
        p.push({
          cle: a.cle,
          texte: `Alerte ${g} : ${code(a.paquet)} — ${assainir(a.resume, 100)} ${lien('(alerte)', a.url)}`,
        });
      }
    }
  }
  if (d.prs.ok) {
    for (const v of d.prs.donnees.filter((x) => x.decision === 'securite')) {
      p.push({
        cle: `pr-securite:${v.numero}`,
        texte: `PR de sécurité ${lien(`#${v.numero}`, v.url)} à relire (jamais fusionnée automatiquement)`,
      });
    }
  }
  if (d.workflows.ok) {
    for (const w of d.workflows.donnees.filter(
      (x) => x.conclusion !== 'success',
    )) {
      p.push({
        cle: `workflow:${w.nom}`,
        texte: `${code(w.nom)} en échec sur main ${lien('(dernier run)', w.url)}`,
      });
    }
  }
  // Une source illisible est une priorité à part entière : sans elle, une
  // cécité nouvelle passerait sans aucune notification.
  for (const [nom, r] of pointsMorts(d)) {
    p.push({
      cle: `point-mort:${nom}`,
      texte: `⚠️ **Point mort** — ${nom} illisibles (${assainir(r.statut, 20)} : ${assainir(r.detail, 120)}) : ce n'est PAS « rien à signaler »`,
    });
  }
  return p;
}

/**
 * @param {Donnees} d
 * @returns {[string, { ok: false, statut: string | number, detail: string }][]}
 */
function pointsMorts(d) {
  /** @type {[string, Reponse<any>][]} */
  const sources = [
    ['workflows sur main', d.workflows],
    ['alertes Dependabot', d.dependabot],
    ['alertes CodeQL', d.codeScanning],
    ['alertes de secrets', d.secrets],
    ['PR Dependabot', d.prs],
  ];
  return /** @type {any} */ (sources.filter(([, r]) => !r.ok));
}

/**
 * Portée « development » déclarée par Dependabot. Seul ce cas-là déclasse une
 * alerte : une portée absente ou inconnue compte comme LIVRÉE (un doute ne
 * doit jamais rendre le récapitulatif plus silencieux).
 * @param {Alerte} a
 */
export const horsProduction = (a) => a.portee === 'development';

/** @param {Priorite} x */
const estPointMort = (x) => x.cle.startsWith('point-mort:');

/**
 * @param {Donnees} d
 * @param {Priorite[]} prio
 */
export function rendreCorps(d, prio) {
  const reelles = prio.filter((x) => !estPointMort(x));
  const verdict =
    reelles.length > 0
      ? '🔴 **À traiter**'
      : prio.length > 0
        ? '🟠 **Point mort** — une source n’a pas pu être lue, le vert n’est pas garanti'
        : '🟢 **Rien d’urgent**';

  const l = [];
  l.push(
    `${verdict} · mis à jour le ${d.genereLe.slice(0, 16).replace('T', ' ')} UTC · ${lien('run', d.urlRun)}`,
  );
  l.push('');
  l.push(
    `> Issue réécrite à chaque passage : son édition ne notifie personne. Un commentaire n'est ajouté que lorsqu'un élément prioritaire **nouveau** apparaît. Fusion automatique : **${d.fusionActive ? 'active' : 'en observation'}**.`,
  );
  l.push('');

  l.push('## 1. À traiter en priorité');
  l.push('');
  if (prio.length === 0) l.push('Rien.');
  const ordonnees = [...prio.filter(estPointMort), ...reelles];
  for (const x of ordonnees.slice(0, 30)) l.push(`- ${x.texte}`);
  const devHigh = d.dependabot.ok
    ? d.dependabot.donnees.filter(
        (a) => gravite(a.gravite) === 'high' && horsProduction(a),
      ).length
    : 0;
  if (devHigh > 0) {
    l.push(
      `- _(non prioritaire)_ ${devHigh} alerte(s) high sur l’outillage de développement, non livré — détail en section 3.`,
    );
  }
  if (prio.length > 30)
    l.push(`- … et ${prio.length - 30} autres (voir sections suivantes)`);
  l.push('');

  l.push('## 2. `main`');
  l.push('');
  if (!d.workflows.ok) l.push('_Illisible — voir point mort ci-dessus._');
  else {
    const rouges = d.workflows.donnees.filter(
      (w) => w.conclusion !== 'success',
    );
    l.push(
      rouges.length === 0
        ? `Les ${d.workflows.donnees.length} workflows actifs sont verts sur leur dernier run.`
        : `${rouges.length} workflow(s) en échec sur ${d.workflows.donnees.length} :`,
    );
    if (rouges.length > 0) {
      l.push('');
      l.push('| Workflow | Dernier run | Rouge depuis |');
      l.push('| --- | --- | --- |');
      for (const w of rouges) {
        l.push(
          `| ${code(w.nom)} | ${lien(assainir(w.conclusion, 20), w.url)} (${age(w.date, d.genereLe)}) | ${w.depuis ? age(w.depuis, d.genereLe) : '?'} |`,
        );
      }
    }
  }
  if (d.mainSansCi) {
    l.push('');
    l.push(
      `ℹ️ Le dernier commit de main (${lien(code(d.mainSansCi.sha.slice(0, 7)), d.mainSansCi.url)}) n'a déclenché aucun workflow \`push\` : c'est le cas d'une fusion automatique. Ses gates ont tourné sur la PR ; la publication des images et la référence de couverture attendent le prochain push.`,
    );
  }
  l.push('');

  l.push('## 3. Alertes de sécurité ouvertes');
  l.push('');
  for (const [titre, r] of /** @type {[string, Reponse<Alerte[]>][]} */ ([
    ['Dependabot', d.dependabot],
    ['CodeQL', d.codeScanning],
    ['Secrets', d.secrets],
  ])) {
    if (!r.ok) {
      l.push(`- **${titre}** : ⚠️ illisible — ce n'est PAS « aucune alerte ».`);
      continue;
    }
    const compte = GRAVITES.concat('inconnue')
      .map((g) => [g, r.donnees.filter((a) => gravite(a.gravite) === g).length])
      .filter(([, n]) => Number(n) > 0)
      .map(([g, n]) => `${g} ${n}`);
    l.push(
      `- **${titre}** : ${r.donnees.length === 0 ? 'aucune' : `${r.donnees.length} (${compte.join(' · ')})`}`,
    );
  }
  if (d.dependabot.ok) {
    const graves = d.dependabot.donnees.filter((a) =>
      ['critical', 'high'].includes(gravite(a.gravite)),
    );
    if (graves.length > 0) {
      l.push('');
      l.push('| Gravité | Paquet | Portée déclarée | Avis | Ouverte depuis |');
      l.push('| --- | --- | --- | --- | --- |');
      for (const a of graves.slice(0, PAR_SECTION)) {
        l.push(
          `| ${gravite(a.gravite)} | ${code(a.paquet)} | ${assainir(a.portee || '?', 20)} | ${lien(assainir(a.resume, 90) || 'avis', a.url)} | ${age(a.date, d.genereLe)} |`,
        );
      }
      if (graves.length > PAR_SECTION)
        l.push(`| … | ${graves.length - PAR_SECTION} autres | | | |`);
      l.push('');
      l.push(
        '> La « portée déclarée » est celle de Dependabot, qui se trompe sur les transitives. Ce qui est réellement embarqué en production est tranché par le job `security` de la CI et par `veille-alertes.yml`.',
      );
    }
  }
  l.push('');

  l.push('## 4. PR Dependabot');
  l.push('');
  if (!d.prs.ok) l.push('_Illisibles — voir point mort ci-dessus._');
  else if (d.prs.donnees.length === 0) l.push('Aucune PR Dependabot ouverte.');
  else {
    const ordre = ['securite', 'a-la-main', 'attente', 'prete'];
    const libelle = {
      securite: '🔐 Sécurité — à relire, jamais fusionnée automatiquement',
      'a-la-main': '✋ À ta main',
      attente: '⏳ En attente — rien à faire, l’automatisme reprendra',
      prete:
        '✅ Prêtes — fusionnées au prochain passage si la fusion automatique est active',
    };
    for (const cle of ordre) {
      const lot = d.prs.donnees.filter((v) => v.decision === cle);
      if (lot.length === 0) continue;
      l.push(`### ${libelle[/** @type {keyof typeof libelle} */ (cle)]}`);
      l.push('');
      l.push('| PR | Dépendances | Raison | Ouverte depuis |');
      l.push('| --- | --- | --- | --- |');
      for (const v of lot) {
        const deps =
          v.dependances
            .slice(0, 3)
            .map((x) => code(x.nom))
            .join(', ') +
          (v.dependances.length > 3 ? ` +${v.dependances.length - 3}` : '');
        const raisons =
          v.raisons.length === 0
            ? '—'
            : v.raisons
                .slice(0, 3)
                .map((r) => assainir(r, 140))
                .join('<br>') +
              (v.raisons.length > 3 ? `<br>(+${v.raisons.length - 3})` : '');
        l.push(
          `| ${lien(`#${v.numero}`, v.url)} | ${deps || '?'} | ${raisons} | ${age(v.ouverteLe, d.genereLe)} |`,
        );
      }
      l.push('');
    }
  }

  l.push('## 5. Ce que ce point ne voit pas');
  l.push('');
  l.push('- Les PR ouvertes par des humains, et leurs contrôles.');
  l.push(
    '- Les workflows qui n’ont jamais tourné sur `main` (ex. `release.yml`, déclenché par tag).',
  );
  l.push(
    '- L’état de la production : seul le serveur le connaît (DORA, `image-scan.yml`).',
  );
  l.push('- Les issues ouvertes à la main ou par d’autres automatismes.');
  l.push('');
  return l.join('\n');
}

/** @param {Priorite[]} prio */
export function encoderEtat(prio) {
  return `<!-- situation-etat:${Buffer.from(JSON.stringify(prio.map((x) => x.cle))).toString('base64')} -->`;
}

/**
 * @param {string} corps
 * @returns {Set<string> | null} `null` si aucun état antérieur lisible
 */
export function lireEtat(corps) {
  const m = MARQUEUR.exec(String(corps ?? ''));
  if (!m) return null;
  try {
    const cles = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
    return Array.isArray(cles) ? new Set(cles.map(String)) : null;
  } catch {
    return null;
  }
}

// --- Publication -------------------------------------------------------------

/**
 * @param {{
 *   api: import('./github.mjs').Client,
 *   depot: string,
 *   proprietaire: string,
 *   donnees: Donnees,
 *   journal?: (m: string) => void,
 * }} c
 * @returns {Promise<number>}
 */
export async function publier({
  api,
  depot,
  proprietaire,
  donnees,
  journal = console.log,
}) {
  const prio = priorites(donnees);
  const corps = `${rendreCorps(donnees, prio)}\n${encoderEtat(prio)}\n`;

  const issues = await api.lister(
    `repos/${depot}/issues?labels=${ETIQUETTE}&state=all&per_page=100`,
  );
  if (!issues.ok) {
    journal(`Liste des issues illisible (${issues.statut}) — rien publié.`);
    return 1;
  }
  // Étiquette ET auteur : une issue étiquetée à la main ne peut pas détourner
  // le récapitulatif (ni être écrasée par lui).
  const miennes = issues.donnees
    .filter((i) => i.user?.login === AUTEUR_ISSUE && !i.pull_request)
    .sort((a, b) => a.number - b.number);
  const existante = miennes.find((i) => i.state === 'open') ?? miennes[0];

  if (!existante) {
    await api.ecrire('POST', `repos/${depot}/labels`, {
      name: ETIQUETTE,
      color: '0e8a16',
      description: 'Récapitulatif automatique unique (workflow situation.yml)',
    }); // 422 si l'étiquette existe déjà : sans conséquence
    const cree = await api.ecrire('POST', `repos/${depot}/issues`, {
      title: TITRE,
      body: corps,
      labels: [ETIQUETTE],
    });
    if (!cree.ok) {
      journal(`Création de l'issue refusée (${cree.statut}).`);
      return 1;
    }
    await commenter(
      api,
      depot,
      cree.donnees.number,
      proprietaire,
      prio,
      'Récapitulatif créé.',
    );
    journal(`Issue #${cree.donnees.number} créée.`);
    return 0;
  }

  const avant = lireEtat(existante.body);
  const maj = await api.ecrire(
    'PATCH',
    `repos/${depot}/issues/${existante.number}`,
    {
      title: TITRE,
      body: corps,
      state: 'open',
    },
  );
  if (!maj.ok) {
    journal(
      `Mise à jour de l'issue #${existante.number} refusée (${maj.statut}).`,
    );
    return 1;
  }
  const nouvelles = prio.filter((x) => avant === null || !avant.has(x.cle));
  if (nouvelles.length > 0) {
    await commenter(
      api,
      depot,
      existante.number,
      proprietaire,
      nouvelles,
      'Nouveau depuis le dernier passage :',
    );
  }
  journal(
    `Issue #${existante.number} mise à jour (${prio.length} priorité(s), ${nouvelles.length} nouvelle(s)).`,
  );
  return 0;
}

/**
 * @param {import('./github.mjs').Client} api
 * @param {string} depot
 * @param {number} numero
 * @param {string} proprietaire
 * @param {Priorite[]} elements
 * @param {string} intro
 */
async function commenter(api, depot, numero, proprietaire, elements, intro) {
  if (elements.length === 0) return;
  const mention = /^[A-Za-z0-9-]{1,39}$/.test(proprietaire)
    ? `@${proprietaire} `
    : '';
  const corps = [
    `${mention}${intro}`,
    '',
    ...elements.slice(0, 20).map((x) => `- ${x.texte}`),
  ].join('\n');
  await api.ecrire('POST', `repos/${depot}/issues/${numero}/comments`, {
    body: corps,
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const jeton = process.env.GITHUB_TOKEN ?? '';
  const depot = process.env.GITHUB_REPOSITORY ?? '';
  if (jeton === '' || !/^[\w.-]+\/[\w.-]+$/.test(depot)) {
    console.error('GITHUB_TOKEN ou GITHUB_REPOSITORY absent — arrêt.');
    process.exit(1);
  }
  const api = client(jeton, 'creche-planner-situation');
  const jetonAlertes = process.env.ALERTS_TOKEN || jeton;
  const collecte = await collecter(
    api,
    client(jetonAlertes, 'creche-planner-situation'),
    depot,
  );
  /** @type {Donnees} */
  const donnees = {
    ...collecte,
    genereLe: new Date().toISOString(),
    urlRun: `https://github.com/${depot}/actions/runs/${process.env.GITHUB_RUN_ID ?? ''}`,
    fusionActive: process.env.FUSION_AUTO_DEPENDABOT === 'active',
  };
  const codeSortie = await publier({
    api,
    depot,
    proprietaire: process.env.GITHUB_REPOSITORY_OWNER ?? '',
    donnees,
  });
  const resume = process.env.GITHUB_STEP_SUMMARY;
  if (resume) appendFileSync(resume, rendreCorps(donnees, priorites(donnees)));
  process.exit(codeSortie);
}
