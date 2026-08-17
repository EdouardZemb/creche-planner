#!/usr/bin/env node
// @ts-check
/**
 * Porte des abonnements JetStream — l'inventaire des événements d'un contexte
 * (`AM-53`).
 *
 * ## Pourquoi ce script existe
 *
 * Jusqu'au lot 3 de « Le coût ne ment plus », les sept consommateurs durables du
 * dépôt s'abonnaient à leur stream **sans filtre**. Tout ce qu'un service ne
 * traitait pas retombait dans le `default` de son `switch`, ce qui vaut
 * `IGNORE_TYPE_INCONNU` : une ligne `dead_letter` **avec le payload en clair** —
 * revenus, adresses e-mail. `svc-planification` recevait ainsi les onze types du
 * stream `FOYER` pour n'en traiter que deux.
 *
 * Le filtre (`filter_subjects`) est maintenant **dérivé** de ce que la projection
 * déclare traiter (`ProjectionPort.typesGeres`). Ce gain crée un risque neuf, et
 * c'est lui que cette porte couvre : un type ajouté aux contrats et oublié dans
 * l'inventaire d'un contexte n'est plus livré à personne. Il ne laisse **aucun
 * rebut** — le régime d'avant criait dans `dead_letter`, celui d'après se taît.
 *
 * ## Ce que la porte garantit
 *
 *  1. `TYPES_EVENEMENTS_<CONTEXTE>` liste **tous** les `_TYPE` déclarés par sa lib
 *     de contrats, et rien d'autre.
 *  2. La valeur d'un `_TYPE` est préfixée par son contexte (`foyer.…` dans
 *     `contracts-foyer`) : c'est la convention sur laquelle repose la dérivation
 *     stream → sujets (`sujetsDuStream`).
 *  3. Chaque `typesGeres` ne nomme que des constantes connues, et chacune relève
 *     d'un stream réellement abonné (sinon : branche morte, jamais livrée).
 *  4. Aucun abonnement ne se retrouve avec un filtre **vide** — côté JetStream un
 *     `filter_subjects: []` ne vaut pas « rien », il vaut « tout le stream », donc
 *     exactement le défaut qu'on ferme.
 *
 * ## Ce que la porte NE garantit pas
 *
 *  - Elle ne prouve **pas** que `typesGeres` et le `switch` de la projection
 *    coïncident : elle lit des listes, elle n'exécute rien. C'est le rôle des
 *    `projection.types-geres.spec.ts` des quatre services, qui exécutent la
 *    projection sur l'inventaire complet de leurs streams amont et exigent
 *    l'équivalence **dans les deux sens**.
 *  - Elle ne dit rien de l'état des durables **déjà créés** en production : un
 *    filtre ne s'applique qu'après `consumers.update` au démarrage du service.
 *    Le relevé `dead_letter` de `e2e-stack` juge l'effet, pas les listes.
 *  - Elle ne juge pas la file `outbox` (`AM-61`) : rien de statique n'y répond.
 *
 * ## Usage
 *   pnpm abonnements              # vérifie et imprime le relevé (exit 1 si constat)
 *   pnpm abonnements --autotest   # rejoue les sondes négatives
 *
 * ## Contraintes de conception
 *  - Aucune dépendance : tourne sur un clone sans `node_modules`.
 *  - Aucune conclusion « par défaut » : zéro contexte, zéro service ou zéro
 *    abonnement trouvé ÉCHOUE — un balayage à vide est indiscernable d'un succès.
 *  - Lectures `fs` en `try/catch` seul, jamais un test d'existence suivi d'une
 *    lecture (fenêtre TOCTOU refusée par la règle CodeQL `js/file-system-race`).
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(import.meta.dirname, '..');
const DIR_CONTRATS = 'libs/contracts';
const DIR_APPS = 'apps';

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
function sousDossiers(relatif) {
  try {
    return fs
      .readdirSync(path.join(RACINE, relatif), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (erreur) {
    throw new Error(
      `${relatif} illisible : ${/** @type {Error} */ (erreur).message}`,
    );
  }
}

/** Aplatit les espaces : les déclarations tiennent parfois sur deux lignes. */
const plat = (source) => source.replace(/\s+/g, ' ');

/**
 * Sources lues, indexées par chemin relatif. Passer par une carte permet aux
 * sondes négatives de muter une source **en mémoire** et de rejouer la porte.
 * @returns {Map<string, string>}
 */
function lireSources() {
  const sources = new Map();
  for (const contexte of sousDossiers(DIR_CONTRATS)) {
    const relatif = `${DIR_CONTRATS}/${contexte}/src/lib/events/${contexte}-events.ts`;
    try {
      sources.set(relatif, lire(relatif));
    } catch {
      // `kernel` porte l'enveloppe partagée, pas d'événements : pas de contexte.
    }
  }
  for (const app of sousDossiers(DIR_APPS)) {
    const module = `${DIR_APPS}/${app}/src/consumers/consumers.module.ts`;
    try {
      sources.set(module, lire(module));
    } catch {
      continue; // service sans consommateur (api-gateway, svc-referentiel, web)
    }
    sources.set(
      `${DIR_APPS}/${app}/src/consumers/projection.service.ts`,
      lire(`${DIR_APPS}/${app}/src/consumers/projection.service.ts`),
    );
  }
  return sources;
}

/**
 * Contextes de contrats : constantes déclarées et inventaire annoncé.
 * @param {Map<string, string>} sources
 */
function lireContextes(sources) {
  /** @type {{contexte: string, fichier: string, constantes: Map<string,string>, inventaire: string[], nomInventaire: string|null}[]} */
  const contextes = [];
  for (const [fichier, source] of sources) {
    const nom = fichier.match(/^libs\/contracts\/([a-z-]+)\//)?.[1];
    if (nom === undefined) {
      continue;
    }
    const texte = plat(source);
    const constantes = new Map();
    for (const [, cle, valeur] of texte.matchAll(
      /export const ([A-Z0-9_]+_TYPE) = '([^']+)'/g,
    )) {
      constantes.set(cle, valeur);
    }
    const bloc = texte.match(
      /export const (TYPES_EVENEMENTS_[A-Z]+): readonly string\[\] = \[([^\]]*)\]/,
    );
    contextes.push({
      contexte: nom,
      fichier,
      constantes,
      nomInventaire: bloc?.[1] ?? null,
      inventaire: (bloc?.[2] ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0),
    });
  }
  return contextes;
}

/**
 * Services consommateurs : abonnements déclarés et types gérés.
 * @param {Map<string, string>} sources
 */
function lireServices(sources) {
  /** @type {{service: string, abonnements: {stream: string, durable: string}[], typesGeres: string[]}[]} */
  const services = [];
  for (const [fichier, source] of sources) {
    if (!fichier.endsWith('consumers/consumers.module.ts')) {
      continue;
    }
    const service = /** @type {string} */ (
      fichier.match(/^apps\/([a-z-]+)\//)?.[1]
    );
    const abonnements = [
      ...plat(source).matchAll(
        /\{ stream: '([A-Z]+)', durable: '([a-z-]+)' \}/g,
      ),
    ].map(([, stream, durable]) => ({ stream, durable }));
    const projection = plat(
      sources.get(`apps/${service}/src/consumers/projection.service.ts`) ?? '',
    );
    const bloc = projection.match(
      /readonly typesGeres: readonly string\[\] = \[([^\]]*)\]/,
    );
    services.push({
      service,
      abonnements,
      typesGeres: (bloc?.[1] ?? '')
        .split(',')
        .map((e) => e.trim())
        .filter((e) => e.length > 0),
    });
  }
  return services;
}

/**
 * Sujets d'un stream parmi des types : le premier segment nomme le contexte, donc
 * le stream. Miroir **volontaire** de `sujetsDuStream` (`libs/nest-commons`) : ce
 * script tourne sans `node_modules`, il ne peut pas importer la lib. La règle 2
 * ci-dessus est ce qui garde les deux d'accord.
 * @param {readonly string[]} types
 * @param {string} stream
 */
function sujetsDuStream(types, stream) {
  return types.filter(
    (type) => type.split('.')[0]?.toUpperCase() === stream.toUpperCase(),
  );
}

/**
 * @param {Map<string, string>} sources
 * @returns {{constats: string[], releve: string[]}}
 */
function verifier(sources) {
  const constats = [];
  const releve = [];
  const contextes = lireContextes(sources);
  const services = lireServices(sources);

  if (contextes.length === 0) {
    constats.push(
      `aucun contexte de contrats trouvé sous ${DIR_CONTRATS} — balayage à vide`,
    );
  }
  if (services.length === 0) {
    constats.push(
      `aucun service consommateur trouvé sous ${DIR_APPS} — balayage à vide`,
    );
  }

  /** @type {Map<string, string>} nom de constante → valeur, tous contextes */
  const toutesConstantes = new Map();

  for (const ctx of contextes) {
    if (ctx.nomInventaire === null) {
      constats.push(
        `${ctx.fichier} : aucun \`TYPES_EVENEMENTS_…\` — l'inventaire du contexte « ${ctx.contexte} » est la source des filtres d'abonnement`,
      );
      continue;
    }
    if (ctx.constantes.size === 0) {
      constats.push(
        `${ctx.fichier} : aucune constante \`_TYPE\` lue — l'expression de lecture est cassée, pas le fichier`,
      );
    }
    for (const [cle, valeur] of ctx.constantes) {
      toutesConstantes.set(cle, valeur);
      if (!ctx.inventaire.includes(cle)) {
        constats.push(
          `${ctx.fichier} : \`${cle}\` (${valeur}) manque à \`${ctx.nomInventaire}\` — il ne serait livré à aucun consommateur, et sans rebut pour le dire`,
        );
      }
      const prefixe = valeur.split('.')[0];
      if (prefixe !== ctx.contexte) {
        constats.push(
          `${ctx.fichier} : \`${cle}\` vaut « ${valeur} », préfixe « ${prefixe} » au lieu de « ${ctx.contexte} » — la dérivation stream → sujets ne le rattacherait à aucun stream`,
        );
      }
    }
    for (const cle of ctx.inventaire) {
      if (!ctx.constantes.has(cle)) {
        constats.push(
          `${ctx.fichier} : \`${ctx.nomInventaire}\` cite \`${cle}\`, qui n'y est pas déclaré`,
        );
      }
    }
    releve.push(
      `  ${ctx.nomInventaire} : ${ctx.inventaire.length} type(s) publié(s)`,
    );
  }

  const tousLesTypes = [...toutesConstantes.values()];

  for (const svc of services) {
    if (svc.abonnements.length === 0) {
      constats.push(
        `apps/${svc.service} : \`ABONNEMENTS\` illisible ou vide alors qu'un \`ConsumersModule\` existe`,
      );
      continue;
    }
    if (svc.typesGeres.length === 0) {
      constats.push(
        `apps/${svc.service} : \`typesGeres\` illisible ou vide — la projection ne déclare rien, ses durables n'auraient aucun filtre`,
      );
      continue;
    }
    /** @type {string[]} */
    const valeursGerees = [];
    for (const cle of svc.typesGeres) {
      const valeur = toutesConstantes.get(cle);
      if (valeur === undefined) {
        constats.push(
          `apps/${svc.service} : \`typesGeres\` cite \`${cle}\`, inconnu des contrats`,
        );
        continue;
      }
      valeursGerees.push(valeur);
    }
    const streamsAbonnes = new Set(svc.abonnements.map((a) => a.stream));
    for (const valeur of valeursGerees) {
      const stream = /** @type {string} */ (valeur.split('.')[0]).toUpperCase();
      if (!streamsAbonnes.has(stream)) {
        constats.push(
          `apps/${svc.service} : \`${valeur}\` est déclaré géré mais aucun abonnement ne couvre le stream ${stream} — branche morte, jamais livrée`,
        );
      }
    }
    for (const { stream, durable } of svc.abonnements) {
      const geres = sujetsDuStream(valeursGerees, stream);
      const publies = sujetsDuStream(tousLesTypes, stream);
      if (publies.length === 0) {
        constats.push(
          `apps/${svc.service} : le stream ${stream} de \`${durable}\` ne correspond à aucun contexte de contrats`,
        );
      }
      if (geres.length === 0) {
        constats.push(
          `apps/${svc.service} : \`${durable}@${stream}\` n'a aucun sujet géré — un \`filter_subjects\` vide vaut « tout le stream »`,
        );
      }
      releve.push(
        `  ${durable}@${stream} : ${geres.length} sujet(s) filtré(s) sur ${publies.length} publié(s) — ${publies.length - geres.length} type(s) plus livré(s)`,
      );
    }
  }

  return { constats, releve };
}

/**
 * Sondes négatives : la porte doit voir (a) un type absent de son inventaire,
 * (b) un abonnement dont plus aucun sujet n'est géré. Les deux mutations se font
 * en mémoire sur les sources réelles.
 * @param {Map<string, string>} sources
 */
function autotest(sources) {
  /** @type {{libelle: string, sources: Map<string,string>, attendu: string}[]} */
  const sondes = [];

  const ctx = lireContextes(sources).find((c) => c.inventaire.length > 1);
  if (ctx === undefined || ctx.nomInventaire === null) {
    console.error("Sonde impossible : aucun inventaire de plus d'un type.");
    return 1;
  }
  const retire = /** @type {string} */ (ctx.inventaire[0]);
  const mutees1 = new Map(sources);
  const source1 = /** @type {string} */ (sources.get(ctx.fichier));
  const ampute = source1.replace(new RegExp(`^\\s*${retire},\\n`, 'm'), '');
  if (ampute === source1) {
    console.error(
      `Sonde impossible : ${retire} introuvable dans l'inventaire de ${ctx.fichier}.`,
    );
    return 1;
  }
  mutees1.set(ctx.fichier, ampute);
  sondes.push({
    libelle: `un type publié absent de \`${ctx.nomInventaire}\``,
    sources: mutees1,
    attendu: `\`${retire}\``,
  });

  const svc = lireServices(sources).find((s) => s.abonnements.length > 0);
  if (svc === undefined) {
    console.error('Sonde impossible : aucun service abonné.');
    return 1;
  }
  const fichierProjection = `apps/${svc.service}/src/consumers/projection.service.ts`;
  const source2 = /** @type {string} */ (sources.get(fichierProjection));
  const mutees2 = new Map(sources);
  const vide = source2.replace(
    /readonly typesGeres: readonly string\[\] = \[[^\]]*\]/,
    "readonly typesGeres: readonly string[] = ['inexistant.Rien.v1']",
  );
  if (vide === source2) {
    console.error(
      `Sonde impossible : \`typesGeres\` introuvable dans ${fichierProjection}.`,
    );
    return 1;
  }
  mutees2.set(fichierProjection, vide);
  sondes.push({
    libelle: `un abonnement de ${svc.service} sans aucun sujet géré`,
    sources: mutees2,
    attendu: 'aucun sujet géré',
  });

  let echecs = 0;
  for (const sonde of sondes) {
    const { constats } = verifier(sonde.sources);
    if (constats.some((c) => c.includes(sonde.attendu))) {
      console.log(`Sonde négative : la porte voit ${sonde.libelle}. ✅`);
    } else {
      echecs += 1;
      console.error(
        `Sonde négative : la porte n'a PAS vu ${sonde.libelle}. Elle ne mord plus.`,
      );
    }
  }
  return echecs === 0 ? 0 : 1;
}

function principal() {
  const sources = lireSources();
  if (process.argv.includes('--autotest')) {
    return autotest(sources);
  }
  const { constats, releve } = verifier(sources);
  for (const ligne of releve) {
    console.log(ligne);
  }
  if (constats.length > 0) {
    console.error(`\nAbonnements JetStream — ${constats.length} constat(s) :`);
    for (const constat of constats) {
      console.error(`  - ${constat}`);
    }
    return 1;
  }
  console.log(
    "\nAbonnements JetStream : chaque contexte publie l'inventaire qu'il déclare, et chaque durable est borné à ce que sa projection traite.",
  );
  return 0;
}

process.exitCode = principal();
