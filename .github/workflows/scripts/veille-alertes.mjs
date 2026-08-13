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
 * ── PÉRIMÈTRE BLOQUANT : CE QUI EST EMBARQUÉ (AM-75) ────────────────────────
 * Le seuil ne mord que sur les paquets **réellement livrés**. Le job `security`
 * de ci.yml tient déjà cet étage — bloquant sur les dépendances de production,
 * informatif sur l'arbre complet — et la veille ne l'avait pas : l'activation des
 * alertes Dependabot (2026-08-13) a fait apparaître 4 `high` qui sont TOUTES de
 * l'outillage de test, et qui suffisaient à rendre ce workflow rouge en
 * permanence. Une veille toujours rouge n'est plus lue.
 *
 * Le périmètre est **DÉRIVÉ du lockfile**, jamais recopié : clôture des
 * `dependencies` (pas `devDependencies`) des importateurs `apps/*`, en suivant
 * les liens `workspace:` vers les libs — c'est exactement l'arbre que
 * `pnpm install --prod` pose dans les images (cf. Dockerfile, stage `deps`).
 *
 * ⚠️ Le champ `scope` de Dependabot ne peut PAS servir d'arbitre : il annonce
 * `axios` en `runtime` parce qu'elle est en `dependencies` de son parent — or ce
 * parent est `@pact-foundation/pact`, une devDependency. Trivy, qui raisonne sur
 * le lockfile, a raison contre lui ; on raisonne donc comme Trivy.
 *
 * RÈGLE CARDINALE, dans le même esprit que le reste du fichier : **un doute
 * compte comme EMBARQUÉ**. Lockfile illisible, ou clôture invraisemblablement
 * petite (parseur cassé par un changement de format), et toutes les alertes
 * redeviennent bloquantes — le rapport le dit alors explicitement. L'erreur qu'on
 * refuse d'écrire ici est celle qui rendrait le seuil silencieusement permissif.
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
 *                        hostile, chemin ALERTES), `dependabot-desactive`
 *                        (403 « alerts are disabled », chemin POINT MORT),
 *                        `perimetre` (une alerte embarquée + une d'outillage) ou
 *                        `perimetre-outillage` (outillage SEUL ⇒ doit sortir VERT)
 *   ALERTES_LOCKFILE     lockfile de référence du périmètre (défaut pnpm-lock.yaml)
 *   GITHUB_STEP_SUMMARY  fichier de résumé (posé par Actions)
 */

import { appendFileSync, readFileSync } from 'node:fs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'EdouardZemb/creche-planner';
const TOKEN = process.env.ALERTS_TOKEN || process.env.GITHUB_TOKEN || '';
// `ALERTES_DRY_RUN=dependabot-desactive` : seconde variante du jeu d'essai, qui
// rejoue le 403 « alerts are disabled » observé le 2026-08-05 pour vérifier que
// l'aide affichée pointe vers Settings et NON vers un PAT à fabriquer.
const CAS_DEPENDABOT_DESACTIVE =
  process.env.ALERTES_DRY_RUN === 'dependabot-desactive';
// Jeux d'essai du périmètre (AM-75). `perimetre` mélange une alerte embarquée et
// une d'outillage ; `perimetre-outillage` ne porte QUE l'outillage et doit sortir
// VERT — c'est la sonde qui prouve que la distinction change bien le verdict.
const CAS_PERIMETRE = process.env.ALERTES_DRY_RUN === 'perimetre';
const CAS_PERIMETRE_OUTILLAGE =
  process.env.ALERTES_DRY_RUN === 'perimetre-outillage';
const DRY_RUN =
  process.env.ALERTES_DRY_RUN === '1' ||
  CAS_DEPENDABOT_DESACTIVE ||
  CAS_PERIMETRE ||
  CAS_PERIMETRE_OUTILLAGE;
const LOCKFILE = process.env.ALERTES_LOCKFILE || 'pnpm-lock.yaml';
/** Le PAT est-il posé ? Sert à nommer la cause d'un 403, pas à la deviner. */
const PAT_POSE = Boolean(process.env.ALERTS_TOKEN);
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

// --- Périmètre embarqué (AM-75) ---------------------------------------------

/**
 * Nombre de paquets sous lequel on refuse de croire la clôture. L'arbre de
 * production de six services NestJS en compte plusieurs centaines : un total
 * ridicule signale un parseur cassé (format de lockfile changé), pas un projet
 * sobre. On préfère alors rendre le seuil TROP strict que silencieusement laxiste.
 */
const CLOTURE_MINIMALE = 50;

/** Retire les quotes simples d'une clé YAML. @param {string} s */
const denuder = (s) => s.replace(/^'(.*)'$/, '$1');

/**
 * Calcule l'ensemble des NOMS de paquets réellement embarqués dans les images,
 * en lisant `pnpm-lock.yaml` (v9) sans dépendance YAML.
 *
 * Départ : les importateurs `apps/*` — ce sont les projets qui produisent une
 * image. On ne suit que leurs `dependencies` (les `devDependencies` ne sont pas
 * installées par le `pnpm install --prod` du Dockerfile), et on traverse les
 * liens `workspace:` (`link:../../libs/…`) pour atteindre les dépendances des
 * libs, elles aussi filtrées sur leur bloc de production.
 *
 * Comparaison par NOM, pas par version : deux versions d'un même paquet peuvent
 * coexister entre l'arbre de dev et celui de prod, et le doute doit compter comme
 * embarqué. C'est volontairement le sens strict.
 *
 * @returns {Set<string> | null} `null` = périmètre inconnu (l'appelant DOIT alors
 *   tout traiter comme embarqué).
 */
function arbreEmbarque(fichier = LOCKFILE) {
  let texte;
  try {
    texte = readFileSync(fichier, 'utf8');
  } catch {
    return null;
  }

  /** @type {Map<string, Map<string, string>>} importateur → (paquet → version|link:) */
  const importateurs = new Map();
  /** @type {Map<string, {nom: string, cle: string}[]>} clé de snapshot → deps */
  const snapshots = new Map();

  let section = '';
  let importateur = '';
  let cle = '';
  let bloc = '';
  let paquet = '';

  for (const ligne of texte.split(/\r?\n/)) {
    if (/^[a-zA-Z]/.test(ligne)) {
      section = ligne.replace(/:.*$/, '');
      importateur = cle = bloc = paquet = '';
      continue;
    }
    let m;
    if (section === 'importers') {
      if ((m = /^ {2}(\S.*?):\s*$/.exec(ligne))) {
        importateur = denuder(m[1]);
        bloc = paquet = '';
        importateurs.set(importateur, new Map());
      } else if ((m = /^ {4}([A-Za-z]+):\s*$/.exec(ligne))) {
        bloc = m[1];
        paquet = '';
      } else if (
        bloc === 'dependencies' &&
        (m = /^ {6}(\S.*?):\s*$/.exec(ligne))
      ) {
        paquet = denuder(m[1]);
      } else if (
        bloc === 'dependencies' &&
        paquet &&
        importateur &&
        (m = /^ {8}version:\s*(.+?)\s*$/.exec(ligne))
      ) {
        importateurs.get(importateur)?.set(paquet, denuder(m[1]));
      }
      continue;
    }
    if (section === 'snapshots') {
      if ((m = /^ {2}(\S.*?):(?:\s*\{\})?\s*$/.exec(ligne))) {
        cle = denuder(m[1]);
        bloc = '';
        snapshots.set(cle, []);
      } else if ((m = /^ {4}([A-Za-z]+):\s*$/.exec(ligne))) {
        bloc = m[1];
      } else if (
        (bloc === 'dependencies' || bloc === 'optionalDependencies') &&
        cle &&
        (m = /^ {6}(\S.*?):\s*(\S.*?)\s*$/.exec(ligne))
      ) {
        const nom = denuder(m[1]);
        snapshots.get(cle)?.push({ nom, cle: `${nom}@${denuder(m[2])}` });
      }
    }
  }

  /** Résout `link:../../libs/x` depuis l'importateur `depuis`. */
  const resoudreLien = (depuis, cible) => {
    const segments = depuis === '.' ? [] : depuis.split('/');
    for (const seg of cible.slice('link:'.length).split('/')) {
      if (seg === '..') segments.pop();
      else if (seg && seg !== '.') segments.push(seg);
    }
    return segments.join('/');
  };

  const noms = new Set();
  const vusImportateurs = new Set();
  const vusSnapshots = new Set();

  const visiterSnapshot = (clef) => {
    if (vusSnapshots.has(clef)) return;
    vusSnapshots.add(clef);
    for (const dep of snapshots.get(clef) ?? []) {
      noms.add(dep.nom);
      visiterSnapshot(dep.cle);
    }
  };

  const visiterImportateur = (chemin) => {
    if (vusImportateurs.has(chemin)) return;
    vusImportateurs.add(chemin);
    for (const [nom, version] of importateurs.get(chemin) ?? []) {
      if (version.startsWith('link:')) {
        visiterImportateur(resoudreLien(chemin, version));
        continue;
      }
      noms.add(nom);
      visiterSnapshot(`${nom}@${version}`);
    }
  };

  for (const chemin of importateurs.keys()) {
    if (chemin.startsWith('apps/')) visiterImportateur(chemin);
  }

  return noms.size >= CLOTURE_MINIMALE ? noms : null;
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
function compter(alertes, severite, dansLePerimetre = () => true) {
  /** @type {Record<string, number>} */
  const parSeverite = {};
  for (const alerte of alertes) {
    const niveau = severite(alerte);
    parSeverite[niveau] = (parSeverite[niveau] ?? 0) + 1;
  }
  const auSeuil = alertes.filter((a) => SEUIL.includes(severite(a)));
  // Au-dessus du seuil, on sépare ce qui est LIVRÉ de ce qui ne l'est pas. Les
  // secondes ne disparaissent pas : elles sont listées, elles ne bloquent pas.
  const bloquantes = auSeuil.filter((a) => dansLePerimetre(a));
  const horsPerimetre = auSeuil.filter((a) => !dansLePerimetre(a));
  return { parSeverite, bloquantes, horsPerimetre };
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
 * ⚠️ Le paquet de ce jeu hostile est `pino` — un paquet RÉELLEMENT embarqué. Ce
 * n'est pas cosmétique : depuis AM-75 le seuil ne mord que sur le périmètre livré,
 * et un nom fictif rendrait ce jeu non bloquant, donc `exit=0` — il cesserait
 * silencieusement de tester le chemin ALERTES. La charge d'injection, elle, reste
 * dans `summary` et `html_url`, qui sont les valeurs qu'`assainir()` doit couvrir.
 *
 * `ALERTES_DRY_RUN=dependabot-desactive` substitue à la source Dependabot le 403
 * « alerts are disabled » réellement observé le 2026-08-05 : sortie en `exit=1`
 * elle aussi (chemin POINT MORT), mais elle vérifie que l'aide affichée envoie
 * vers Settings → Code security et pas vers un `ALERTS_TOKEN` sans effet.
 *
 * `ALERTES_DRY_RUN=perimetre` / `perimetre-outillage` exercent AM-75, avec des
 * attendus **dérivés du lockfile réel** : `pino` est une dépendance de production,
 * `@pact-foundation/pact` un outil de test. Le second jeu ne porte QUE l'outillage
 * et doit sortir **VERT** — c'est la sonde qui prouve que la distinction change
 * réellement le verdict, et pas seulement l'affichage.
 */
/** Alerte Dependabot synthétique, réduite à ce que la classification regarde. */
const alerteEssai = (numero, paquet, resume) => ({
  number: numero,
  html_url: `https://github.com/${REPO}/security/dependabot/${numero}`,
  dependency: { package: { name: paquet } },
  security_advisory: { severity: 'high', summary: resume },
});

function jeuDEssai() {
  const codeScanning = {
    ok: /** @type {const} */ (true),
    alertes: [
      { rule: { security_severity_level: null, id: 'js/unused-local' } },
    ],
  };

  if (CAS_PERIMETRE || CAS_PERIMETRE_OUTILLAGE) {
    const outillage = alerteEssai(
      31,
      '@pact-foundation/pact',
      'Outil de test — jamais installé par le pnpm install --prod des images',
    );
    return {
      codeScanning,
      dependabot: {
        ok: /** @type {const} */ (true),
        alertes: CAS_PERIMETRE_OUTILLAGE
          ? [outillage]
          : [
              alerteEssai(
                30,
                'pino',
                'Dépendance de production réelle — doit bloquer',
              ),
              outillage,
            ],
      },
    };
  }

  return {
    codeScanning,
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
              // Paquet RÉELLEMENT embarqué : sans cela le jeu cesserait de
              // bloquer et ne testerait plus le chemin ALERTES (cf. en-tête).
              dependency: { package: { name: 'pino' } },
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
  `Seuil de blocage : **${SEUIL.join(', ')}**${DRY_RUN ? ` — ⚠️ jeu d’essai (\`ALERTES_DRY_RUN=${process.env.ALERTES_DRY_RUN}\`)` : ''}`,
);
dire('');

// --- Périmètre livré, calculé UNE fois (AM-75) ------------------------------
const EMBARQUES = arbreEmbarque();
if (EMBARQUES === null) {
  dire(
    '⚠️ **Périmètre livré inconnu** — lockfile illisible, ou clôture invraisemblablement ' +
      'petite (parseur à revoir). **Toutes** les alertes comptent donc comme embarquées : ' +
      'le seuil est volontairement trop strict, on refuse de le rendre permissif sur un doute.',
  );
} else {
  dire(
    `Périmètre bloquant : **${EMBARQUES.size} paquets embarqués**, dérivés du lockfile ` +
      '(dépendances de production des projets `apps/*`, liens `workspace:` suivis) — ' +
      "et non du champ `scope` de Dependabot. L'outillage de dev reste listé, sans bloquer.",
  );
}
dire('');

/**
 * Une alerte Dependabot bloque-t-elle ? Comparaison par NOM de paquet : deux
 * versions d'un même paquet peuvent coexister entre l'arbre de dev et celui de
 * prod, et le doute doit compter comme embarqué.
 */
const PERIMETRE_DEPENDABOT = {
  adjectif: 'embarquée',
  dansLePerimetre: (/** @type {any} */ a) =>
    EMBARQUES === null ||
    EMBARQUES.has(String(a?.dependency?.package?.name ?? '')),
};

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
 * @param {{dansLePerimetre: (a: any) => boolean, adjectif: string} | null} perimetre
 *   restriction du BLOCAGE à ce qui est réellement livré (AM-75). Absent ⇒ tout
 *   ce qui est au-dessus du seuil bloque, comportement d'origine.
 */
function rapporter(titre, resultat, severite, decrire, aide, perimetre = null) {
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
    // Le verdict final est la ligne qu'on lit en premier : elle doit NOMMER la
    // cause quand on la connaît, pas se contenter d'un statut HTTP.
    // ⚠️ Le 403 « alerts are disabled » n'a RIEN à voir avec le PAT : y répondre
    // « ALERTS_TOKEN absent » enverrait fabriquer un jeton sans effet — le travers
    // corrigé en PR #289. On lit donc le corps AVANT de nommer la cause.
    const desactive = /dependabot alerts are disabled/i.test(
      String(resultat.detail ?? ''),
    );
    const cause = desactive
      ? ' — alertes désactivées sur le dépôt'
      : titre === 'Dependabot' && resultat.statut === 403
        ? PAT_POSE
          ? ' — `ALERTS_TOKEN` posé mais refusé (expiré ou scope insuffisant)'
          : ' — `ALERTS_TOKEN` absent'
        : '';
    pointsMorts.push(`${titre} (statut ${resultat.statut}${cause})`);
    return;
  }

  const { parSeverite, bloquantes, horsPerimetre } = compter(
    resultat.alertes,
    severite,
    perimetre ? perimetre.dansLePerimetre : undefined,
  );

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

  /** Liste bornée, pour ne pas noyer le résumé. */
  const lister = (alertes) => {
    for (const alerte of alertes.slice(0, 20)) {
      dire(`- **${severite(alerte)}** — ${decrire(alerte)}`);
    }
    if (alertes.length > 20) dire(`- … et ${alertes.length - 20} autre(s).`);
    dire('');
  };

  if (bloquantes.length === 0) {
    dire(
      perimetre
        ? `✅ Aucune alerte **${perimetre.adjectif}** au-dessus du seuil.`
        : '✅ Aucune au-dessus du seuil.',
    );
    dire('');
  } else {
    dire(
      perimetre
        ? `🔴 **${bloquantes.length} alerte(s) ${perimetre.adjectif}(s) au-dessus du seuil :**`
        : `🔴 **${bloquantes.length} alerte(s) au-dessus du seuil :**`,
    );
    dire('');
    lister(bloquantes);
    bloquants.push(`${titre} : ${bloquantes.length}`);
  }

  // Ce qui franchit le seuil sans être livré : listé, jamais bloquant. On le
  // montre pour qu'un « vert » ne passe pas pour une absence d'alertes.
  if (perimetre && horsPerimetre.length > 0) {
    dire(
      `ℹ️ **${horsPerimetre.length} alerte(s) ≥ seuil hors périmètre livré** — outillage de dev ` +
        `(non installé par le \`pnpm install --prod\` des images) : informatif, ne bloque pas.`,
    );
    dire('');
    lister(horsPerimetre);
  }
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
      : PAT_POSE
        ? 'Un `ALERTS_TOKEN` **est posé** et le 403 persiste : le PAT est expiré, ' +
          'révoqué, ou ne porte pas le scope `security_events`. Le renouveler.'
        : '**`ALERTS_TOKEN` absent** — c’est la seule cause ici, et le remède tient ' +
          'en un geste : créer un PAT au scope `security_events` et le poser en secret ' +
          'Actions `ALERTS_TOKEN`. Le `GITHUB_TOKEN` par défaut ne couvre pas ' +
          '`dependabot/alerts`, et aucune permission de workflow ne l’y autorise.',
  PERIMETRE_DEPENDABOT,
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
    `✅ **VERT** — les deux sources ont répondu, et aucune alerte ≥ \`${SEUIL.join('/')}\` ` +
      `ne touche le périmètre livré${EMBARQUES === null ? '' : ` (${EMBARQUES.size} paquets embarqués)`}.`,
  );
  dire('');
  dire('Ce vert est opposable : la vérification a bien eu lieu.');
}

const resume = process.env.GITHUB_STEP_SUMMARY;
if (resume) appendFileSync(resume, lignes.join('\n') + '\n');

process.exit(code);
