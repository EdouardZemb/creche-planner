#!/usr/bin/env node
// @ts-check
/**
 * Porte de complétude de la **piste d'audit acteur**
 * (`docs/37-registre-des-traitements.md` §7 ; lot 6 du plan standards, `AM-45`).
 *
 * ## Pourquoi ce script existe
 *
 * Une piste d'audit se périme exactement comme l'export de portabilité, et pour la
 * même raison : **elle ne casse pas**. On ajoute une route de mutation, elle n'écrit
 * aucune ligne, et rien ne le dit — la piste continue de répondre, cohérente,
 * simplement muette sur ce qui vient d'arriver. C'est `MO-1` dans sa forme la plus
 * coûteuse : un outil vert parce qu'il ne regarde pas, sur le seul artefact dont la
 * valeur est d'être **exhaustif**. Une piste trouée n'est pas une piste partielle,
 * c'est une piste qui ment par omission.
 *
 * ## Ce que la porte garantit
 *
 * 1. **Aucune route de mutation n'échappe au classement.** L'attendu est **dérivé**
 *    des `*.controller.ts` des services — chaque `@Post`/`@Put`/`@Patch`/`@Delete`
 *    doit avoir sa ligne au §7, et une ligne du §7 qui ne correspond à aucune route
 *    réelle est un fantôme (route renommée, contrôleur supprimé).
 * 2. **Une route dite `auditée` nomme une action qui existe** dans le registre
 *    d'actions de son service (`audit/journal-audit.actions.ts`), et cette action est
 *    **réellement consignée** par du code de production (sa constante est référencée
 *    hors des specs). Réciproquement, une action du registre que plus aucune ligne ne
 *    nomme est morte.
 * 3. **Une route dite `auditée` reçoit réellement son acteur** : son handler porte
 *    `@ActeurCourant()`. C'est le contrôle que le choix d'un **paramètre explicite**
 *    plutôt qu'un contexte ambiant rend possible — un `AsyncLocalStorage` ne se
 *    constate pas de l'extérieur.
 * 4. **Une route `différée` nomme une piste OUVERTE** du registre (doc 34 §2). Le
 *    jour où cette piste est close, la porte refuse la ligne : on ne peut pas solder
 *    la piste d'un service sans auditer ses routes ou re-motiver leur report.
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - Elle ne juge pas le **classement** : décider qu'une route est hors périmètre
 *    reste une lecture humaine, inscrite au §7 avec son motif.
 *  - Elle ne prouve pas que la ligne d'audit est écrite **dans la transaction** de la
 *    mutation, ni qu'elle porte la bonne cible : c'est le rôle des specs de service
 *    (`foyer.service.spec.ts`, section « piste d'audit acteur »).
 *  - Elle ne voit que les routes servies par un **contrôleur Nest**. Une mutation
 *    déclenchée par un consommateur d'événement ou une tâche périodique lui échappe —
 *    par construction, ces chemins n'ont pas d'acteur humain.
 *  - Elle ne dit rien de l'**intégrité** de la piste : la table n'est pas signée, un
 *    accès direct à la base peut la réécrire (§7, limite n° 3).
 *
 * ## Usage
 *   pnpm acteur              # vérifie (exit 1 si un constat)
 *   pnpm acteur --autotest   # rejoue les sondes négatives (exit 1 si la porte ne mord pas)
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : un balayage sans route ÉCHOUE, au lieu de
 *    rendre « rien à signaler ».
 *  - Toute mutation de sonde passe par `muter()`, qui **lève si le texte est
 *    inchangé** : une sonde écrite sur un `\n` littéral ne remplace rien dans un
 *    fichier CRLF, et accuserait la porte au lieu de la prouver (`LE-42`).
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une
 *    lecture (fenêtre TOCTOU refusée par la règle CodeQL `js/file-system-race`).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const REGISTRE = 'docs/37-registre-des-traitements.md';
const REGISTRE_AM = 'docs/34-registre-ameliorations.md';
const TITRE_SECTION = "## 7. Ce que la piste d'audit trace";

const CLASSE_AUDITEE = 'auditée';
const CLASSE_JOURNAL = 'journal seul';
const CLASSE_DIFFEREE = 'différée';
const CLASSES = new Set([
  CLASSE_AUDITEE,
  CLASSE_JOURNAL,
  CLASSE_DIFFEREE,
  'exemptée',
  'hors périmètre',
]);

/** Statuts du registre (doc 34 §1.2) qui valent « encore ouverte ». */
const STATUTS_OUVERTS = new Set(['🔄', '⏸']);

/** Verbes HTTP qui **mutent**. `@Get` est hors sujet : il ne change rien. */
const VERBES_MUTATION = ['Post', 'Put', 'Patch', 'Delete'];

/**
 * Rend l'apostrophe typographique et l'apostrophe droite interchangeables — les deux
 * cohabitent dans la documentation, et un titre de section n'a pas à devenir
 * introuvable parce qu'un formateur a changé de guillemet.
 *
 * @param {string} texte
 */
function normaliserApostrophes(texte) {
  return texte.replaceAll('’', "'");
}

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

/** @param {string} relatif */
function lireSiPresent(relatif) {
  try {
    return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Tous les fichiers d'un répertoire dont le nom finit par `suffixe` (récursif).
 *
 * @param {string} racine chemin absolu
 * @param {string} suffixe
 * @returns {string[]} chemins absolus, triés
 */
function fichiers(racine, suffixe) {
  /** @type {string[]} */
  const trouves = [];
  /** @param {string} repertoire */
  const parcourir = (repertoire) => {
    /** @type {fs.Dirent[]} */
    let entrees;
    try {
      entrees = fs.readdirSync(repertoire, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entree of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
      const complet = path.join(repertoire, entree.name);
      if (entree.isDirectory()) {
        parcourir(complet);
      } else if (entree.name.endsWith(suffixe)) {
        trouves.push(complet);
      }
    }
  };
  parcourir(racine);
  return trouves;
}

/** Services applicatifs porteurs de contrôleurs (`apps/svc-*`). */
function services() {
  const apps = path.join(RACINE, 'apps');
  /** @type {fs.Dirent[]} */
  let entrees;
  try {
    entrees = fs.readdirSync(apps, { withFileTypes: true });
  } catch (erreur) {
    throw new Error(
      `apps/ illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
  return entrees
    .filter((e) => e.isDirectory() && e.name.startsWith('svc-'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Univers **dérivé** : toutes les routes de mutation déclarées par les contrôleurs
 * des services, avec le texte du handler qui les sert (pour y constater la présence
 * de `@ActeurCourant()`).
 *
 * @returns {{ service: string, verbe: string, chemin: string, handler: string }[]}
 */
function routesDesControleurs() {
  /** @type {{ service: string, verbe: string, chemin: string, handler: string }[]} */
  const routes = [];
  const verbes = [...VERBES_MUTATION, 'Get'].join('|');
  for (const service of services()) {
    for (const fichier of fichiers(
      path.join(RACINE, 'apps', service, 'src'),
      '.controller.ts',
    )) {
      const source = lireSiPresent(path.relative(RACINE, fichier));
      if (source === null) {
        continue;
      }
      const prefixe = /@Controller\(\s*'([^']*)'\s*\)/.exec(source)?.[1] ?? '';
      // Toutes les routes, verbes de lecture compris : elles bornent le handler
      // de la route précédente (une mutation suivie d'un `@Get` ne doit pas
      // « voir » les paramètres du `@Get`).
      const toutes = [
        ...source.matchAll(
          new RegExp(`@(${verbes})\\(\\s*(?:'([^']*)')?\\s*\\)`, 'g'),
        ),
      ];
      toutes.forEach((trouve, i) => {
        const verbe = trouve[1] ?? '';
        if (!VERBES_MUTATION.includes(verbe)) {
          return;
        }
        const debut = trouve.index;
        const fin = toutes[i + 1]?.index ?? source.length;
        const segments = [prefixe, trouve[2] ?? ''].filter((s) => s !== '');
        routes.push({
          service,
          verbe: verbe.toUpperCase(),
          chemin: `/${segments.join('/')}`,
          handler: source.slice(debut, fin),
        });
      });
    }
  }
  if (routes.length === 0) {
    throw new Error(
      'aucune route de mutation trouvée sous apps/svc-*/src/**/*.controller.ts — la porte ne peut rien vérifier (balayage à vide)',
    );
  }
  return routes;
}

/**
 * Registres d'actions **dérivés** des services : action → constante qui la porte, et
 * usage réel de cette constante dans le code de production (specs exclues : un test
 * peut nommer une action que la production n'écrit jamais).
 *
 * @returns {Map<string, Map<string, boolean>>} service → (action → consignée)
 */
function actionsDesServices() {
  /** @type {Map<string, Map<string, boolean>>} */
  const parService = new Map();
  for (const service of services()) {
    const registre = lireSiPresent(
      `apps/${service}/src/audit/journal-audit.actions.ts`,
    );
    if (registre === null) {
      parService.set(service, new Map());
      continue;
    }
    const production = fichiers(
      path.join(RACINE, 'apps', service, 'src'),
      '.ts',
    )
      .filter(
        (f) =>
          !f.endsWith('.spec.ts') && !f.endsWith('journal-audit.actions.ts'),
      )
      .map((f) => lireSiPresent(path.relative(RACINE, f)) ?? '')
      .join('\n');
    /** @type {Map<string, boolean>} */
    const actions = new Map();
    for (const trouve of registre.matchAll(
      /^\s*([A-Z][A-Z0-9_]*):\s*'([^']+)'/gm,
    )) {
      const constante = trouve[1] ?? '';
      actions.set(
        trouve[2] ?? '',
        new RegExp(`ACTIONS_AUDIT\\.${constante}\\b`).test(production),
      );
    }
    parService.set(service, actions);
  }
  return parService;
}

/**
 * Statuts des pistes du registre (doc 34 §2). La colonne est repérée **par son
 * en-tête**, jamais par son rang : ajouter une colonne au tableau ne doit pas rendre
 * cette porte silencieusement fausse.
 *
 * @param {string} document
 * @returns {Map<string, string>} identifiant → statut
 */
function statutsDesPistes(document) {
  /** @type {Map<string, string>} */
  const statuts = new Map();
  let rangStatut = -1;
  for (const ligne of document.split(/\r?\n/)) {
    if (!ligne.startsWith('|')) {
      continue;
    }
    const cellules = ligne
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const rang = cellules.indexOf('Statut');
    if (rang !== -1) {
      rangStatut = rang;
      continue;
    }
    const id = cellules[0] ?? '';
    if (/^AM-\d+$/.test(id) && rangStatut !== -1) {
      statuts.set(id, cellules[rangStatut] ?? '');
    }
  }
  if (statuts.size === 0) {
    throw new Error(
      `${REGISTRE_AM} : aucune piste AM-xx lue — la porte ne peut pas juger un report`,
    );
  }
  return statuts;
}

/**
 * Lit le tableau du §7 : `| Service | Route | Classe | Action / motif |`.
 *
 * @param {string} documentBrut
 * @returns {{ service: string, verbe: string, chemin: string, classe: string, motif: string }[]}
 */
function lignesDuTableau(documentBrut) {
  const document = normaliserApostrophes(documentBrut);
  const debut = document.indexOf(TITRE_SECTION);
  if (debut === -1) {
    throw new Error(`${REGISTRE} : section « ${TITRE_SECTION} » introuvable`);
  }
  const suite = document.indexOf('\n## ', debut + 1);
  const section = document.slice(debut, suite === -1 ? undefined : suite);
  /** @type {{ service: string, verbe: string, chemin: string, classe: string, motif: string }[]} */
  const lignes = [];
  for (const ligne of section.split(/\r?\n/)) {
    if (!ligne.startsWith('|')) {
      continue;
    }
    const cellules = ligne
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cellules.length < 4) {
      continue;
    }
    const [service, route, classe, motif] = cellules;
    if (service === 'Service' || /^-+$/.test(service ?? '')) {
      continue;
    }
    const decoupe = /^`([A-Z]+)\s+(\S+)`$/.exec(route ?? '');
    lignes.push({
      service: (service ?? '').replaceAll('`', ''),
      verbe: decoupe?.[1] ?? '',
      chemin: decoupe?.[2] ?? (route ?? '').replaceAll('`', ''),
      classe: classe ?? '',
      motif: motif ?? '',
    });
  }
  if (lignes.length === 0) {
    throw new Error(
      `${REGISTRE} : le tableau du §7 est vide — la porte ne peut rien vérifier`,
    );
  }
  return lignes;
}

/** @param {{service: string, verbe: string, chemin: string}} r */
function cle(r) {
  return `${r.service} ${r.verbe} ${r.chemin}`;
}

/**
 * @param {string} document §7
 * @param {string} documentAm doc 34
 * @param {ReturnType<typeof routesDesControleurs>} [routesInjectees] pour les sondes
 * @param {ReturnType<typeof actionsDesServices>} [actionsInjectees] pour les sondes
 * @returns {string[]} les constats, vide si tout va bien
 */
function verifier(document, documentAm, routesInjectees, actionsInjectees) {
  /** @type {string[]} */
  const constats = [];
  const routes = routesInjectees ?? routesDesControleurs();
  const actions = actionsInjectees ?? actionsDesServices();
  const statuts = statutsDesPistes(documentAm);
  const lignes = lignesDuTableau(document);

  const parCle = new Map(routes.map((r) => [cle(r), r]));
  /** @type {Map<string, (typeof lignes)[number]>} */
  const classees = new Map();
  for (const ligne of lignes) {
    const k = cle(ligne);
    if (classees.has(k)) {
      constats.push(`\`${k}\` : classée deux fois au §7`);
      continue;
    }
    classees.set(k, ligne);
  }

  // (1) L'attendu est dérivé des contrôleurs — dans les deux sens.
  for (const route of routes) {
    if (!classees.has(cle(route))) {
      constats.push(
        `\`${cle(route)}\` : route de mutation servie par un contrôleur mais absente du §7 — une route non classée est une mutation qui peut ne laisser aucune trace sans que rien ne le dise`,
      );
    }
  }
  for (const ligne of lignes) {
    if (!parCle.has(cle(ligne))) {
      constats.push(
        `\`${cle(ligne)}\` : ligne du §7 qui ne correspond à aucune route réelle (renommée ? contrôleur supprimé ?)`,
      );
    }
    if (!CLASSES.has(ligne.classe)) {
      constats.push(
        `\`${cle(ligne)}\` : classe « ${ligne.classe} » inconnue — attendu ${[...CLASSES].map((c) => `« ${c} »`).join(', ')}`,
      );
    }
  }

  // (2) et (3) Les routes tracées nomment une action réelle et reçoivent l'acteur.
  /** @type {Set<string>} */
  const actionsNommees = new Set();
  let traceesVerifiees = 0;
  for (const ligne of lignes) {
    if (ligne.classe !== CLASSE_AUDITEE && ligne.classe !== CLASSE_JOURNAL) {
      continue;
    }
    const route = parCle.get(cle(ligne));
    if (!route) {
      continue; // déjà signalée comme fantôme
    }
    const connues = actions.get(ligne.service) ?? new Map();
    const citees = [...ligne.motif.matchAll(/`([a-z][a-z0-9._]*)`/g)]
      .map((m) => m[1] ?? '')
      .filter((a) => a.includes('.'));
    const reelles = citees.filter((a) => connues.has(a));
    if (reelles.length === 0) {
      constats.push(
        `\`${cle(ligne)}\` : classée « ${ligne.classe} » sans nommer d'action du registre de ${ligne.service} (attendu une action entre accents graves, présente dans apps/${ligne.service}/src/audit/journal-audit.actions.ts)`,
      );
      continue;
    }
    for (const action of reelles) {
      actionsNommees.add(`${ligne.service}:${action}`);
      if (connues.get(action) !== true) {
        constats.push(
          `\`${cle(ligne)}\` : l'action \`${action}\` est déclarée au registre de ${ligne.service} mais aucun code de production ne la consigne`,
        );
      }
    }
    if (!route.handler.includes('@ActeurCourant()')) {
      constats.push(
        `\`${cle(ligne)}\` : classée « ${ligne.classe} », mais son handler ne reçoit pas \`@ActeurCourant()\` — la ligne d'audit serait écrite sans acteur`,
      );
      continue;
    }
    traceesVerifiees += 1;
  }

  // (2 bis) Une action du registre que plus aucune ligne ne nomme est morte.
  for (const [service, connues] of actions) {
    for (const action of connues.keys()) {
      if (!actionsNommees.has(`${service}:${action}`)) {
        constats.push(
          `\`${service}\` : l'action \`${action}\` est au registre d'actions mais aucune ligne du §7 ne la nomme — action morte, ou route oubliée`,
        );
      }
    }
  }

  // (4) Un report nomme une piste du registre, et cette piste est encore ouverte.
  for (const ligne of lignes) {
    if (ligne.classe !== CLASSE_DIFFEREE) {
      continue;
    }
    const piste = /`?(AM-\d+)`?/.exec(ligne.motif)?.[1];
    if (piste === undefined) {
      constats.push(
        `\`${cle(ligne)}\` : classée « ${CLASSE_DIFFEREE} » sans nommer de piste \`AM-xx\` — un report sans file est un oubli`,
      );
      continue;
    }
    const statut = statuts.get(piste);
    if (statut === undefined) {
      constats.push(
        `\`${cle(ligne)}\` : reportée sur \`${piste}\`, qui n'existe pas au §2 de ${REGISTRE_AM}`,
      );
      continue;
    }
    if (!STATUTS_OUVERTS.has(statut)) {
      constats.push(
        `\`${cle(ligne)}\` : reportée sur \`${piste}\`, dont le statut est « ${statut} » — une piste close ne peut plus porter un report`,
      );
    }
  }

  if (traceesVerifiees === 0) {
    constats.push(
      'aucune route tracée vérifiée : le §7 n’en classe plus aucune, ou le format du tableau a changé — la porte ne mord plus',
    );
  }
  return constats;
}

/**
 * Applique une mutation de sonde et **lève si elle n'a rien changé**. Une sonde qui
 * ne mute rien accuse la porte au lieu de la prouver (`LE-42`).
 *
 * @param {string} texte
 * @param {string} cherche
 * @param {string} remplace
 * @param {string} nom
 */
function muter(texte, cherche, remplace, nom) {
  const mute = texte.replace(cherche, remplace);
  if (mute === texte) {
    throw new Error(`Sonde « ${nom} » : la mutation n'a rien changé.`);
  }
  return mute;
}

/**
 * Sondes négatives. Aucune ne recopie une route ni une action : chacune prend la
 * **première** du genre visé, quelle qu'elle soit, et la mute.
 *
 * @param {string} document
 * @param {string} documentAm
 */
function autotest(document, documentAm) {
  const routes = routesDesControleurs();
  const actions = actionsDesServices();
  const lignes = lignesDuTableau(document);
  const tracee = lignes.find(
    (l) => l.classe === CLASSE_AUDITEE || l.classe === CLASSE_JOURNAL,
  );
  const differee = lignes.find((l) => l.classe === CLASSE_DIFFEREE);
  const routeTracee = routes.find((r) => tracee && cle(r) === cle(tracee));
  const serviceTrace = tracee?.service ?? '';
  const [premiereAction] = [...(actions.get(serviceTrace) ?? new Map()).keys()];

  /** @type {{ nom: string, jouer: () => string[], attendu: string }[]} */
  const sondes = [];

  // (a) Une route de mutation nouvelle, jamais classée : le cas qui arrive vraiment.
  const modele = routes[0];
  if (modele) {
    sondes.push({
      nom: 'route de mutation nouvelle non classée',
      jouer: () =>
        verifier(
          document,
          documentAm,
          [
            ...routes,
            { ...modele, verbe: 'POST', chemin: '/route/jamais-classee' },
          ],
          actions,
        ),
      attendu: '/route/jamais-classee',
    });
  }

  // (b) Une route dite tracée dont l'action n'existe pas au registre d'actions.
  if (tracee && premiereAction !== undefined) {
    sondes.push({
      nom: 'route tracée nommant une action inconnue du registre',
      jouer: () =>
        verifier(
          document,
          documentAm,
          routes,
          new Map([
            ...actions,
            // Le service perd toutes ses actions : celles que le §7 nomme
            // deviennent introuvables, sans qu'aucune ne soit recopiée ici.
            [serviceTrace, new Map()],
          ]),
        ),
      attendu: "sans nommer d'action du registre",
    });
  }

  // (c) Une route tracée dont le handler ne reçoit pas l'acteur.
  if (routeTracee) {
    sondes.push({
      nom: 'route tracée dont le handler ne reçoit pas @ActeurCourant()',
      jouer: () =>
        verifier(
          document,
          documentAm,
          routes.map((r) =>
            cle(r) === cle(routeTracee)
              ? {
                  ...r,
                  handler: muter(
                    r.handler,
                    '@ActeurCourant()',
                    '/* retiré par la sonde */',
                    'handler sans acteur',
                  ),
                }
              : r,
          ),
          actions,
        ),
      attendu: 'ne reçoit pas `@ActeurCourant()`',
    });
  }

  // (d) Un report qui pointe une piste close.
  if (differee) {
    const piste = /`?(AM-\d+)`?/.exec(differee.motif)?.[1] ?? '';
    sondes.push({
      nom: 'report vers une piste close',
      jouer: () =>
        verifier(
          document,
          muter(
            documentAm,
            // `\s*` et non un espace : Prettier ALIGNE les colonnes du tableau, donc
            // la largeur de la cellule d'identifiant change dès qu'une famille passe à
            // trois chiffres — `AM-100` a repadé toutes les lignes en `| AM-76  |`. Une
            // sonde qui code en dur cet espacement cosmétique cesse de muter, et accuse
            // alors la porte au lieu de la prouver (`LE-42`, `LE-81`).
            new RegExp(`(\\|\\s*${piste}\\s*\\|[^\\n]*?)🔄`),
            '$1✅',
            'report vers une piste close',
          ),
          routes,
          actions,
        ),
      attendu: 'une piste close ne peut plus porter un report',
    });
  }

  // (e) Une action déclarée que plus aucune ligne du §7 ne nomme.
  if (tracee) {
    sondes.push({
      nom: 'action déclarée que plus aucune ligne ne nomme',
      jouer: () =>
        verifier(
          document,
          documentAm,
          routes,
          new Map([
            ...actions,
            [
              serviceTrace,
              new Map([
                ...(actions.get(serviceTrace) ?? new Map()),
                ['action.jamais.nommee', true],
              ]),
            ],
          ]),
        ),
      attendu: 'action.jamais.nommee',
    });
  }

  if (sondes.length < 5) {
    console.error(
      `Sonde impossible : ${sondes.length} sonde(s) constructible(s) sur 5 — le §7 ne porte plus les lignes nécessaires.`,
    );
    return 1;
  }

  let echecs = 0;
  for (const sonde of sondes) {
    /** @type {string[]} */
    let constats;
    try {
      constats = sonde.jouer();
    } catch (erreur) {
      console.error(/** @type {Error} */ (erreur).message);
      echecs += 1;
      continue;
    }
    if (!constats.some((c) => c.includes(sonde.attendu))) {
      console.error(
        `Sonde « ${sonde.nom} » : la porte n'a PAS vu « ${sonde.attendu} ». Elle ne mord plus.`,
      );
      echecs += 1;
      continue;
    }
    console.log(`Sonde « ${sonde.nom} » : la porte mord. ✅`);
  }
  return echecs === 0 ? 0 : 1;
}

function principal() {
  const document = lire(REGISTRE);
  const documentAm = lire(REGISTRE_AM);
  if (process.argv.includes('--autotest')) {
    return autotest(document, documentAm);
  }
  const constats = verifier(document, documentAm);
  if (constats.length > 0) {
    console.error(`Piste d'audit acteur — ${constats.length} constat(s) :`);
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }
  console.log(
    "Piste d'audit acteur : les routes de mutation des services sont toutes classées au §7, chaque route tracée nomme une action réellement consignée et reçoit son acteur, chaque report nomme une piste ouverte.",
  );
  return 0;
}

process.exitCode = principal();
