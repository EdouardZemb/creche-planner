#!/usr/bin/env node
// @ts-check
/**
 * Confronte les FAITS que la documentation énonce aux sources qui les
 * produisent : version coupée, projets Nx, ports publiés par la pile locale,
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
    fichier: 'docs/34-politique-documentation.md',
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

/** Lit un fichier texte, ou rend `null` s'il est absent/illisible. */
function lireTexte(relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
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

function main() {
  const documents = [
    ...DOCUMENTS_RACINE,
    ...REPERTOIRES.flatMap((r) => lister(r, (nom) => nom.endsWith('.md'))),
  ];

  console.log('Faits de la documentation confrontés à leurs sources');

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
  }

  const ATTENDUS = [
    'version-coupee',
    'projets-nx',
    'ports-locaux',
    'versions-techno',
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

  console.log(
    `  ${documents.length} documents balayés, ${faitsVerifies.size}/${ATTENDUS.length} faits confrontés à leur source, ` +
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

main();
