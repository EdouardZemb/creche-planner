// @ts-check
/**
 * VEILLE des ALERTES DE SÉCURITÉ OUVERTES (code scanning CodeQL + Dependabot).
 *
 * Problème comblé — le POINT MORT de la veille (issue #279). Les alertes vivent
 * dans l'onglet Security, derrière les endpoints `code-scanning/alerts` et
 * `dependabot/alerts`. Une session distante (Claude Code sur le web, runner cloud)
 * n'y a PAS accès : aucun outil MCP ne les expose et l'appel direct répond
 * « 403 — GitHub access is not enabled for this session ». La veille du 2026-08-03
 * a donc rendu un verdict ORANGE non pas parce qu'il y avait un problème, mais
 * parce qu'elle ne pouvait pas REGARDER.
 *
 * Ce script déplace la lecture des alertes LÀ où le jeton a le droit de lire :
 * dans un job Actions du dépôt lui-même. Le résultat devient lisible de partout
 * via la CONCLUSION du run (`success`/`failure`) et son `GITHUB_STEP_SUMMARY` —
 * or lister les runs d'un workflow, une session distante SAIT le faire (c'est
 * exactement ce que la veille #279 a fait pour ci.yml et image-scan.yml).
 *
 * ── CONTRAT (le point important) ────────────────────────────────────────────
 * Un run VERT signifie DEUX choses à la fois :
 *   1. les deux endpoints ont RÉPONDU 200 (la vérification a réellement eu lieu) ;
 *   2. et il n'y a AUCUNE alerte ouverte au-dessus du seuil.
 *
 * Un run ROUGE signifie l'un OU l'autre :
 *   - des alertes ≥ seuil sont ouvertes (`ALERTES`) ;
 *   - ou la vérification n'a pas pu aboutir (`POINT MORT`).
 *
 * Le résumé dit TOUJOURS lequel des deux. C'est la règle cardinale de la veille,
 * rappelée par #279 : **un appel qui échoue ne doit JAMAIS être lu comme « aucune
 * alerte »**. Un `catch` qui renvoie une liste vide transformerait un point mort en
 * feu vert — c'est précisément le bug qu'on refuse d'écrire ici.
 *
 * ── DIVERGENCE ASSUMÉE avec image-scan.yml ──────────────────────────────────
 * La veille CVE des images est NON BLOQUANTE (findings ⇒ run vert + e-mail ; seul
 * un échec opérationnel passe au rouge). Ici c'est l'inverse pour les findings :
 * des alertes ≥ seuil passent le run au ROUGE. Raison : ce workflow n'existe que
 * pour produire un VERT DIGNE DE CONFIANCE, consommable à distance. Un vert qui
 * peut vouloir dire « des alertes critiques, mais on n'a rien bloqué » ne vaudrait
 * rien pour l'usage visé. Et comme pour image-scan, ROUGE ici n'impacte AUCUN
 * build : rien ne dépend de ce workflow.
 *
 * ── JETON ───────────────────────────────────────────────────────────────────
 * `GITHUB_TOKEN` + `permissions: security-events: read` suffit pour le code
 * scanning. Pour `dependabot/alerts`, un 403 recouvre DEUX causes opposées, et
 * le message d'aide les distingue en lisant le corps de la réponse :
 *   - « Dependabot alerts are disabled for this repository » → la fonctionnalité
 *     est éteinte. Aucun jeton n'y changera rien : l'activer dans Settings →
 *     Code security. C'est le cas observé le 2026-08-05 ;
 *   - tout autre 403 → couverture insuffisante du jeton par défaut : poser un
 *     secret `ALERTS_TOKEN` (PAT, scope `security_events`), prioritaire s'il existe.
 * On ne DEVINE jamais : on signale — et on signale la BONNE marche à suivre,
 * sous peine d'envoyer fabriquer un PAT inutile.
 *
 * Zéro dépendance npm (Node pur, `fetch` natif).
 *
 * Variables :
 *   GITHUB_TOKEN         jeton par défaut du run (permissions du workflow)
 *   ALERTS_TOKEN         PAT optionnel, prioritaire (scope `security_events`)
 *   GITHUB_REPOSITORY    défaut EdouardZemb/creche-planner
 *   ALERTES_SEUIL        sévérités qui font rougir (défaut `critical,high`)
 *   ALERTES_DRY_RUN      jeu d'essai synthétique, aucun appel réseau : `1` (charge
 *                        hostile, chemin ALERTES) ou `dependabot-desactive`
 *                        (403 « alerts are disabled », chemin POINT MORT)
 *   GITHUB_STEP_SUMMARY  fichier de résumé (posé par Actions)
 */

import { appendFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.ALERTS_TOKEN || process.env.GITHUB_TOKEN || '';
// `ALERTES_DRY_RUN=dependabot-desactive` : seconde variante du jeu d'essai, qui
// rejoue le 403 « alerts are disabled » observé le 2026-08-05 pour vérifier que
// l'aide affichée pointe vers Settings et NON vers un PAT à fabriquer.
const CAS_DEPENDABOT_DESACTIVE =
  process.env.ALERTES_DRY_RUN === 'dependabot-desactive';
const DRY_RUN = process.env.ALERTES_DRY_RUN === '1' || CAS_DEPENDABOT_DESACTIVE;
// `||` et NON `??` : sur cron, `github.event.inputs.seuil` vaut la chaîne VIDE
// (pas `undefined`). Avec `??` le seuil serait `[]`, donc plus aucune alerte
// « au-dessus du seuil » — un FAUX VERT, précisément ce que ce script combat.
const SEUIL = (process.env.ALERTES_SEUIL || 'critical,high')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Garde-fou de pagination : 100 alertes/page, on ne boucle pas à l'infini. */
const PAGES_MAX = 10;
const PAR_PAGE = 100;

/**
 * Lit UNE source d'alertes, en distinguant les trois issues possibles.
 * Ne renvoie JAMAIS une liste vide pour masquer une erreur : `ok:false` est un
 * état à part entière, que l'appelant est obligé de traiter.
 *
 * @param {string} chemin sous-chemin d'API, ex. `code-scanning/alerts`
 * @returns {Promise<{ok: true, alertes: any[]} | {ok: false, statut: number|string, detail: string}>}
 */
async function lireAlertes(chemin) {
  const alertes = [];

  for (let page = 1; page <= PAGES_MAX; page++) {
    const url = `https://api.github.com/repos/${REPO}/${chemin}?state=open&per_page=${PAR_PAGE}&page=${page}`;
    let reponse;

    try {
      reponse = await fetch(url, {
        headers: {
          authorization: `Bearer ${TOKEN}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': 'creche-planner-veille-alertes',
        },
      });
    } catch (erreur) {
      // Panne réseau : point mort, surtout PAS « aucune alerte ».
      return {
        ok: false,
        statut: 'réseau',
        detail: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }

    if (!reponse.ok) {
      return {
        ok: false,
        statut: reponse.status,
        detail: (await reponse.text()).slice(0, 300),
      };
    }

    const lot = await reponse.json();
    if (!Array.isArray(lot)) {
      return {
        ok: false,
        statut: reponse.status,
        detail: `réponse inattendue (${typeof lot}), tableau attendu`,
      };
    }

    alertes.push(...lot);
    if (lot.length < PAR_PAGE) return { ok: true, alertes };
  }

  // Plafond atteint : on a des alertes, mais peut-être pas TOUTES. Mieux vaut le
  // dire que de rendre un décompte faux.
  return {
    ok: false,
    statut: 'pagination',
    detail: `plus de ${PAGES_MAX * PAR_PAGE} alertes ouvertes sur ${chemin} — décompte tronqué, à regarder à la main`,
  };
}

/**
 * Sévérité normalisée d'une alerte de code scanning.
 * `security-and-quality` remonte AUSSI des requêtes de qualité, sans
 * `security_severity_level` : elles ne sont pas des failles et ne doivent pas
 * peser sur le seuil. On les classe `qualité`.
 * @param {any} alerte
 */
const severiteCodeScanning = (alerte) =>
  alerte?.rule?.security_severity_level == null
    ? 'qualité'
    : normaliserSeverite(alerte.rule.security_severity_level);

/** @param {any} alerte */
const severiteDependabot = (alerte) =>
  normaliserSeverite(alerte?.security_advisory?.severity);

/**
 * Sévérités que GitHub peut renvoyer. Tout le reste devient `inconnue` : la
 * sévérité sert de clé de comptage ET est réaffichée, autant la ramener à une
 * liste FERMÉE plutôt que de recopier une chaîne venue du réseau.
 */
const SEVERITES_CONNUES = new Set([
  'critical',
  'high',
  'medium',
  'moderate',
  'low',
  'warning',
  'note',
  'error',
]);

/** @param {unknown} brut */
function normaliserSeverite(brut) {
  const niveau = String(brut ?? '').toLowerCase();
  return SEVERITES_CONNUES.has(niveau) ? niveau : 'inconnue';
}

/**
 * Assainit une chaîne venue de l'API avant de l'écrire dans le résumé.
 *
 * POURQUOI — `GITHUB_STEP_SUMMARY` est **rendu comme du Markdown** par GitHub :
 * c'est un sink d'injection, pas un simple fichier de log (alerte CodeQL
 * « Network data written to file » sur la 1re version). Les valeurs concernées
 * viennent de l'écosystème public (noms de paquets npm, résumés d'advisory) ou
 * d'un corps de réponse HTTP brut — donc pas de notre ressort.
 *
 * Un saut de ligne suffirait à casser la structure du rapport ; un `[texte](url)`
 * ou un `<img>` à y injecter un lien arbitraire. On retire les caractères de
 * contrôle, on échappe ce qui est signifiant en Markdown, et on borne la longueur.
 *
 * @param {unknown} brut
 * @param {number} longueurMax
 */
function assainir(brut, longueurMax = 200) {
  return String(brut ?? '')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ') // sauts de ligne et caractères de contrôle
    .replace(/[\\`*_[\]()<>|#~]/g, (c) => `\\${c}`) // Markdown + HTML
    .trim()
    .slice(0, longueurMax);
}

/**
 * N'accepte qu'une URL GitHub en https, sinon rien. Empêche qu'un `html_url`
 * inattendu ne devienne un lien arbitraire dans le résumé.
 * @param {unknown} brut
 */
function lienGitHub(brut) {
  const url = String(brut ?? '');
  return /^https:\/\/github\.com\/[\w\-./#?=&%]*$/.test(url) ? url : '';
}

/**
 * Rend « ([alerte #12](url)) », ou « (alerte #12) » si l'URL est refusée.
 * @param {unknown} numero
 * @param {unknown} url
 */
function refAlerte(numero, url) {
  const n = Number.isInteger(numero) ? String(numero) : '?';
  const lien = lienGitHub(url);
  return lien ? `([alerte #${n}](${lien}))` : `(alerte #${n})`;
}

/**
 * @param {any[]} alertes
 * @param {(a: any) => string} severite
 */
function compter(alertes, severite) {
  /** @type {Record<string, number>} */
  const parSeverite = {};
  for (const alerte of alertes) {
    const niveau = severite(alerte);
    parSeverite[niveau] = (parSeverite[niveau] ?? 0) + 1;
  }
  const bloquantes = alertes.filter((a) => SEUIL.includes(severite(a)));
  return { parSeverite, bloquantes };
}

/**
 * Jeu d'essai pour `ALERTES_DRY_RUN=1` — aucun appel réseau.
 *
 * Volontairement HOSTILE : l'alerte Dependabot porte une charge d'injection
 * Markdown (saut de ligne, lien, `<img>`, pipe de tableau) et une `html_url` hors
 * github.com. Le rendu attendu montre ces caractères ÉCHAPPÉS, sur UNE seule
 * ligne, et le lien REFUSÉ (« (alerte #7) » sans URL). C'est le test de
 * non-régression de `assainir()`/`lienGitHub()`.
 *
 * Ce jeu contient une alerte `high` : `ALERTES_DRY_RUN=1` sort donc en `exit=1`
 * (chemin ALERTES), c'est normal — il exerce le cas « findings » de bout en bout.
 *
 * `ALERTES_DRY_RUN=dependabot-desactive` substitue à la source Dependabot le 403
 * « alerts are disabled » réellement observé le 2026-08-05 : sortie en `exit=1`
 * elle aussi (chemin POINT MORT), mais elle vérifie que l'aide affichée envoie
 * vers Settings → Code security et pas vers un `ALERTS_TOKEN` sans effet.
 */
function jeuDEssai() {
  return {
    codeScanning: {
      ok: /** @type {const} */ (true),
      alertes: [
        { rule: { security_severity_level: null, id: 'js/unused-local' } },
      ],
    },
    dependabot: CAS_DEPENDABOT_DESACTIVE
      ? {
          ok: /** @type {const} */ (false),
          statut: 403,
          detail:
            '{"message":"Dependabot alerts are disabled for this repository.","documentation_url":"https://docs.github.com/rest/dependabot/alerts#list-dependabot-alerts-for-a-repository","status":"403"}',
        }
      : {
          ok: /** @type {const} */ (true),
          alertes: [
            {
              number: 7,
              html_url: 'https://exemple-malveillant.test/hameçonnage',
              dependency: { package: { name: 'paquet-piege' } },
              security_advisory: {
                severity: 'high',
                summary:
                  'Faille\n\n## Faux titre\n[cliquez ici](https://exemple-malveillant.test) <img src=x onerror=alert(1)> | colonne',
              },
            },
          ],
        },
  };
}

const lignes = [];
/** @param {string} ligne */
const dire = (ligne) => {
  lignes.push(ligne);
  console.log(ligne);
};

const sources = DRY_RUN
  ? jeuDEssai()
  : {
      codeScanning: await lireAlertes('code-scanning/alerts'),
      dependabot: await lireAlertes('dependabot/alerts'),
    };

dire(`# Veille alertes de sécurité — ${REPO}`);
dire('');
dire(
  `Seuil de blocage : **${SEUIL.join(', ')}**${DRY_RUN ? ` — ⚠️ jeu d’essai (\`ALERTES_DRY_RUN=${CAS_DEPENDABOT_DESACTIVE ? 'dependabot-desactive' : '1'}\`)` : ''}`,
);
dire('');

/** @type {string[]} */
const pointsMorts = [];
/** @type {string[]} */
const bloquants = [];

/**
 * @param {string} titre
 * @param {any} resultat
 * @param {(a: any) => string} severite
 * @param {(a: any) => string} decrire
 * @param {string | ((r: any) => string)} aide marche à suivre, éventuellement
 *   calculée depuis le résultat (un même statut peut avoir plusieurs causes).
 */
function rapporter(titre, resultat, severite, decrire, aide) {
  dire(`## ${titre}`);
  dire('');

  if (!resultat.ok) {
    // Le cœur du contrat : un échec est un ÉCHEC, pas un zéro.
    dire(
      `🔴 **POINT MORT — vérification impossible** (statut \`${resultat.statut}\`).`,
    );
    dire('');
    dire(
      "Ce n'est **pas** « aucune alerte » : la question reste entière, personne n'a pu regarder.",
    );
    dire('');
    dire(`> ${assainir(resultat.detail, 300)}`);
    dire('');
    dire(typeof aide === 'function' ? aide(resultat) : aide);
    dire('');
    pointsMorts.push(`${titre} (statut ${resultat.statut})`);
    return;
  }

  const { parSeverite, bloquantes } = compter(resultat.alertes, severite);

  if (resultat.alertes.length === 0) {
    dire('✅ Aucune alerte ouverte.');
    dire('');
    return;
  }

  const detail =
    Object.entries(parSeverite)
      .sort((a, b) => b[1] - a[1])
      .map(([niveau, n]) => `${niveau} : ${n}`)
      .join(' · ') || '—';
  dire(`${resultat.alertes.length} alerte(s) ouverte(s) — ${detail}`);
  dire('');

  if (bloquantes.length === 0) {
    dire('✅ Aucune au-dessus du seuil.');
    dire('');
    return;
  }

  dire(`🔴 **${bloquantes.length} alerte(s) au-dessus du seuil :**`);
  dire('');
  for (const alerte of bloquantes.slice(0, 20)) {
    dire(`- **${severite(alerte)}** — ${decrire(alerte)}`);
  }
  if (bloquantes.length > 20) {
    dire(`- … et ${bloquantes.length - 20} autre(s).`);
  }
  dire('');
  bloquants.push(`${titre} : ${bloquantes.length}`);
}

rapporter(
  'Code scanning (CodeQL)',
  sources.codeScanning,
  severiteCodeScanning,
  (a) =>
    `${assainir(a?.rule?.id) || 'règle inconnue'} — ${assainir(a?.most_recent_instance?.location?.path) || 'emplacement inconnu'} ${refAlerte(a?.number, a?.html_url)}`,
  'Le jeton du run a besoin de `security-events: read` (déclaré dans le workflow). ' +
    'Si le code scanning est désactivé sur le dépôt, le réactiver dans Settings → Code security.',
);

rapporter(
  'Dependabot',
  sources.dependabot,
  severiteDependabot,
  (a) =>
    `${assainir(a?.dependency?.package?.name, 80) || 'paquet inconnu'} — ${assainir(a?.security_advisory?.summary) || 'sans résumé'} ${refAlerte(a?.number, a?.html_url)}`,
  // Deux causes opposées derrière le même 403 : le corps de la réponse tranche.
  // Test de PRÉSENCE seulement — la valeur elle-même n'est jamais rendue ici
  // sans passer par `assainir()` (cf. rapporter()).
  (resultat) =>
    /dependabot alerts are disabled/i.test(String(resultat?.detail ?? ''))
      ? 'Les alertes Dependabot sont **désactivées sur le dépôt** : aucun jeton ne ' +
        'lèvera ce 403. Les activer dans Settings → Code security → Dependabot alerts. ' +
        'Inutile de poser un `ALERTS_TOKEN` tant que la fonctionnalité est éteinte.'
      : 'Ce `403` signifie que le `GITHUB_TOKEN` par défaut ne couvre pas ' +
        '`dependabot/alerts` sur ce dépôt. Poser un secret Actions `ALERTS_TOKEN` ' +
        '(PAT avec le scope `security_events`) : le script le préfère au jeton par défaut.',
);

dire('## Verdict');
dire('');

let code = 0;
if (pointsMorts.length > 0) {
  dire(`🔴 **POINT MORT** — ${pointsMorts.join(' ; ')}.`);
  dire('');
  dire(
    'La veille ne peut PAS conclure « aucune alerte ». À lever avant de se fier au vert de ce workflow.',
  );
  code = 1;
}
if (bloquants.length > 0) {
  dire(`🔴 **ALERTES ≥ seuil** — ${bloquants.join(' ; ')}.`);
  code = 1;
}
if (code === 0) {
  dire(
    `✅ **VERT** — les deux sources ont répondu, aucune alerte ouverte ≥ \`${SEUIL.join('/')}\`.`,
  );
  dire('');
  dire('Ce vert est opposable : la vérification a bien eu lieu.');
}

const resume = process.env.GITHUB_STEP_SUMMARY;
if (resume) appendFileSync(resume, lignes.join('\n') + '\n');

process.exit(code);
