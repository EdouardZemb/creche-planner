#!/usr/bin/env node
// @ts-check
/**
 * Porte de la **configuration d'environnement** (`AM-44`, lot 5 des standards).
 *
 * ## Pourquoi ce script existe
 *
 * Depuis le lot 5, chaque application déclare dans son `config.ts` un objet
 * `CHAMPS_ENV` qui **est** l'inventaire des variables qu'elle lit. Cet inventaire
 * n'a de valeur que s'il est complet et s'il correspond à ce que la pile pose
 * réellement — or les deux moitiés vivent dans des fichiers qui ne peuvent pas se
 * lire l'un l'autre : du TypeScript compilé dans un bundle d'un côté, du YAML de
 * Compose de l'autre.
 *
 * Deux dérives, toutes deux **muettes**, en découlent :
 *
 *  - un compose qui pose une variable que **personne ne lit** (renommage, faute
 *    de frappe, réglage devenu inutile) : le service démarre, le réglage n'a
 *    simplement aucun effet. C'est ainsi que `INTERSERVICE_AUTHZ_ENFORCE` était
 *    posée sur `api-gateway`, qui **signe** les assertions et ne les vérifie
 *    jamais ;
 *  - une lecture de `process.env` faite **hors** du `config.ts` : elle échappe à
 *    la validation, donc au refus de démarrage, et rouvre exactement la
 *    divergence de lecture qui a produit `AN-20`.
 *
 * ## Ce que la porte garantit
 *
 * 1. Aucune **mention** de `process.env` dans le code applicatif
 *    (`apps/<app>/src/**` de **toutes** les apps, `web` inclus) en dehors du
 *    `config.ts` de l'app — sauf exemption **déclarée avec son motif** ci-dessous.
 *    Y compris les mentions qui ne nomment aucune clé (`const env = process.env`),
 *    qu'aucune exemption ne couvre.
 * 2. Toute variable posée par un `docker-compose*.yml` sur un service
 *    applicatif est **déclarée** dans le `CHAMPS_ENV` de ce service (attendu
 *    dérivé des composes ET des `config.ts`, jamais recopié), exception faite
 *    des variables consommées par une **bibliothèque** (OTel, pino).
 * 3. Toute variable déclarée que les composes de **production** ne posent pas
 *    **sur ce service** figure au registre des « défauts de code assumés », avec
 *    son motif. Le décompte est **par service** : une union globale ne verrait pas
 *    le cas qui coûte — un service qui perd `ASSERTION_IDENTITE_SECRET` retombe en
 *    mode legacy, vérification d'identité inactive, et son absence est une valeur
 *    licite que rien d'autre ne signale. Une entrée du registre devenue fausse —
 *    variable disparue du schéma, **ou** désormais posée en production — est
 *    signalée à son tour.
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - Elle ne valide aucune **valeur** : c'est le rôle de `lireEnv` au démarrage,
 *    et des `config.spec.ts` qui l'éprouvent.
 *  - Elle ne prouve pas qu'un environnement invalide **refuse** le démarrage :
 *    seuls les tests E2E `refus-config.e2e.spec.ts` le montrent, sur le bundle
 *    réel (`LE-39`).
 *  - Elle lit le **texte** des composes, pas la spécification **fusionnée** que
 *    rend `docker compose config` : ni la substitution `${VAR:?}`, ni un
 *    `env_file:`, ni l'ordre des surcharges, ni aucune **valeur** (`EM-12`).
 *  - Elle ne dit rien des fichiers d'outillage hors `src/` (`drizzle.config.ts`
 *    lit `DATABASE_URL` pour générer des migrations), des scripts de `scripts/`,
 *    ni des **bibliothèques** (`libs/**`), qui lisent leur propre environnement
 *    (`LOG_LEVEL`, `OTEL_*` — `AM-72`).
 *  - Elle ne juge pas si une bascule **devrait** être fermée : `AM-30` reste
 *    ouverte, et fermer une bascule est un geste d'exploitation, pas de code.
 *  - Elle ignore `.env.server.example` : ce fichier documente les valeurs à
 *    poser, il ne décrit pas ce que le code lit — et personne ne le garde
 *    (`AM-71`).
 *
 * ## Usage
 *   pnpm environnement              # vérifie (exit 1 si un constat)
 *   pnpm environnement --autotest   # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : un balayage qui ne trouve rien ÉCHOUE.
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une
 *    lecture (règle CodeQL `js/file-system-race`, bloquante en CI).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');

/** Composes balayés, dans l'ordre où Compose les fusionne. */
const COMPOSES = [
  'docker-compose.yml',
  'docker-compose.override.yml',
  'docker-compose.server.yml',
  'docker-compose.staging.yml',
];

/**
 * Ceux que la **production** charge (`deploy.mjs` : `-f docker-compose.yml -f
 * docker-compose.server.yml`). L'override de développement est chargé
 * automatiquement en local et en CI, **jamais** en production : une variable qu'il
 * est seul à poser n'a donc pas de valeur en prod, et c'est le défaut du code qui
 * fait foi là-bas (vérification n° 3).
 */
const COMPOSES_DE_PRODUCTION = [
  'docker-compose.yml',
  'docker-compose.server.yml',
];

/**
 * Fragments de déclaration partagés, repris par `...NOM` dans un `CHAMPS_ENV`.
 * Le fichier est lu, pas recopié : la porte suit un renommage de variable.
 */
const FRAGMENTS = {
  CHAMPS_ASSERTION:
    'libs/nest-commons/src/lib/security/assertion-identite.options.ts',
};

/**
 * Variables lues par une **bibliothèque** et non par notre code : elles sont
 * légitimement posées par les composes sans figurer dans un `CHAMPS_ENV`.
 */
const VARIABLES_DE_BIBLIOTHEQUE = [
  // SDK OpenTelemetry (`@opentelemetry/*`) : lit son endpoint et son nom de
  // service lui-même, avant tout code applicatif.
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_SDK_DISABLED',
  // `libs/observability` (pino) : niveau et format des journaux.
  'LOG_LEVEL',
  'LOG_PRETTY',
  // Lue par la trousse elle-même (`champEnv.environnement`), donc déclarée pour
  // les six apps sans qu'aucune ait à l'écrire.
  'NODE_ENV',
];

/**
 * Retire la ligne `VARIABLE:` du bloc `environment:` d'un service donné. Sert aux
 * sondes : c'est la mutation qui reproduit « un service perd une variable que ses
 * voisins gardent ».
 *
 * @param {string} contenu
 * @param {string} service
 * @param {string} variable
 */
function retirerDuBloc(contenu, service, variable) {
  /** @type {string[]} */
  const sortie = [];
  let courant = null;
  for (const ligne of contenu.split('\n')) {
    const debut = /^ {2}([a-zA-Z0-9_.-]+):[ \t]*\r?$/.exec(ligne);
    if (debut !== null) {
      courant = debut[1];
    }
    if (courant === service && new RegExp(`^ {6}${variable}:`).test(ligne)) {
      continue;
    }
    sortie.push(ligne);
  }
  return sortie.join('\n');
}

/**
 * Lectures de `process.env` **hors** `config.ts` tolérées, avec leur motif. Une
 * exemption sans motif n'existe pas : c'est ce qui distingue une frontière
 * assumée d'un oubli.
 */
const LECTURES_EXEMPTEES = [
  {
    fichier: 'src/tracing.ts',
    variables: ['OTEL_SERVICE_NAME'],
    motif:
      "l'instrumentation OTel s'installe au PREMIER import du processus, avant " +
      "que le schéma d'environnement n'existe ; la variable est de toute façon " +
      'consommée par le SDK lui-même.',
  },
];

/**
 * Variables déclarées qu'aucun compose ne pose : leur valeur de production est
 * le **défaut écrit dans le code**. Chaque entrée est une décision, pas un
 * oubli — et la porte refuse qu'une nouvelle s'y ajoute sans un motif.
 */
const DEFAUTS_DE_CODE_ASSUMES = [
  {
    variable: 'GATEWAY_TOKEN',
    app: 'api-gateway',
    motif:
      'VOLONTAIREMENT non posée (ligne commentée dans docker-compose.server.yml) : ' +
      "la gateway n'est pas joignable depuis le LAN, un jeton côté SPA fuiterait " +
      "dans le bundle JS sans gain réseau. L'absence est rendue explicite par " +
      'GATEWAY_AUTH_DISABLED=1 (AQ-01, doc 24).',
  },
  {
    variable: 'RATE_LIMIT_FENETRE_MS',
    app: 'api-gateway',
    motif:
      'la fenêtre de 60 s du code est la valeur de prod ; seul le débit ' +
      '(RATE_LIMIT_MAX) diffère entre la pile locale et le serveur.',
  },
  {
    variable: 'SMTP_HOST',
    app: 'svc-notifications',
    motif:
      'le transport de prod est celui du code (smtp.gmail.com) ; en changer ' +
      'demanderait aussi de nouveaux identifiants, donc une décision ops explicite.',
  },
  {
    variable: 'SMTP_PORT',
    app: 'svc-notifications',
    motif: 'submission STARTTLS (587), lié au transport ci-dessus.',
  },
  {
    variable: 'NOTIF_SCHEDULER_HEURE',
    app: 'svc-notifications',
    motif:
      "8 h Europe/Paris : l'heure du récap du mardi est un choix produit, pas un " +
      'réglage de déploiement.',
  },
  {
    variable: 'NOTIF_SCHEDULER_FORCER',
    app: 'svc-notifications',
    motif:
      "affordance de TEST (posée par docker-compose.override.yml pour l'e2e) : " +
      'elle ne doit exister nulle part ailleurs.',
  },
];

/** @param {string} relatif */
function lire(relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch (erreur) {
    throw new Error(
      `${relatif} illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
}

/**
 * Fichiers `.ts` de production sous un dossier (specs et artefacts exclus).
 * Parcours explicite plutôt que `glob` : zéro dépendance.
 *
 * @param {string} depuis
 * @returns {string[]}
 */
function sourcesApplicatives(depuis) {
  /** @type {string[]} */
  const trouves = [];
  /** @type {import('node:fs').Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(depuis, { withFileTypes: true });
  } catch {
    return trouves;
  }
  for (const entree of entrees) {
    const complet = path.join(depuis, entree.name);
    if (entree.isDirectory()) {
      if (
        ['node_modules', 'dist', 'out-tsc', 'test-output'].includes(entree.name)
      ) {
        continue;
      }
      trouves.push(...sourcesApplicatives(complet));
    } else if (
      entree.name.endsWith('.ts') &&
      !entree.name.includes('.spec.') &&
      !entree.name.includes('.test.') &&
      !entree.name.includes('.fixture.')
    ) {
      trouves.push(complet);
    }
  }
  return trouves;
}

/** Applications ayant un `src/config.ts` : dérivé de l'arborescence. */
function applications() {
  /** @type {string[]} */
  const apps = [];
  /** @type {import('node:fs').Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(path.join(RACINE, 'apps'), {
      withFileTypes: true,
    });
  } catch {
    return apps;
  }
  for (const entree of entrees) {
    if (!entree.isDirectory()) continue;
    try {
      fs.readFileSync(
        path.join(RACINE, 'apps', entree.name, 'src', 'config.ts'),
        'utf8',
      );
      apps.push(entree.name);
    } catch {
      // pas d'application configurable (le front `web` n'en a pas)
    }
  }
  return apps;
}

/**
 * Clés déclarées par un objet `export const NOM = { … } as const;`, spreads
 * `...FRAGMENT` résolus depuis leur fichier source.
 *
 * @param {string} contenu
 * @param {string} symbole
 * @param {Record<string, string>} fragments
 * @returns {string[] | null}
 */
function clesDeclarees(contenu, symbole, fragments) {
  const bloc = new RegExp(
    `export const ${symbole} = \\{([\\s\\S]*?)\\n\\} as const;`,
  ).exec(contenu);
  if (bloc === null) {
    return null;
  }
  const corps = bloc[1];
  const cles = [...corps.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map(
    (m) => m[1],
  );
  for (const spread of corps.matchAll(/^\s{2}\.\.\.([A-Z][A-Z0-9_]*),/gm)) {
    const source = fragments[spread[1]];
    if (source === undefined) {
      // Spread inconnu : on ne devine pas, on le signale par une clé sentinelle.
      cles.push(`?${spread[1]}`);
      continue;
    }
    const heritees = clesDeclarees(lire(source), spread[1], fragments);
    if (heritees === null) {
      cles.push(`?${spread[1]}`);
      continue;
    }
    cles.push(...heritees);
  }
  return cles;
}

/**
 * Variables posées par les composes, par service.
 *
 * Analyse ligne à ligne plutôt qu'un vrai parseur YAML (zéro dépendance) : on ne
 * cherche que les clés `MAJUSCULES:` à l'intérieur d'un bloc `environment:` d'un
 * service de premier niveau.
 *
 * @param {Record<string, string>} contenus
 * @returns {Map<string, Set<string>>}
 */
function variablesDesComposes(contenus) {
  /** @type {Map<string, Set<string>>} */
  const parService = new Map();
  for (const contenu of Object.values(contenus)) {
    let service = null;
    let dansEnv = false;
    for (const ligne of contenu.split(/\r?\n/)) {
      const debutService = /^ {2}([a-zA-Z0-9_.-]+):\s*$/.exec(ligne);
      if (debutService !== null) {
        service = debutService[1];
        dansEnv = false;
        continue;
      }
      if (/^ {4}environment:\s*$/.test(ligne)) {
        dansEnv = true;
        continue;
      }
      if (/^ {4}[a-zA-Z_]/.test(ligne)) {
        dansEnv = false;
      }
      if (!dansEnv || service === null) continue;
      const variable = /^ {6}([A-Z][A-Z0-9_]*):/.exec(ligne);
      if (variable !== null) {
        const vues = parService.get(service) ?? new Set();
        vues.add(variable[1]);
        parService.set(service, vues);
      }
    }
  }
  return parService;
}

/**
 * Toute mention de `process.env` dans le code applicatif, **y compris** celles
 * qui ne nomment pas de variable en clair.
 *
 * Un détecteur limité aux clés littérales laisserait passer
 * `const env = process.env; … env['GATEWAY_TOKEN']` — soit exactement la seconde
 * lecture d'`AN-20`, gate au vert. Une mention sans clé littérale est donc
 * rapportée avec la variable `(accès indirect)`, qu'aucune exemption ne couvre :
 * une app qui a besoin de l'objet entier passe par sa déclaration.
 *
 * Le balayage porte sur `apps/<app>/src` de **toutes** les applications, y compris
 * celles qui n'ont pas de `config.ts` (le front `web`) : là, toute mention est un
 * constat.
 *
 * @returns {{ fichier: string, variable: string }[]}
 */
function lecturesDirectes() {
  /** @type {{ fichier: string, variable: string }[]} */
  const lectures = [];
  /** @type {import('node:fs').Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(path.join(RACINE, 'apps'), {
      withFileTypes: true,
    });
  } catch {
    return lectures;
  }
  for (const entree of entrees) {
    if (!entree.isDirectory()) continue;
    for (const fichier of sourcesApplicatives(
      path.join(RACINE, 'apps', entree.name, 'src'),
    )) {
      let source;
      try {
        source = fs.readFileSync(fichier, 'utf8');
      } catch {
        continue;
      }
      const relatif = path.relative(RACINE, fichier).replaceAll('\\', '/');
      for (const trouve of source.matchAll(
        /process\.env(?:\[\s*'([A-Z][A-Z0-9_]*)'\s*\]|\.([A-Z][A-Z0-9_]*))?/g,
      )) {
        lectures.push({
          fichier: relatif,
          variable: trouve[1] ?? trouve[2] ?? '(accès indirect)',
        });
      }
    }
  }
  return lectures;
}

/**
 * @param {Record<string, string>} composes
 * @param {Record<string, string>} configs
 * @param {{ fichier: string, variable: string }[]} lectures
 * @returns {string[]}
 */
function verifier(composes, configs, lectures) {
  /** @type {string[]} */
  const constats = [];

  // Déclarations, par app.
  /** @type {Map<string, string[]>} */
  const declarees = new Map();
  for (const [app, contenu] of Object.entries(configs)) {
    const cles = clesDeclarees(contenu, 'CHAMPS_ENV', FRAGMENTS);
    if (cles === null || cles.length === 0) {
      constats.push(
        `apps/${app}/src/config.ts : \`CHAMPS_ENV\` introuvable ou vide — l'inventaire des variables de cette app n'existe plus, la porte ne peut rien comparer`,
      );
      continue;
    }
    const inconnues = cles.filter((c) => c.startsWith('?'));
    if (inconnues.length > 0) {
      constats.push(
        `apps/${app}/src/config.ts : fragment partagé \`${inconnues.map((c) => c.slice(1)).join(', ')}\` non résolu — l'ajouter au registre \`FRAGMENTS\` de ce script`,
      );
    }
    declarees.set(
      app,
      cles.filter((c) => !c.startsWith('?')),
    );
  }
  if (declarees.size === 0) {
    constats.push(
      "aucune application configurable trouvée sous apps/ : le balayage ne mord plus (le nom de `CHAMPS_ENV` ou l'arborescence a changé ?)",
    );
    return constats;
  }

  // 1. Aucune lecture de `process.env` hors du config.ts de l'app.
  if (lectures.length === 0) {
    constats.push(
      'aucune lecture de `process.env` trouvée dans apps/*/src : le balayage ne mord plus (motif changé ?)',
    );
  }
  for (const { fichier, variable } of lectures) {
    if (/\/src\/config\.ts$/.test(fichier)) continue;
    const exemptee = LECTURES_EXEMPTEES.some(
      (e) => fichier.endsWith(e.fichier) && e.variables.includes(variable),
    );
    if (!exemptee) {
      constats.push(
        `${fichier} lit \`${variable}\` directement : cette lecture échappe au schéma, donc au refus de démarrage (c'est la divergence de lecture d'AN-20). La déclarer dans le \`CHAMPS_ENV\` de l'app, ou l'exempter avec son motif dans ce script`,
      );
    }
  }

  // 2. Toute variable posée par un compose est déclarée par l'app visée.
  const posees = variablesDesComposes(composes);
  let servicesApplicatifsVus = 0;
  for (const [service, variables] of posees) {
    const cles = declarees.get(service);
    if (cles === undefined) continue; // service non applicatif (bases, proxy…)
    servicesApplicatifsVus += 1;
    for (const variable of [...variables].sort()) {
      if (VARIABLES_DE_BIBLIOTHEQUE.includes(variable)) continue;
      if (!cles.includes(variable)) {
        constats.push(
          `les composes posent \`${variable}\` sur \`${service}\`, qui ne la lit pas (absente de son \`CHAMPS_ENV\`) : réglage inerte — le retirer, ou le déclarer si l'app doit en tenir compte`,
        );
      }
    }
  }
  if (servicesApplicatifsVus === 0) {
    constats.push(
      'aucun bloc `environment:` de service applicatif trouvé dans les composes : le balayage ne mord plus (indentation ou nommage changé ?)',
    );
  }

  // 3. Une variable déclarée que le déploiement de PRODUCTION ne pose pas sur CE
  // service est une décision écrite.
  //
  // Deux précisions qui font toute la valeur de cette vérification :
  //  - le décompte est **par service**. Une union globale rendrait la porte
  //    aveugle au cas qui compte : retirer `ASSERTION_IDENTITE_SECRET` du bloc
  //    d'un seul service le fait retomber en mode legacy (vérification d'identité
  //    inactive) sans qu'aucune autre garde ne le voie, puisque son absence est
  //    une valeur licite ;
  //  - seuls les composes de **production** comptent. Une variable que seul
  //    l'override de développement pose (`NOTIF_SCHEDULER_FORCER`) n'a aucune
  //    valeur en prod : c'est bien le défaut du code qui y fait foi.
  const poseesEnProduction = variablesDesComposes(
    Object.fromEntries(
      Object.entries(composes).filter(([fichier]) =>
        COMPOSES_DE_PRODUCTION.includes(fichier),
      ),
    ),
  );
  for (const [app, cles] of declarees) {
    const posesDuService = poseesEnProduction.get(app) ?? new Set();
    for (const variable of cles) {
      if (VARIABLES_DE_BIBLIOTHEQUE.includes(variable)) continue;
      if (posesDuService.has(variable)) continue;
      const assumee = DEFAUTS_DE_CODE_ASSUMES.some(
        (d) => d.variable === variable && d.app === app,
      );
      if (!assumee) {
        constats.push(
          `\`${variable}\` est déclarée par \`${app}\` mais posée par AUCUN compose de production sur ce service : sa valeur de production est le défaut écrit dans le code. Si c'est voulu, l'inscrire avec son motif dans \`DEFAUTS_DE_CODE_ASSUMES\` ; sinon, la poser`,
        );
      }
    }
  }

  // 3 bis. Le registre lui-même ne se périme pas en silence — dans les DEUX sens :
  // une entrée qui cite une variable disparue du schéma, et une entrée devenue
  // fausse parce qu'un compose de production pose désormais la variable (son motif
  // parlerait alors d'un défaut qui ne s'applique plus).
  for (const { variable, app } of DEFAUTS_DE_CODE_ASSUMES) {
    const cles = declarees.get(app);
    if (cles === undefined) {
      constats.push(
        `\`DEFAUTS_DE_CODE_ASSUMES\` cite l'app \`${app}\`, qui n'a pas de \`CHAMPS_ENV\` : entrée périmée`,
      );
      continue;
    }
    if (!cles.includes(variable)) {
      constats.push(
        `\`DEFAUTS_DE_CODE_ASSUMES\` cite \`${variable}\` pour \`${app}\`, qui ne la déclare plus : entrée périmée, la retirer`,
      );
      continue;
    }
    if ((poseesEnProduction.get(app) ?? new Set()).has(variable)) {
      constats.push(
        `\`DEFAUTS_DE_CODE_ASSUMES\` dit que \`${variable}\` n'est posée par aucun compose de production, mais \`${app}\` la reçoit : entrée devenue fausse, la retirer (son motif décrit un défaut qui ne s'applique plus)`,
      );
    }
  }

  return constats;
}

/**
 * Sondes négatives. Chacune **dérive** sa mutation des fichiers réels : trois
 * sondes de ce dépôt écrites sur un littéral ont cessé de mordre en silence
 * (`LE-22`, `LE-33`).
 *
 * @param {Record<string, string>} composes
 * @param {Record<string, string>} configs
 * @param {{ fichier: string, variable: string }[]} lectures
 */
function autotest(composes, configs, lectures) {
  const appTemoin = Object.keys(configs)[0];
  const clesTemoin = clesDeclarees(configs[appTemoin], 'CHAMPS_ENV', FRAGMENTS);
  if (appTemoin === undefined || clesTemoin === null) {
    console.error('Sonde impossible : aucune déclaration lisible.');
    return 1;
  }

  /**
   * Mutation d'un fichier réel, avec **garde** : une mutation qui ne change rien
   * fait échouer la sonde ici, au lieu de laisser la porte « ne pas mordre » sur
   * un fichier intact et d'accuser la porte.
   *
   * Ce n'est pas une précaution théorique : la sonde (b) ci-dessous a d'abord
   * cherché une fin de ligne en `\n` littéral dans un compose que l'arbre de
   * travail tient en **CRLF** (`core.autocrlf` sous Windows). Elle ne remplaçait
   * rien, la porte voyait le fichier d'origine, et le verdict affiché accusait la
   * porte de ne plus mordre.
   *
   * @param {string} source
   * @param {(texte: string) => string} transformation
   * @param {string} etiquette
   */
  function muter(source, transformation, etiquette) {
    const mute = transformation(source);
    if (mute === source) {
      throw new Error(
        `sonde « ${etiquette} » : la mutation n'a RIEN changé — la sonde est périmée (motif introuvable dans le fichier réel), pas la porte.`,
      );
    }
    return mute;
  }

  /** @type {{ nom: string, constats: string[], attendu: string }[]} */
  const sondes = [];

  // (a) une lecture sauvage de process.env apparaît hors du config.ts.
  sondes.push({
    nom: 'lecture directe hors config.ts',
    constats: verifier(composes, configs, [
      ...lectures,
      { fichier: 'apps/sonde/src/service.ts', variable: 'UNE_VARIABLE' },
    ]),
    attendu: 'échappe au schéma',
  });

  // (b) un compose pose une variable que l'app ne déclare pas. La fin de ligne se
  // cherche en `\r?\n` : l'arbre de travail est en CRLF sous Windows.
  sondes.push({
    nom: 'variable de compose non déclarée',
    constats: verifier(
      {
        ...composes,
        'docker-compose.yml': muter(
          composes['docker-compose.yml'],
          (texte) =>
            texte.replace(
              new RegExp(`^ {2}${appTemoin}:[ \\t]*\r?\n`, 'm'),
              `  ${appTemoin}:\n    environment:\n      VARIABLE_INERTE: 'x'\n`,
            ),
          'variable de compose non déclarée',
        ),
      },
      configs,
      lectures,
    ),
    attendu: 'VARIABLE_INERTE',
  });

  // (c) une variable posée disparaît de la déclaration de l'app.
  const sondePosees = variablesDesComposes(composes);
  const posee = [...(sondePosees.get(appTemoin) ?? [])].find((v) =>
    clesTemoin.includes(v),
  );
  sondes.push({
    nom: 'variable retirée du schéma alors qu’un compose la pose',
    constats:
      posee === undefined
        ? []
        : verifier(
            composes,
            {
              ...configs,
              [appTemoin]: muter(
                configs[appTemoin],
                (texte) =>
                  texte.replace(new RegExp(`^ {2}${posee}:.*$`, 'm'), ''),
                'variable retirée du schéma',
              ),
            },
            lectures,
          ),
    attendu: posee === undefined ? 'sonde impossible' : posee,
  });

  // (d) la déclaration gagne une variable que nul compose ne pose.
  sondes.push({
    nom: 'variable déclarée sans ligne de compose ni motif',
    constats: verifier(
      composes,
      {
        ...configs,
        [appTemoin]: muter(
          configs[appTemoin],
          (texte) =>
            texte.replace(
              'export const CHAMPS_ENV = {',
              "export const CHAMPS_ENV = {\n  VARIABLE_ORPHELINE: champEnv.texte(''),",
            ),
          'variable déclarée sans ligne de compose',
        ),
      },
      lectures,
    ),
    attendu: 'VARIABLE_ORPHELINE',
  });

  // (e) l'inventaire disparaît : la porte ne conclut pas « tout va bien ».
  sondes.push({
    nom: 'inventaire CHAMPS_ENV disparu',
    constats: verifier(
      composes,
      {
        ...configs,
        [appTemoin]: muter(
          configs[appTemoin],
          (texte) =>
            texte.replaceAll('export const CHAMPS_ENV', 'const CHAMPS_LOCAUX'),
          'inventaire disparu',
        ),
      },
      lectures,
    ),
    attendu: 'introuvable ou vide',
  });

  // (g) un accès INDIRECT à process.env hors config.ts (`const env = process.env`),
  // qui est la forme sous laquelle AN-20 pourrait renaître sans nommer de clé.
  sondes.push({
    nom: 'alias de process.env hors config.ts',
    constats: verifier(composes, configs, [
      ...lectures,
      { fichier: 'apps/sonde/src/service.ts', variable: '(accès indirect)' },
    ]),
    attendu: '(accès indirect)',
  });

  // (h) une variable partagée disparaît du bloc d'UN SEUL service. Le décompte
  // global ne le verrait pas — or c'est le cas qui coûte : un service qui perd
  // `ASSERTION_IDENTITE_SECRET` retombe en mode legacy, et son absence est licite.
  const partagee = [...(sondePosees.get(appTemoin) ?? [])].find(
    (v) =>
      clesTemoin.includes(v) &&
      [...sondePosees.values()].filter((s) => s.has(v)).length > 1,
  );
  sondes.push({
    nom: 'variable partagée retirée du bloc d’un seul service',
    constats:
      partagee === undefined
        ? []
        : verifier(
            Object.fromEntries(
              Object.entries(composes).map(([fichier, contenu]) => [
                fichier,
                retirerDuBloc(contenu, appTemoin, partagee),
              ]),
            ),
            configs,
            lectures,
          ),
    attendu: partagee === undefined ? 'sonde impossible' : partagee,
  });

  // (i) le registre des défauts assumés devient faux : la variable est désormais
  // posée en production.
  const assumee = DEFAUTS_DE_CODE_ASSUMES[0];
  sondes.push({
    nom: 'registre des défauts assumés devenu faux',
    constats: verifier(
      {
        ...composes,
        'docker-compose.server.yml': muter(
          composes['docker-compose.server.yml'],
          (texte) =>
            texte.replace(
              new RegExp(`^ {2}${assumee.app}:[ \\t]*\r?\n`, 'm'),
              `  ${assumee.app}:\n    environment:\n      ${assumee.variable}: 'x'\n`,
            ),
          'registre devenu faux',
        ),
      },
      configs,
      lectures,
    ),
    attendu: 'entrée devenue fausse',
  });

  // (f) un fragment partagé est renommé sans être déclaré au registre.
  sondes.push({
    nom: 'fragment partagé inconnu',
    constats: verifier(
      composes,
      {
        ...configs,
        [appTemoin]: muter(
          configs[appTemoin],
          (texte) =>
            texte.replace(
              'export const CHAMPS_ENV = {',
              'export const CHAMPS_ENV = {\n  ...CHAMPS_INCONNUS,',
            ),
          'fragment partagé inconnu',
        ),
      },
      lectures,
    ),
    attendu: 'CHAMPS_INCONNUS',
  });

  let echecs = 0;
  for (const sonde of sondes) {
    const mord = sonde.constats.some((c) => c.includes(sonde.attendu));
    if (mord) {
      console.log(`Sonde « ${sonde.nom} » : la porte mord. ✅`);
    } else {
      echecs += 1;
      console.error(
        `Sonde « ${sonde.nom} » : la porte n'a RIEN vu (attendu : ${sonde.attendu}). Elle ne mord plus.`,
      );
    }
  }
  return echecs === 0 ? 0 : 1;
}

function principal() {
  /** @type {Record<string, string>} */
  const composes = {};
  for (const fichier of COMPOSES) {
    composes[fichier] = lire(fichier);
  }
  /** @type {Record<string, string>} */
  const configs = {};
  for (const app of applications()) {
    configs[app] = lire(`apps/${app}/src/config.ts`);
  }
  const lectures = lecturesDirectes();

  if (process.argv.includes('--autotest')) {
    return autotest(composes, configs, lectures);
  }

  const constats = verifier(composes, configs, lectures);
  if (constats.length > 0) {
    console.error(
      `Configuration d'environnement — ${constats.length} constat(s) :`,
    );
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }

  const total = Object.entries(configs).reduce(
    (n, [, contenu]) =>
      n + (clesDeclarees(contenu, 'CHAMPS_ENV', FRAGMENTS)?.length ?? 0),
    0,
  );
  console.log(
    `Configuration d'environnement : ${Object.keys(configs).length} application(s), ` +
      `${total} variable(s) déclarée(s), ${lectures.length} lecture(s) de process.env ` +
      `(toutes dans un config.ts ou exemptées), aucun réglage de compose inerte.`,
  );
  return 0;
}

process.exitCode = principal();
