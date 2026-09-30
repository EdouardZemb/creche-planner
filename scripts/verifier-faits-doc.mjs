#!/usr/bin/env node
// @ts-check
/**
 * Confronte les FAITS que la documentation énonce aux sources qui les
 * produisent : version coupée, projets Nx, ports publiés par la pile locale,
 * tableau de métriques de la page d’accueil (tests, E2E, Pact, portes, ADR),
 * versions de la chaîne d'outils.
 *
 * ## Pourquoi ce script existe
 *
 * Le 2026-08-08, le README annonçait « en production, version `0.8.0`, 8 trains
 * de release » : le réel était `0.15.0` et 16 trains. Ce n'était pas la première
 * fois — la session de gouvernance documentaire de juillet avait déjà noté le
 * même document « périmé : Phase 9, React 18, 4 services ». Deux dérives en six
 * semaines sur le document que lit un arrivant en premier.
 *
 * La cause n'est pas la négligence, c'est la RECOPIE : chacun de ces faits vit
 * déjà, écrit par un outil, dans `package.json`, `services.json`,
 * `docker-compose*.yml` ou les `CHANGELOG.md` produits par `nx release`. Le
 * document en tenait une copie manuelle, et une copie manuelle dérive.
 *
 * D'où la forme de cette porte, qui est celle du lot D6 : ne pas relire le
 * document avec un œil neuf, mais le CONFRONTER à la source. L'oracle qui ne
 * garde rien est celui qu'on écrit de la même main que le document — ici,
 * aucune valeur attendue n'est écrite dans ce fichier, elles sont toutes lues.
 *
 * ## Ce que la porte NE peut pas savoir
 *
 * Une frontière nette, et il faut la connaître pour ne pas se croire couvert :
 * le dépôt sait quelle version a été **coupée** (`nx release` l'écrit dans les
 * `package.json`), il ne sait pas laquelle est **promue en production** ni à
 * quelle date — le serveur n'est joignable qu'en LAN, et rien de ce qu'il
 * répond n'atterrit ici. Le rang du train de release et la date de promotion
 * restent donc des faits humains, tenus par [[prod-deployment-facts]]. Ce que
 * la porte garantit : la version citée est bien une version coupée, et les 7
 * services sont alignés dessus.
 *
 * ## Usage
 *   pnpm faits               # ou : node scripts/verifier-faits-doc.mjs
 *
 * ## Contraintes de conception
 *  - Aucune conclusion « par défaut » : si une SOURCE devient illisible, ou si
 *    un fait n'est plus cité nulle part, le script ÉCHOUE. Un fait qui
 *    disparaît du document est indiscernable d'un fait juste, et c'est
 *    précisément ainsi qu'un oracle cesse silencieusement de garder quoi que ce
 *    soit (leçon des lots D6 et D8).
 *  - Lectures `fs` en `try/catch` seul, jamais un `existsSync()` suivi d'un
 *    `readFileSync()` : ce couple est la fenêtre TOCTOU que la règle CodeQL
 *    `js/file-system-race` (HIGH, bloquante en CI) refuse.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const RACINE = path.resolve(import.meta.dirname, '..');

/**
 * Documents dont la nature est de relater un état daté : y « corriger » une
 * version reviendrait à réécrire ce qu'ils documentent. Même arbitrage que le
 * registre des pièges — et il coûte quelque chose, donc il est nommé : un fait
 * périmé y survit, seule sa DATE le qualifie.
 *
 * @type {{ prefixe: string, raison: string }[]}
 */
const DOCUMENTS_RELEVES = [
  {
    prefixe: 'docs/06-etat-davancement.md',
    raison:
      'journal d’avancement : chaque entrée est datée et relate l’état de son jour.',
  },
  {
    prefixe: 'docs/05-plan-de-developpement.md',
    raison:
      'plan initial, marqué « document historique » : ses cases cochées décrivent ce qui a été livré À L’ÉPOQUE.',
  },
  {
    prefixe: 'docs/25-audit-cicd-remediation.md',
    raison: 'constat d’audit daté (2026-06) : le relire, pas le réécrire.',
  },
  {
    prefixe: 'docs/27-audit-global-remediation.md',
    raison: 'constat d’audit daté (2026-06) : le relire, pas le réécrire.',
  },
  {
    prefixe: 'docs/adr/',
    raison:
      'ADR : une décision datée, immuable par convention (on la remplace, on ne la réécrit pas).',
  },
  {
    prefixe: '.claude/memory/',
    raison:
      'fiches de mémoire : relevés datés, et miroir volontairement incomplet d’un magasin local (CLAUDE.md).',
  },
  {
    prefixe: 'docs/runbook-nx-migrate.md',
    raison:
      'runbook d’une migration précise : la version qu’il cite est son SUJET.',
  },
  {
    prefixe: '.claude/plans/dependabot-resolution.md',
    raison:
      'plan CLOS et daté (« Statut au 2026-07-29 : ✅ FAIT ») dont le sujet EST la migration Nx 22→23 : ' +
      'les deux versions qu’il cite sont son propos, pas une description du dépôt d’aujourd’hui. ' +
      'Un plan encore ouvert, lui, reste dans le périmètre — c’est là que la recopie fait des dégâts.',
  },
];

/**
 * Mentions légitimes d'une valeur qui ne correspond pas à la source, dans un
 * document qui, lui, instruit du travail futur. Une entrée devenue inutile est
 * signalée (allowlist qui ne pourrit pas).
 *
 * @type {{ fichier: string, fait: string, raison: string }[]}
 */
const EXCEPTIONS = [
  {
    fichier: 'CONTRIBUTING.md',
    fait: 'pnpm',
    raison:
      'mention NÉGATIVE : « un pnpm 8.x régénérerait un lockfile incompatible » — la version citée est celle à ne pas utiliser.',
  },
  {
    fichier: 'docs/14-peuplement-bdd-et-api-contrats.md',
    fait: 'pnpm',
    raison:
      'compare le pnpm du dépôt au pnpm global d’un poste (8 vs 10) : les deux valeurs sont le propos.',
  },
  {
    fichier: 'docs/07-spec-ux-navigation.md',
    fait: 'React',
    raison:
      'phrase au passé qui relate ce que la Phase 8 A LIVRÉ (« React 18 + Vite PWA ») : vraie à sa date, dans la section Contexte.',
  },
  {
    fichier: 'docs/35-politique-documentation.md',
    fait: 'React',
    raison:
      'CITATION verbatim du constat de gouvernance du 2026-07-02 (« périmé : Phase 9, React 18, 4 services ») : ' +
      'c’est le symptôme que la politique décrit, pas une affirmation sur le dépôt d’aujourd’hui. ' +
      'La porte a signalé cette ligne à son premier run sur ce document — l’exception est la sortie prévue, et elle se relit en revue.',
  },
];

/** Répertoires balayés pour les citations (les relevés en sont retirés ensuite). */
const REPERTOIRES = ['docs', '.claude/plans'];

/** Documents de racine balayés. */
const DOCUMENTS_RACINE = [
  'CLAUDE.md',
  'CONTRIBUTING.md',
  'CONVENTIONS.md',
  'README.md',
  'SECURITY.md',
];

/**
 * Documents qui décrivent la PILE LOCALE, seuls concernés par le fait « ports ».
 * Les documents d'exploitation décrivent la prod (Caddy 8443, tunnel…), dont
 * les ports ne sont pas ceux de `docker-compose.override.yml`.
 */
const DOCUMENTS_PILE_LOCALE = ['README.md', 'CONTRIBUTING.md'];

/** @typedef {{ portee: string, message: string, remede?: string }} Constat */

/** @type {Constat[]} */
const erreurs = [];
/** @type {Constat[]} */
const avertissements = [];
/** Faits effectivement confrontés à leur source : sert de garde anti-balayage-à-vide. */
const faitsVerifies = new Set();

/** @param {string} portee @param {string} message @param {string} [remede] */
function erreur(portee, message, remede) {
  erreurs.push(
    remede === undefined ? { portee, message } : { portee, message, remede },
  );
}

/** @param {string} portee @param {string} message @param {string} [remede] */
function avertir(portee, message, remede) {
  avertissements.push(
    remede === undefined ? { portee, message } : { portee, message, remede },
  );
}

/**
 * Lecteur de fichiers, INJECTABLE : `--autotest` le remplace pour abîmer une
 * source en mémoire. Le disque n'est jamais modifié par une sonde.
 *
 * @type {(relatif: string) => string | null}
 */
let lecteur = (relatif) => {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
};

/** Lit un fichier texte, ou rend `null` s'il est absent/illisible. */
function lireTexte(relatif) {
  return lecteur(relatif);
}

/** Lit un JSON, ou rend `null`. */
function lireJson(relatif) {
  const brut = lireTexte(relatif);
  if (brut === null) return null;
  try {
    return JSON.parse(brut);
  } catch {
    return null;
  }
}

/**
 * Liste récursivement les fichiers d'un répertoire dont le nom correspond.
 *
 * @param {string} relatif
 * @param {(nom: string) => boolean} garde
 * @returns {string[]}
 */
function lister(relatif, garde) {
  /** @type {fs.Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(path.join(RACINE, relatif), {
      withFileTypes: true,
    });
  } catch {
    return [];
  }
  const trouves = [];
  for (const entree of entrees) {
    if (entree.name === 'node_modules' || entree.name === 'dist') continue;
    const chemin = `${relatif}/${entree.name}`;
    if (entree.isDirectory()) trouves.push(...lister(chemin, garde));
    else if (garde(entree.name)) trouves.push(chemin);
  }
  return trouves;
}

/** Le texte d'un document, blocs de code retirés (un exemple n'est pas une affirmation). */
function horsBlocsDeCode(contenu) {
  const lignes = [];
  let dedans = false;
  for (const ligne of contenu.split('\n')) {
    if (/^\s*```/.test(ligne)) {
      dedans = !dedans;
      lignes.push('');
      continue;
    }
    lignes.push(dedans ? '' : ligne);
  }
  return lignes;
}

/** Le document est-il un relevé daté ? @returns {string | null} la raison, ou null */
function releve(document) {
  for (const { prefixe, raison } of DOCUMENTS_RELEVES) {
    if (document === prefixe || document.startsWith(prefixe)) return raison;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fait 1 — la version citée est celle coupée par `nx release`, et les 7
// services sont alignés dessus.
// ---------------------------------------------------------------------------

/** @returns {string | null} la version coupée, ou null si la source est illisible */
function verifierVersionCoupee() {
  const services = lireJson('scripts/services.json');
  const applicatifs = services?.servicesApplicatifs;
  if (!Array.isArray(applicatifs) || applicatifs.length === 0) {
    erreur(
      'scripts/services.json',
      'source illisible ou sans `servicesApplicatifs` — impossible de savoir quels services doivent être alignés.',
    );
    return null;
  }

  /** @type {Map<string, string[]>} */
  const parVersion = new Map();
  for (const service of applicatifs) {
    const paquet = lireJson(`apps/${service}/package.json`);
    const version = paquet?.version;
    if (typeof version !== 'string') {
      erreur(
        `apps/${service}/package.json`,
        'version absente ou illisible — `nx release` écrit ce champ.',
      );
      continue;
    }
    parVersion.set(version, [...(parVersion.get(version) ?? []), service]);
  }

  if (parVersion.size === 0) return null;
  faitsVerifies.add('version-coupee');

  if (parVersion.size > 1) {
    const detail = [...parVersion.entries()]
      .map(([v, s]) => `${v} (${s.join(', ')})`)
      .join(' · ');
    erreur(
      'apps/*/package.json',
      `les services applicatifs ne portent pas la même version : ${detail}.`,
      '`nx release` les coupe ensemble : une divergence signale une coupe partielle ou un merge à recoller.',
    );
    return null;
  }

  const version = [...parVersion.keys()][0];
  if (version === undefined) return null;

  const readme = lireTexte('README.md');
  if (readme === null) {
    erreur('README.md', 'document illisible.');
    return version;
  }
  const citee = /version\s+`(\d+\.\d+\.\d+)`/.exec(
    horsBlocsDeCode(readme).join('\n'),
  );
  if (citee === null) {
    erreur(
      'README.md',
      'aucune version de la forme « version `X.Y.Z` » n’est citée — le fait a disparu du document, et la porte ne garde plus rien.',
      'la section « État du projet » doit citer la version coupée.',
    );
    return version;
  }
  if (citee[1] !== version) {
    erreur(
      'README.md',
      `version citée \`${citee[1]}\` ≠ version coupée \`${version}\` (lue dans les \`apps/*/package.json\`).`,
      'reprendre la valeur de la coupe ; le RANG du train et la date de promotion restent des faits humains.',
    );
  }
  return version;
}

// ---------------------------------------------------------------------------
// Fait 2 — l'arborescence du README nomme exactement les projets réels.
// ---------------------------------------------------------------------------

/** Les projets Nx réels : tout répertoire portant un `package.json`. */
function projetsReels() {
  const paquets = [
    ...lister('apps', (nom) => nom === 'package.json'),
    ...lister('libs', (nom) => nom === 'package.json'),
  ];
  return paquets.map((p) => p.replace(/\/package\.json$/, ''));
}

/** Répertoires de regroupement : ils structurent l'arbre sans être des projets. */
const REGROUPEMENTS = new Set([
  'apps',
  'libs',
  'pacts',
  'scripts',
  'docker',
  'contracts',
  'shared',
]);

function verifierProjetsNx() {
  const projets = projetsReels();
  if (projets.length === 0) {
    erreur(
      'apps/ + libs/',
      'aucun projet trouvé — le balayage est cassé (un `package.json` par projet est la convention du dépôt).',
    );
    return;
  }

  const readme = lireTexte('README.md');
  if (readme === null) return;

  // Le bloc d'arborescence : la première clôture ``` qui suit « ## Monorepo ».
  const apres = readme.split(/^##\s+Monorepo/m)[1];
  const bloc =
    apres === undefined ? null : /```[^\n]*\n([\s\S]*?)```/.exec(apres);
  if (bloc === null || bloc[1] === undefined) {
    erreur(
      'README.md',
      'section « Monorepo » sans bloc d’arborescence — le fait a disparu du document.',
      'la porte compare cette arborescence aux projets réels ; sans elle, elle ne garde rien.',
    );
    return;
  }
  faitsVerifies.add('projets-nx');
  const texte = bloc[1];

  /** Jetons attendus pour un projet : son nom, et celui de son parent s'il est imbriqué. */
  const attendus = new Map();
  for (const projet of projets) {
    const segments = projet.split('/'); // apps/web · libs/contracts/foyer
    const nom = segments[segments.length - 1];
    if (nom !== undefined) attendus.set(`${nom}/`, projet);
    if (segments.length > 2) {
      const parent = segments[segments.length - 2];
      if (parent !== undefined) attendus.set(`${parent}/`, projet);
    }
  }

  for (const [jeton, projet] of attendus) {
    // Délimité à gauche : sans cela, `svc-notifications/` vaudrait présence de
    // `notifications/` — et le lot qui a ajouté le 5ᵉ contexte de contrats
    // serait passé au travers (c'est le défaut qui a motivé cette porte).
    const present = new RegExp(
      `(?<![a-z0-9-])${jeton.replace('/', '\\/')}`,
    ).test(texte);
    if (!present) {
      erreur(
        'README.md',
        `le projet \`${projet}\` n’apparaît pas dans l’arborescence (jeton \`${jeton}\` absent).`,
        'ajouter la ligne, avec ce que le projet porte.',
      );
    }
  }

  // Sonde négative : un jeton de l'arbre qui ne correspond à rien de réel est
  // un projet supprimé ou renommé dont la ligne a survécu.
  for (const ligne of texte.split('\n')) {
    const jeton = /^\s*([a-z0-9-]+)\//.exec(ligne);
    if (jeton === null || jeton[1] === undefined) continue;
    const nom = jeton[1];
    if (REGROUPEMENTS.has(nom)) continue;
    if (attendus.has(`${nom}/`)) continue;
    erreur(
      'README.md',
      `l’arborescence liste \`${nom}/\`, qui n’est ni un projet ni un répertoire de regroupement connu.`,
      'projet supprimé/renommé ? sinon, l’inscrire dans `REGROUPEMENTS` de ce script.',
    );
  }
}

// ---------------------------------------------------------------------------
// Fait 3 — les ports cités sont ceux que la pile locale publie.
// ---------------------------------------------------------------------------

/**
 * Ports publiés par `docker-compose.override.yml` (le seul fichier qui les
 * publie : la prod n'expose que Caddy). Analyse ligne à ligne — la structure
 * visée est plate et connue, et aucune dépendance YAML n'est installée pour un
 * script qui doit tourner avant `pnpm install`.
 *
 * @returns {Map<number, string>} port hôte → service
 */
function portsPublies() {
  const contenu = lireTexte('docker-compose.override.yml');
  const ports = new Map();
  if (contenu === null) return ports;
  let service = null;
  let dansPorts = false;
  for (const ligne of contenu.split('\n')) {
    const debutService = /^ {2}([a-z0-9-]+):\s*$/.exec(ligne);
    if (debutService !== null) {
      service = debutService[1] ?? null;
      dansPorts = false;
      continue;
    }
    if (/^ {4}ports:\s*$/.test(ligne)) {
      dansPorts = true;
      continue;
    }
    if (/^ {4}[a-z_]+:/.test(ligne)) {
      dansPorts = false;
      continue;
    }
    const entree = /^\s*-\s*'(\d+):(\d+)'\s*$/.exec(ligne);
    if (dansPorts && entree !== null && service !== null) {
      const hote = Number(entree[1]);
      if (Number.isFinite(hote)) ports.set(hote, service);
    }
  }
  return ports;
}

function verifierPorts() {
  const publies = portsPublies();
  if (publies.size === 0) {
    erreur(
      'docker-compose.override.yml',
      'aucun port publié lu — l’analyse est cassée ou le fichier a changé de forme.',
    );
    return;
  }
  faitsVerifies.add('ports-locaux');

  const services = lireJson('scripts/services.json');
  const applicatifs = new Set(services?.servicesApplicatifs ?? []);

  /** Ports cités par les documents de la pile locale. */
  const cites = new Set();
  for (const document of DOCUMENTS_PILE_LOCALE) {
    const contenu = lireTexte(document);
    if (contenu === null) continue;
    const lignes = contenu.split('\n');
    for (let i = 0; i < lignes.length; i += 1) {
      const motif = /localhost:(\d+)/g;
      let trouve;
      while ((trouve = motif.exec(lignes[i] ?? '')) !== null) {
        const port = Number(trouve[1]);
        cites.add(port);
        if (!publies.has(port)) {
          erreur(
            `${document}:${i + 1}`,
            `port \`${port}\` cité, mais la pile locale ne le publie pas.`,
            'port fantôme (service retiré ?) ou décrit ailleurs que dans `docker-compose.override.yml`.',
          );
        }
      }
    }
  }

  // Complétude : un service applicatif dont le port n'est documenté nulle part
  // est un pan de la pile qu'un arrivant ne peut pas joindre (leçon du lot D6,
  // où 12 opérations servies n'étaient documentées nulle part).
  for (const [port, service] of publies) {
    if (!applicatifs.has(service)) continue;
    if (!cites.has(port)) {
      erreur(
        'README.md',
        `le service applicatif \`${service}\` publie le port \`${port}\`, qu’aucun document de la pile locale ne cite.`,
        'ajouter la ligne à la table des URL.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fait 4 — les versions de la chaîne d'outils citées sont celles installées.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} VersionAttendue
 * @property {string} nom      tel qu'il s'écrit dans la prose
 * @property {RegExp} motif    ce qui le repère (le plus long d'abord : Vitest avant Vite)
 * @property {string} source   d'où vient la valeur, pour le message d'erreur
 * @property {string} valeur   la valeur réelle, complète
 */

/** @returns {VersionAttendue[]} */
function versionsAttendues() {
  const racine = lireJson('package.json');
  const web = lireJson('apps/web/package.json');
  const nvmrc = lireTexte('.nvmrc');
  /** @type {VersionAttendue[]} */
  const faits = [];

  /** @param {string} nom @param {RegExp} motif @param {string} source @param {unknown} brut */
  const ajouter = (nom, motif, source, brut) => {
    if (typeof brut !== 'string') return;
    const valeur = brut
      .replace(/^[\^~]/, '')
      .replace(/^pnpm@/, '')
      .trim();
    if (/^\d/.test(valeur)) faits.push({ nom, motif, source, valeur });
  };

  ajouter(
    'React',
    /\bReact (\d[\d.]*)/g,
    'apps/web/package.json',
    web?.dependencies?.react,
  );
  ajouter(
    'Vitest',
    /\bVitest (\d[\d.]*)/g,
    'package.json',
    racine?.devDependencies?.vitest,
  );
  ajouter(
    'Vite',
    /\bVite (\d[\d.]*)/g,
    'package.json',
    racine?.devDependencies?.vite,
  );
  ajouter(
    'Nx',
    /\bNx (\d[\d.]*)/g,
    'package.json',
    racine?.devDependencies?.nx,
  );
  ajouter(
    'NestJS',
    /\bNestJS (\d[\d.]*)/g,
    'package.json',
    racine?.devDependencies?.['@nestjs/core'],
  );
  ajouter(
    'pnpm',
    /\bpnpm@?\s?(\d[\d.]*)/g,
    'package.json (packageManager)',
    racine?.packageManager,
  );
  ajouter('Node', /\bNode (\d[\d.]*)/g, '.nvmrc', nvmrc?.trim());
  return faits;
}

/** La valeur citée est-elle un préfixe, composant par composant, de la réelle ? */
function estPrefixeDeVersion(citee, reelle) {
  const a = citee.split('.');
  const b = reelle.split('.');
  if (a.length > b.length) return false;
  return a.every((composant, i) => composant === b[i]);
}

/** @param {string[]} documents */
function verifierVersionsTechno(documents) {
  const attendues = versionsAttendues();
  if (attendues.length === 0) {
    erreur(
      'package.json',
      'aucune version de référence lue — les sources sont illisibles, la porte ne garde rien.',
    );
    return;
  }

  const exceptions = new Set(EXCEPTIONS.map((e) => `${e.fichier}::${e.fait}`));
  const exceptionsUtilisees = new Set();
  let citations = 0;

  for (const document of documents) {
    if (releve(document) !== null) continue;
    const contenu = lireTexte(document);
    if (contenu === null) continue;
    // Blocs de code INCLUS : l'arborescence du README — le premier endroit où
    // un arrivant lit « React 19 + Vite 8 » — en est un. Les exclure faisait
    // une porte aveugle à l'endroit le plus lu (trouvé par sonde négative).
    const lignes = contenu.split('\n');

    for (const { nom, motif, source, valeur } of attendues) {
      for (let i = 0; i < lignes.length; i += 1) {
        const recherche = new RegExp(motif.source, 'g');
        let trouve;
        while ((trouve = recherche.exec(lignes[i] ?? '')) !== null) {
          const citee = trouve[1];
          if (citee === undefined) continue;
          citations += 1;
          if (estPrefixeDeVersion(citee, valeur)) continue;
          const cle = `${document}::${nom}`;
          if (exceptions.has(cle)) {
            exceptionsUtilisees.add(cle);
            continue;
          }
          erreur(
            `${document}:${i + 1}`,
            `« ${nom} ${citee} » — la valeur installée est \`${valeur}\` (${source}).`,
            'mettre à jour, ou retirer la version : un document qui n’a pas besoin de la fixer ne devrait pas la recopier.',
          );
        }
      }
    }
  }

  if (citations === 0) {
    erreur(
      'balayage',
      'aucune version de techno citée dans toute la documentation — l’extraction est cassée.',
      'vérifier les motifs de `versionsAttendues()`.',
    );
    return;
  }
  faitsVerifies.add('versions-techno');

  for (const { fichier, fait, raison } of EXCEPTIONS) {
    if (!exceptionsUtilisees.has(`${fichier}::${fait}`)) {
      avertir(
        'registre',
        `exception inutilisée : ${fichier} / ${fait} (${raison})`,
        'la mention a disparu ou a été corrigée — retirer l’entrée.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Fait 5 — le tableau de métriques du README compte ce que le dépôt contient.
//
// Le 2026-09-30, ce tableau annonçait 240 fichiers de test pour 292 réels : le
// compte omettait les 52 tests de composants `*.test.tsx`. Aucune porte ne le
// voyait — ni ce chiffre, ni les cinq autres du même tableau (portes, projets
// Nx, ADR, contrats Pact, specs E2E), vérifiés un par un par mutation : le
// document énonçait plus de faits que la porte qui le garde (`LE-51`).
// ---------------------------------------------------------------------------

/**
 * Fichiers SUIVIS par git sous `apps/` et `libs/`. Le suivi, et non le disque :
 * un run de mutation dépose des copies des specs dans `.stryker-tmp/`
 * (gitignoré), qu’un balayage du disque compterait.
 *
 * @type {() => string[] | null}
 */
const suivis = () => {
  try {
    return execFileSync('git', ['ls-files', '-z', '--', 'apps', 'libs'], {
      cwd: RACINE,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter((f) => f.length > 0);
  } catch {
    return null;
  }
};

const E2E = /\.e2e\.spec\.ts$/;
const SUFFIXES_UNITAIRES = ['.spec.ts', '.test.ts', '.test.tsx'];

/** Nombres qu'une phrase du README écrit en toutes lettres (anglais). */
const NOMBRES_EN_LETTRES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

/**
 * Les comptes réels. Chaque attendu est lu dans sa source : l'index git, les
 * `testDir` des configs Playwright, `pacts/`, `docs/adr/`, `ci.yml`.
 */
function metriquesReelles() {
  const fichiers = suivis();
  if (fichiers === null || fichiers.length === 0) {
    erreur(
      'git ls-files',
      'index git illisible ou vide — impossible de compter les tests (la porte se lance depuis un clone git).',
    );
    return null;
  }

  /** @type {Record<string, number>} */
  const parSuffixe = {};
  for (const suffixe of SUFFIXES_UNITAIRES) parSuffixe[suffixe] = 0;
  let unitaires = 0;
  for (const fichier of fichiers) {
    if (E2E.test(fichier)) continue;
    const suffixe = SUFFIXES_UNITAIRES.find((s) => fichier.endsWith(s));
    if (suffixe === undefined) continue;
    parSuffixe[suffixe] = (parSuffixe[suffixe] ?? 0) + 1;
    unitaires += 1;
  }

  // Les répertoires que Playwright parcourt : le `testDir` de chaque config.
  /** @type {Set<string>} */
  const repertoires = new Set();
  const configs = fichiers.filter((f) =>
    /^apps\/[^/]+\/playwright[^/]*\.config\.ts$/.test(f),
  );
  for (const config of configs) {
    const texte = lireTexte(config);
    const testDir = texte === null ? null : /testDir:\s*'([^']+)'/.exec(texte);
    if (testDir === null || testDir[1] === undefined) {
      erreur(
        config,
        'aucun `testDir` lu — impossible de savoir quelles specs Playwright joue.',
      );
      return null;
    }
    repertoires.add(
      `${path.posix.join(path.posix.dirname(config), testDir[1])}/`,
    );
  }
  const e2e = fichiers.filter((f) => E2E.test(f));
  const playwright = e2e.filter((f) =>
    [...repertoires].some((r) => f.startsWith(r)),
  ).length;

  const ci = lireTexte('.github/workflows/ci.yml');
  if (ci === null) {
    erreur(
      '.github/workflows/ci.yml',
      'workflow illisible — impossible de compter les portes.',
    );
    return null;
  }
  const portes = new Set(
    [...ci.matchAll(/node\s+(scripts\/verifier-[a-z0-9-]+\.mjs)/g)].map(
      (m) => m[1],
    ),
  ).size;

  const projets = projetsReels();
  return {
    unitaires,
    parSuffixe,
    playwright,
    e2eApi: e2e.length - playwright,
    pacts: lister('pacts', (nom) => nom.endsWith('.json')).length,
    adr: lister('docs/adr', (nom) => /^\d{4}-.*\.md$/.test(nom)).length,
    portes,
    applications: projets.filter((p) => p.startsWith('apps/')).length,
    bibliotheques: projets.filter((p) => p.startsWith('libs/')).length,
  };
}

/**
 * La cellule « valeur » de la ligne du tableau dont la première cellule
 * correspond. Une ligne absente est une ERREUR : un fait qui disparaît du
 * document est indiscernable d'un fait juste.
 *
 * @returns {string | null}
 */
function celluleMetrique(readme, libelle) {
  for (const ligne of readme.split('\n')) {
    const cellules = ligne.split('|');
    if (cellules.length < 4) continue;
    if (libelle.test(cellules[1] ?? '')) return cellules[2] ?? '';
  }
  erreur(
    'README.md',
    `ligne de métrique introuvable (${libelle.source}) — le fait a disparu du tableau.`,
    'la porte compare ce chiffre au dépôt ; sans la ligne, elle ne garde rien.',
  );
  return null;
}

/** @param {string} portee @param {number} cite @param {number} reel @param {string} remede */
function comparer(portee, cite, reel, remede) {
  if (cite === reel) return;
  erreur('README.md', `${portee} : ${cite} cité, ${reel} réel.`, remede);
}

/** Premier nombre en gras d'une cellule (`**292**`), ou null. */
function nombreEnGras(cellule) {
  const trouve = /\*\*(\d+)\*\*/.exec(cellule);
  return trouve === null ? null : Number(trouve[1]);
}

function verifierMetriques() {
  const readme = lireTexte('README.md');
  if (readme === null) return;
  const reel = metriquesReelles();
  if (reel === null) return;
  faitsVerifies.add('metriques-readme');

  /** @type {{ libelle: RegExp, portee: string, attendu: number, remede: string }[]} */
  const lignes = [
    {
      libelle: /Unit & integration test files/,
      portee: 'fichiers de tests unitaires et d’intégration',
      attendu: reel.unitaires,
      remede:
        'compte : fichiers suivis `*.spec.ts`, `*.test.ts`, `*.test.tsx` sous apps/ et libs/, hors `*.e2e.spec.ts`.',
    },
    {
      libelle: /End-to-end specs/,
      portee: 'specs E2E Playwright',
      attendu: reel.playwright,
      remede:
        'compte : `*.e2e.spec.ts` suivis sous le `testDir` d’une config `playwright*.config.ts`.',
    },
    {
      libelle: /Consumer-driven contracts/,
      portee: 'contrats Pact',
      attendu: reel.pacts,
      remede: 'compte : `pacts/*.json`.',
    },
    {
      libelle: /quality gates/,
      portee: 'portes bloquantes',
      attendu: reel.portes,
      remede:
        'compte : scripts `scripts/verifier-*.mjs` distincts joués par `ci.yml`.',
    },
    {
      libelle: /Nx projects/,
      portee: 'projets Nx',
      attendu: reel.applications + reel.bibliotheques,
      remede:
        'compte : répertoires de apps/ et libs/ portant un `package.json`.',
    },
    {
      libelle: /Architecture Decision Records/,
      portee: 'ADR',
      attendu: reel.adr,
      remede: 'compte : `docs/adr/NNNN-*.md`.',
    },
  ];
  /** @type {Map<string, string>} */
  const cellules = new Map();
  for (const { libelle, portee, attendu, remede } of lignes) {
    const cellule = celluleMetrique(readme, libelle);
    if (cellule === null) continue;
    cellules.set(portee, cellule);
    const cite = nombreEnGras(cellule);
    if (cite === null) {
      erreur('README.md', `${portee} : aucun nombre en gras dans la cellule.`);
      continue;
    }
    comparer(portee, cite, attendu, remede);
  }

  // Le détail par suffixe, s'il est écrit (« 214 `*.spec.ts` »).
  const tests = cellules.get('fichiers de tests unitaires et d’intégration');
  if (tests !== undefined) {
    for (const suffixe of SUFFIXES_UNITAIRES) {
      const motif = new RegExp(
        `(\\d+) [^\\d|]*?\`\\*${suffixe.replaceAll('.', '\\.')}\``,
      );
      const cite = motif.exec(tests);
      if (cite !== null) {
        comparer(
          `fichiers \`*${suffixe}\``,
          Number(cite[1]),
          reel.parSuffixe[suffixe] ?? 0,
          'détail par suffixe du tableau de métriques.',
        );
      }
    }
  }

  // Les specs E2E d'API, écrites dans la même cellule que Playwright.
  const e2e = cellules.get('specs E2E Playwright');
  if (e2e !== undefined) {
    const api = /(\d+) API end-to-end spec/.exec(e2e);
    if (api === null) {
      erreur(
        'README.md',
        'specs E2E d’API : le compte a disparu de la cellule E2E.',
        `écrire « plus ${reel.e2eApi} API end-to-end specs » — les \`*.e2e.spec.ts\` hors Playwright.`,
      );
    } else {
      comparer(
        'specs E2E d’API',
        Number(api[1]),
        reel.e2eApi,
        'compte : `*.e2e.spec.ts` suivis hors des `testDir` Playwright.',
      );
    }
  }

  const nx = /Nx projects \((\d+) applications \+ (\d+) libraries\)/.exec(
    readme,
  );
  if (nx === null) {
    erreur(
      'README.md',
      'projets Nx : le détail « (N applications + N libraries) » a disparu.',
    );
  } else {
    comparer(
      'applications Nx',
      Number(nx[1]),
      reel.applications,
      'répertoires de apps/ portant un `package.json`.',
    );
    comparer(
      'bibliothèques Nx',
      Number(nx[2]),
      reel.bibliotheques,
      'répertoires de libs/ portant un `package.json`.',
    );
  }

  // Les reprises en prose du même chiffre, qui dérivent séparément du tableau.
  const prosePortes = /runs \*\*(\d+) bespoke/.exec(readme);
  if (prosePortes === null) {
    erreur(
      'README.md',
      'portes : la phrase « the pipeline runs **N bespoke gates** » a disparu.',
    );
  } else {
    comparer(
      'portes (prose de « Quality gates »)',
      Number(prosePortes[1]),
      reel.portes,
      'même compte que le tableau.',
    );
  }
  const proseAdr = /^([A-Z][a-z]+) ADRs record/m.exec(readme);
  const adrEnLettres =
    proseAdr === null
      ? -1
      : NOMBRES_EN_LETTRES.indexOf((proseAdr[1] ?? '').toLowerCase());
  if (adrEnLettres === -1) {
    erreur(
      'README.md',
      'ADR : la phrase « N ADRs record … » (nombre en toutes lettres) a disparu ou est illisible.',
    );
  } else {
    comparer(
      'ADR (prose de « Architecture decisions »)',
      adrEnLettres,
      reel.adr,
      'nombre écrit en toutes lettres, en anglais.',
    );
  }
}

/**
 * Joue les cinq vérifications. Réentrant : constats et faits confrontés sont
 * remis à zéro à chaque appel, sans quoi `--autotest` cumulerait ceux d'une
 * sonde sur l'autre et conclurait juste par accident.
 */
function executer() {
  erreurs.length = 0;
  avertissements.length = 0;
  faitsVerifies.clear();
  const documents = [
    ...DOCUMENTS_RACINE,
    ...REPERTOIRES.flatMap((r) => lister(r, (nom) => nom.endsWith('.md'))),
  ];

  if (documents.length === 0) {
    erreur(
      'balayage',
      'aucun document markdown lu — le script est-il lancé depuis le dépôt ?',
    );
  } else {
    verifierVersionCoupee();
    verifierProjetsNx();
    verifierPorts();
    verifierVersionsTechno(documents);
    verifierMetriques();
  }

  const ATTENDUS = [
    'version-coupee',
    'projets-nx',
    'ports-locaux',
    'versions-techno',
    'metriques-readme',
  ];
  for (const fait of ATTENDUS) {
    if (!faitsVerifies.has(fait)) {
      erreur(
        'balayage',
        `le fait « ${fait} » n’a été confronté à AUCUNE source : sa vérification s’est interrompue.`,
        'un fait non vérifié ne doit jamais se lire comme un fait juste.',
      );
    }
  }

  return { documents: documents.length, attendus: ATTENDUS.length };
}

/** Affiche les constats et fixe le code de sortie. */
function conclure({ documents, attendus }) {
  console.log(
    `  ${documents} documents balayés, ${faitsVerifies.size}/${attendus} faits confrontés à leur source, ` +
      `${EXCEPTIONS.length} exceptions déclarées.\n`,
  );
  for (const c of erreurs) {
    console.log(`  ERREUR [${c.portee}] ${c.message}`);
    if (c.remede !== undefined) console.log(`    → ${c.remede}`);
  }
  for (const c of avertissements) {
    console.log(`  AVERTISSEMENT [${c.portee}] ${c.message}`);
    if (c.remede !== undefined) console.log(`    → ${c.remede}`);
  }
  console.log(
    `\n  ${erreurs.length} erreur(s), ${avertissements.length} avertissement(s).`,
  );
  process.exitCode = erreurs.length > 0 ? 1 : 0;
}

/**
 * Les sondes : un fait par sonde, parce qu'une porte à cinq faits peut mordre
 * sur l'un et être aveugle sur les trois autres. Deux d'entre elles ont
 * d'ailleurs trouvé un angle mort réel à leur premier passage (LE-18, LE-19).
 *
 * @type {{ nom: string, fichier: string, abimer: (texte: string) => string, attendu: RegExp }[]}
 */
const SONDES = [
  {
    nom: 'version citée ≠ version coupée',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(/version `\d+\.\d+\.\d+`/, 'version `0.8.0`'),
    attendu: /version citée .* ≠ version coupée/i,
  },
  {
    nom: 'projet absent de l’arborescence',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace('planification/, notifications/', 'planification/'),
    attendu: /n’apparaît pas dans l’arborescence/i,
  },
  {
    nom: 'port fantôme',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace('localhost:3006/api/health', 'localhost:3009/api/health'),
    attendu: /la pile locale ne le publie pas/i,
  },
  {
    nom: 'version de techno périmée',
    fichier: 'README.md',
    abimer: (texte) => texte.replace('React 19 + Vite 8', 'React 18 + Vite 8'),
    attendu: /« React 18 »/i,
  },
  // Fait 5 — une sonde par chiffre du tableau de métriques : chacun a été, un
  // jour, le seul chiffre faux d'un tableau par ailleurs juste.
  {
    nom: 'compte de tests périmé',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(
        /(Unit & integration test files +\| )\*\*\d+\*\*/,
        '$1**240**',
      ),
    attendu: /fichiers de tests unitaires et d’intégration : 240 cité/,
  },
  {
    nom: 'détail par suffixe périmé',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(/\d+ React component/, '1 React component'),
    attendu: /fichiers `\*\.test\.tsx` : 1 cité/,
  },
  {
    nom: 'specs Playwright périmées',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(/(real stack\) \| )\*\*\d+\*\*/, '$1**20**'),
    attendu: /specs E2E Playwright : 20 cité/,
  },
  {
    nom: 'specs E2E d’API disparues',
    fichier: 'README.md',
    abimer: (texte) => texte.replace(/, plus \d+ API end-to-end specs/, ''),
    attendu: /specs E2E d’API : le compte a disparu/,
  },
  {
    nom: 'contrats Pact périmés',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(/(drift-checked every PR \| )\*\*\d+\*\*/, '$1**4**'),
    attendu: /contrats Pact : 4 cité/,
  },
  {
    nom: 'portes périmées (tableau)',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(/(every pull request \| )\*\*\d+\*\*/, '$1**18**'),
    attendu: /portes bloquantes : 18 cité/,
  },
  {
    nom: 'portes périmées (prose)',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(/runs \*\*\d+ bespoke/, 'runs **18 bespoke'),
    attendu: /portes \(prose de « Quality gates »\) : 18 cité/,
  },
  {
    nom: 'projets Nx périmés',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(
        /\((\d+) applications \+ \d+ libraries\)/,
        '($1 applications + 13 libraries)',
      ),
    attendu: /bibliothèques Nx : 13 cité/,
  },
  {
    nom: 'ADR périmés (tableau)',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(
        /(Architecture Decision Records +\| )\*\*\d+\*\*/,
        '$1**8**',
      ),
    attendu: /ADR : 8 cité/,
  },
  {
    nom: 'ADR périmés (prose en toutes lettres)',
    fichier: 'README.md',
    abimer: (texte) =>
      texte.replace(/^[A-Z][a-z]+ ADRs record/m, 'Eight ADRs record'),
    attendu: /ADR \(prose de « Architecture decisions »\) : 8 cité/,
  },
  {
    nom: 'ligne de métrique disparue',
    fichier: 'README.md',
    // `[^\n]*` et non `.*` : en CRLF, `.` n'avale pas le `\r` et la sonde
    // perdrait sa cible sur un poste Windows.
    abimer: (texte) =>
      texte.replace(/^\| Consumer-driven contracts[^\n]*\n/m, ''),
    attendu: /ligne de métrique introuvable \(Consumer-driven contracts\)/,
  },
];

if (process.argv.includes('--autotest')) {
  process.exitCode = autotest();
} else {
  console.log('Faits de la documentation confrontés à leurs sources');
  conclure(executer());
}

/** Rejoue les sondes ; rend 0 si toutes mordent et si le témoin est vert. */
function autotest() {
  const surDisque = lecteur;
  let echecs = 0;

  executer();
  if (erreurs.length > 0) {
    console.error(
      `❌ témoin : l’état réel lève déjà ${erreurs.length} constat(s) — les sondes ne prouveraient rien.`,
    );
    echecs += 1;
  }

  for (const sonde of SONDES) {
    const origine = surDisque(sonde.fichier);
    if (origine === null) {
      console.error(
        `❌ sonde « ${sonde.nom} » : ${sonde.fichier} illisible — la sonde a perdu sa cible.`,
      );
      echecs += 1;
      continue;
    }
    const abime = sonde.abimer(origine);
    if (abime === origine) {
      console.error(
        `❌ sonde « ${sonde.nom} » : la mutation n’a rien changé — la ligne visée a bougé.`,
      );
      echecs += 1;
      continue;
    }
    lecteur = (relatif) =>
      relatif === sonde.fichier ? abime : surDisque(relatif);
    executer();
    lecteur = surDisque;
    if (erreurs.some((constat) => sonde.attendu.test(constat.message))) {
      console.log(`✅ sonde « ${sonde.nom} » — la porte mord.`);
    } else {
      console.error(
        `❌ sonde « ${sonde.nom} » : aucun constat attendu — la porte ne mord pas.`,
      );
      echecs += 1;
    }
  }

  console.log(`\n${SONDES.length} sonde(s) rejouée(s), ${echecs} échec(s).`);
  return echecs === 0 ? 0 : 1;
}
