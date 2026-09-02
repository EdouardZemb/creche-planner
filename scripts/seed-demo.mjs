#!/usr/bin/env node
// @ts-check
/**
 * Peuplement de la base avec le **jeu de données de référence** (fictif,
 * représentatif d'un foyer type à deux enfants) :
 *
 *  - Foyer : RFR 72 705 € (3 parts), ressources CAF 6 716,92 €/mois,
 *    2 enfants à charge.
 *  - Enfants : Zoé et Mia.
 *  - Crèche PSU « Les Hirondelles » : 2 contrats du 01/01/2026 au 31/07/2026,
 *    7 mensualités, tarif horaire 3,47 € — semaine type indicative.
 *  - École ABCM (maternelle, tranche 3 : RFR > 50 000 €) : Zoé en cantine +
 *    périscolaire soir → DEUX contrats (le `mode` d'un contrat ne pilote qu'UN
 *    générateur).
 *
 * Le catalogue tarifaire 2026 (grilles ABCM, barème PSU, frais fixes, fermetures)
 * est déjà amorcé automatiquement par `svc-referentiel` (SeedService) — ce script
 * ne touche QUE les données propres au foyer, via le BFF `/api/v1`.
 *
 * ## Surcouche locale (optionnelle)
 * Si `scripts/seed.local.json` existe (ignoré par git), ses clés `foyer` et
 * `contrats` sont fusionnées (deep merge générique) sur le jeu de démonstration
 * avant l'envoi. Permet d'amorcer une instance avec un jeu de données propre
 * sans modifier le dépôt. En son absence, le seed produit le foyer fictif.
 *
 * ## Idempotent
 * Les identifiants créés sont mémorisés dans `scripts/.seed-demo-state.json`
 * (ignoré par git, lié à l'instance de base). Relancer le script :
 *  - réutilise le foyer s'il existe encore (`GET /foyers/:id` → 200) ;
 *  - sinon recrée tout (volumes Docker réinitialisés) ;
 *  - réécrit contrats (PUT) et plannings (PUT, upsert naturel) sans doublon ;
 *  - **garantit la version de ressources à la date d'effet du jeu de référence**
 *    sur un foyer réutilisé (`garantirVersionRessources`). Cette dernière ligne
 *    manquait : « idempotent » ne valait que pour ce que le script CRÉAIT, jamais
 *    pour ce qu'il DÉCLARAIT sur un foyer déjà là (`LE-76`/`EM-17`, 3e fois).
 *
 * ## Usage
 *   docker compose up -d            # stack + amorçage référentiel
 *   node scripts/seed-demo.mjs      # peuplement foyer (ou: pnpm seed:demo)
 *   node scripts/seed-demo.mjs --verify   # + contrôle des coûts calculés
 *   node scripts/seed-demo.mjs --autotest # rejoue les sondes de `garantirFoyer`
 *                                         # (client HTTP factice, aucun réseau)
 *
 * Variable d'env `SEED_BASE_URL` pour cibler une autre gateway
 * (défaut http://localhost:3000/api/v1).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE_URL = process.env.SEED_BASE_URL ?? 'http://localhost:3000/api/v1';
const ICI = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(ICI, '.seed-demo-state.json');
const LOCAL_OVERRIDE_PATH = join(ICI, 'seed.local.json');
const ORACLE_PATH = join(ICI, 'seed-oracle.json');
const VERIFIER = process.argv.includes('--verify');

// --- Jeu de données de référence (fictif) ---------------------------------

/** Foyer fiscal de démonstration. */
const FOYER_DEFAUT = {
  // Date d'effet des ressources, ALIGNÉE sur le début du plus ancien contrat
  // (01/01/2026). Sans elle, la version serait datée du **jour du seed** et ne
  // couvrirait aucun des mois de la démonstration : depuis `AM-55`, le calcul de
  // coût refuse un mois qu'aucune version de ressources ne couvre, au lieu de le
  // valoriser avec celles d'aujourd'hui. L'oracle (mars 2026 → 851,16 €) n'est
  // donc calculable que si la famille a déclaré ses ressources dès janvier — ce
  // qui est aussi le scénario réaliste.
  dateEffet: '2026-01-01',
  // Ressources mensuelles retenues par la CAF (rappel de calcul des contrats crèche).
  ressourcesMensuelles: 6716.92,
  // Revenu fiscal de référence.
  rfr: 72705,
  nbEnfantsACharge: 2,
  nbParts: 3,
  enfants: [
    { prenom: 'Zoé', dateNaissance: '2023-03-12' },
    { prenom: 'Mia', dateNaissance: '2024-12-08' },
  ],
};

/** Plage horaire `HH:MM → HH:MM` (sans le contrat la stocke en h/min). */
const plage = (debut, fin) => {
  const [dh, dm] = debut.split(':').map(Number);
  const [fh, fm] = fin.split(':').map(Number);
  return { debutHeures: dh, debutMinutes: dm, finHeures: fh, finMinutes: fm };
};

/**
 * Contrats à garantir. La clé est un identifiant **stable** servant à
 * l'idempotence (mappée vers l'UUID serveur dans le fichier d'état) ; elle ne
 * porte aucun prénom.
 *
 * Les heures annuelles contractualisées pilotent la mensualité PSU ; la semaine
 * type ci-dessous est **indicative** (elle ne sert qu'à dériver les heures
 * réservées d'un mois pour les ajustements, pas la mensualité lissée).
 */
const CONTRATS_DEFAUT = {
  // --- Crèche PSU 01/01 → 31/07/2026 ----------------------------------------
  'creche-enfant-1': {
    mode: 'CRECHE_PSU',
    enfant: 'Zoé',
    valideDu: '2026-01-01',
    valideAu: '2026-07-31',
    heuresAnnuellesContractualisees: 831.5, // mensualité 412,20 €
    nbMensualites: 7,
    semaineType: {
      LUNDI: [plage('08:30', '17:00')],
      MERCREDI: [plage('08:30', '17:00')],
      VENDREDI: [plage('08:30', '17:00')],
    },
  },
  'creche-enfant-2': {
    mode: 'CRECHE_PSU',
    enfant: 'Mia',
    valideDu: '2026-01-01',
    valideAu: '2026-07-31',
    heuresAnnuellesContractualisees: 885.5, // mensualité 438,96 €
    nbMensualites: 7,
    semaineType: {
      LUNDI: [plage('08:30', '17:00')],
      MERCREDI: [plage('08:30', '17:00')],
      VENDREDI: [plage('08:30', '17:00')],
    },
  },

  // --- ABCM Zoé, maternelle tranche 3 (année scolaire 2026/2027) ------------
  // Jours de présence indicatifs : cantine en semaine + périscolaire soir.
  // `premiereInscription: true` (lot 4b) : 1ʳᵉ année d'inscription à
  // l'association → septembre 2026 porte les frais fixes 436 € (cotisation
  // 286 € + 1ʳᵉ inscription 150 €, doc 14 §1) et non la cotisation seule.
  'abcm-cantine-enfant-1': {
    mode: 'CANTINE',
    enfant: 'Zoé',
    valideDu: '2026-09-01',
    valideAu: null,
    premiereInscription: true,
    semaineAbcm: {
      LUNDI: { cantine: true },
      JEUDI: { cantine: true },
    },
  },
  'abcm-peri-enfant-1': {
    mode: 'PERISCOLAIRE',
    enfant: 'Zoé',
    valideDu: '2026-09-01',
    valideAu: null,
    premiereInscription: true,
    semaineAbcm: {
      VENDREDI: { periSoir: true },
    },
  },
};

/**
 * Établissement (entité libre par foyer, P2) rattaché à chaque contrat — lien
 * OBLIGATOIRE depuis P5 (`etablissement_id` NOT NULL). Les contrats d'un même
 * établissement le PARTAGENT (UNIQUE(foyer_id, nom) → créé une seule fois, cf.
 * `garantirEtablissements`). Un contrat sans entrée ici retombe sur un placeholder.
 */
const ETABLISSEMENTS = {
  'creche-enfant-1': 'Crèche Les Hirondelles',
  'creche-enfant-2': 'Crèche Les Hirondelles',
  'abcm-cantine-enfant-1': 'École ABCM',
  'abcm-peri-enfant-1': 'École ABCM',
};

/** Établissement de repli pour un contrat de surcouche sans entrée `ETABLISSEMENTS`. */
const ETABLISSEMENT_DEFAUT = 'Établissement';

/**
 * Calendrier d'ouverture de démonstration (SFD 31, lot 2), par nom
 * d'établissement. Reproduit le cas réel :
 *
 * - **École ABCM** — zone **B** (l'import du lot 3 ira y chercher les vacances),
 *   régime de fériés **Alsace-Moselle** (Mulhouse : Vendredi saint et 26 décembre
 *   en plus). Semaine scolaire lun/mar/jeu/ven pour cantine et périscolaire, ALSH
 *   le mercredi ; pendant les vacances, l'ALSH seul. C'est la récurrence qui
 *   remplace la constante morte `JOURS_OUVERTURE_ECOLE` (D5).
 * - **Crèche Les Hirondelles** — aucune zone scolaire (elle n'a pas de vacances
 *   scolaires), ouverte du lundi au vendredi, plus ses fermetures annuelles posées
 *   en exceptions. Régime de fériés **Alsace-Moselle** comme l'école : les deux
 *   établissements sont à Mulhouse, c'est le lieu qui décide, pas la nature du
 *   service.
 *
 * ⚠️ Le seed passe par l'**API BFF**, jamais par SQL : c'est ce qui fait qu'il
 * emprunte exactement le chemin du produit, validation comprise. Un seed SQL
 * poserait sans effort des données que l'API refuserait.
 */
const CALENDRIERS = {
  'École ABCM': {
    zoneScolaire: 'B',
    regimeFeries: 'FR_ALSACE_MOSELLE',
    recurrences: [
      ...['LUNDI', 'MARDI', 'JEUDI', 'VENDREDI'].map((jourSemaine) => ({
        regime: 'SCOLAIRE',
        jourSemaine,
        services: ['CANTINE', 'PERISCOLAIRE'],
      })),
      { regime: 'SCOLAIRE', jourSemaine: 'MERCREDI', services: ['ALSH'] },
      ...['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI'].map(
        (jourSemaine) => ({
          regime: 'VACANCES',
          jourSemaine,
          services: ['ALSH'],
        }),
      ),
    ],
    exceptions: [],
  },
  'Crèche Les Hirondelles': {
    zoneScolaire: null,
    regimeFeries: 'FR_ALSACE_MOSELLE',
    recurrences: ['LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI'].map(
      (jourSemaine) => ({
        regime: 'SCOLAIRE',
        jourSemaine,
        services: ['CRECHE_PSU'],
      }),
    ),
    // Fermetures annuelles de la crèche, en exceptions ponctuelles. Sous-ensemble
    // représentatif des 18 dates seedées par le Référentiel (`FERMETURES_2026`) —
    // leur reprise complète est le sujet du lot 4, pas de celui-ci.
    exceptions: [
      { jour: '2026-05-15', type: 'FERMETURE', libelle: 'Pont de l’Ascension' },
      { jour: '2026-08-03', type: 'FERMETURE', libelle: 'Fermeture d’été' },
      { jour: '2026-08-04', type: 'FERMETURE', libelle: 'Fermeture d’été' },
      {
        jour: '2026-12-24',
        type: 'FERMETURE',
        libelle: 'Fermeture de fin d’année',
      },
    ],
  },
};

/** Plannings mensuels NOMINAUX à écrire (corps vide = sans absence/complément). */
const PLANNINGS = {
  // Crèche : période contractuelle (7 mensualités) → reproduit la mensualité fixe.
  'creche-enfant-1': moisRange('2026-01', '2026-07'),
  'creche-enfant-2': moisRange('2026-01', '2026-07'),
  // ABCM : année scolaire 2026/2027 (hors août, structure fermée).
  'abcm-cantine-enfant-1': moisRange('2026-09', '2027-07').filter(
    estMoisScolaire,
  ),
  'abcm-peri-enfant-1': moisRange('2026-09', '2027-07').filter(estMoisScolaire),
};

// --- Surcouche locale (override générique, non commitée) ------------------

/** Fusion profonde générique : les objets sont fusionnés clé à clé, le reste
 * (scalaires, tableaux) est remplacé par la valeur de la surcouche. Une
 * surcouche absente (`undefined`) laisse la base intacte. */
function deepMerge(base, override) {
  if (override === undefined) return base;
  if (
    override &&
    typeof override === 'object' &&
    !Array.isArray(override) &&
    base &&
    typeof base === 'object' &&
    !Array.isArray(base)
  ) {
    const out = { ...base };
    for (const [k, v] of Object.entries(override)) {
      out[k] = deepMerge(base[k], v);
    }
    return out;
  }
  return override;
}

/** Charge `seed.local.json` s'il existe (sinon `null`). */
async function chargerSurcouche() {
  try {
    return JSON.parse(await readFile(LOCAL_OVERRIDE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** Applique la surcouche locale au foyer + contrats de démonstration. */
function appliquerSurcouche(surcouche) {
  const foyer = deepMerge(FOYER_DEFAUT, surcouche?.foyer);
  const contrats = deepMerge(CONTRATS_DEFAUT, surcouche?.contrats);
  return { foyer, contrats };
}

// --- Normalisation des semaines -------------------------------------------

const JOURS = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
  'SAMEDI',
  'DIMANCHE',
];

/**
 * Complète une semaine partielle sur les 7 jours. Zod 4 traite
 * `z.record(enumJours, …)` comme un objet dont **chaque** jour est requis : les
 * jours non renseignés doivent donc porter une valeur « vide » explicite
 * (`[]` pour la crèche, `{}` pour l'ABCM).
 */
function completerSemaine(partielle, vide) {
  return Object.fromEntries(
    JOURS.map((j) => [j, partielle[j] ?? structuredClone(vide)]),
  );
}

/** Normalise le corps d'un contrat selon son mode (semaine complète sur 7 j). */
function normaliserContrat(def) {
  if (def.mode === 'CRECHE_PSU') {
    return { ...def, semaineType: completerSemaine(def.semaineType, []) };
  }
  return { ...def, semaineAbcm: completerSemaine(def.semaineAbcm, {}) };
}

// --- Helpers calendrier ---------------------------------------------------

/** Liste des mois `YYYY-MM` de `debut` à `fin` inclus. */
function moisRange(debut, fin) {
  const [da, dm] = debut.split('-').map(Number);
  const [fa, fm] = fin.split('-').map(Number);
  const out = [];
  for (let a = da, m = dm; a < fa || (a === fa && m <= fm);) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    if (++m > 12) {
      m = 1;
      a++;
    }
  }
  return out;
}

/** Mois scolaire ABCM : septembre → juillet (août exclu). */
function estMoisScolaire(mois) {
  return mois.slice(-2) !== '08';
}

// --- Client HTTP ----------------------------------------------------------

/**
 * Fenêtre de rejeu des réponses 502/503 de la gateway. Depuis le lot B3,
 * `attendreGateway` sonde la readiness de la CHAÎNE (les 5 amonts prêts) : la
 * cause racine du flaky CI documenté depuis #165 — la première écriture
 * (`POST /foyers`) partant vers un svc-foyer encore en migration — est fermée
 * en amont. Ce rejeu reste la ceinture pour ce que la readiness ne couvre pas :
 * un disjoncteur encore ouvert côté gateway (état client, pas état d'amont) se
 * referme au premier succès. Un 502/503 signifie que l'amont n'a pas traité la
 * requête : la rejouer ne crée pas de doublon. Toute autre erreur échoue franchement.
 */
const REJEU_ECHEANCE_MS = 30_000;
const REJEU_PAUSE_MS = 1_000;

async function http(methode, chemin, corps, { rejouerAmont = true } = {}) {
  const echeance = Date.now() + REJEU_ECHEANCE_MS;
  let signale = false;
  for (;;) {
    const reponse = await fetch(`${BASE_URL}${chemin}`, {
      method: methode,
      headers: corps ? { 'Content-Type': 'application/json' } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
    });
    if (reponse.ok) {
      const type = reponse.headers.get('content-type') ?? '';
      return type.includes('application/json') ? reponse.json() : undefined;
    }
    const texte = await reponse.text().catch(() => '');
    const amontIndisponible = reponse.status === 502 || reponse.status === 503;
    if (rejouerAmont && amontIndisponible && Date.now() < echeance) {
      if (!signale) {
        console.log(
          `  ⏳ ${methode} ${chemin} → HTTP ${reponse.status} (amont pas prêt) — rejeu ≤ ${REJEU_ECHEANCE_MS / 1000} s…`,
        );
        signale = true;
      }
      await pause(REJEU_PAUSE_MS);
      continue;
    }
    throw new Error(`${methode} ${chemin} → HTTP ${reponse.status} ${texte}`);
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Readiness de la CHAÎNE. `BASE_URL` finit par `/api/v1` : remonter d'un cran
 * donne `<origine>/api/health`, la readiness de la gateway — qui, depuis le lot
 * B3, n'est verte que si les 5 amonts le sont (base + migrations + NATS de
 * chacun). C'est la sonde qu'il fallait attendre depuis le début : l'ancienne
 * (`GET /couts`, « toute réponse HTTP = prêt ») ne prouvait que le process de la
 * gateway, d'où les 502/503 de la première écriture.
 */
const SANTE_URL = new URL('../health', `${BASE_URL}/`).toString();

/** Attend que la gateway ET ses amonts soient prêts (readiness 2xx). */
async function attendreGateway(essaisMax = 60) {
  process.stdout.write('⏳ Attente de la chaîne (gateway + amonts)');
  for (let i = 0; i < essaisMax; i++) {
    try {
      // 503 = un amont pas encore prêt : on repasse, ce n'est pas une erreur.
      const reponse = await fetch(SANTE_URL);
      if (reponse.ok) {
        process.stdout.write(' ✓\n');
        return;
      }
    } catch {
      // Gateway pas encore à l'écoute : même traitement qu'un 503.
    }
    process.stdout.write('.');
    await pause(2000);
  }
  process.stdout.write('\n');
  throw new Error(
    `Chaîne non prête sur ${SANTE_URL} après ${essaisMax} essais`,
  );
}

// --- État (idempotence) ---------------------------------------------------

/**
 * Applique une table de renommage de clés de contrats à l'état chargé : si une
 * ancienne clé est présente et la nouvelle absente, l'UUID déjà créé est réutilisé
 * sous la nouvelle clé (rename interne, idempotent) — évite tout doublon de
 * contrat. La table provient de la surcouche locale (`migration.keyMap`,
 * gitignorée) : le dépôt ne fige aucune ancienne clé.
 */
function migrerClesEtat(etat, keyMap) {
  if (!etat.contrats || !keyMap) return etat;
  for (const [ancienne, nouvelle] of Object.entries(keyMap)) {
    if (etat.contrats[ancienne] && !etat.contrats[nouvelle]) {
      etat.contrats[nouvelle] = etat.contrats[ancienne];
      delete etat.contrats[ancienne];
    }
  }
  return etat;
}

/**
 * Charge l'état d'idempotence. Priorité au fichier courant
 * (`.seed-demo-state.json`). À défaut, si la surcouche locale décrit un état
 * hérité (`migration.legacyStateFile` + `migration.keyMap`), on le reprend en
 * renommant ses clés — utile pour une instance déjà amorcée par une version
 * antérieure du seed, sans édition manuelle du fichier d'état.
 */
async function chargerEtat(surcouche) {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    /* pas d'état courant — on tente l'état hérité décrit par la surcouche */
  }
  const migration = surcouche?.migration;
  if (migration?.legacyStateFile) {
    try {
      const heritee = JSON.parse(
        await readFile(join(ICI, migration.legacyStateFile), 'utf8'),
      );
      return migrerClesEtat(heritee, migration.keyMap);
    } catch {
      /* pas d'état hérité lisible */
    }
  }
  return { foyerId: null, contrats: {} };
}

async function sauverEtat(etat) {
  await writeFile(STATE_PATH, JSON.stringify(etat, null, 2) + '\n');
}

// --- Orchestration --------------------------------------------------------

/**
 * Garantit que la version de ressources à la date d'effet du jeu de référence
 * existe sur un foyer **déjà en base**, et la déclare si elle manque.
 *
 * ## Pourquoi cette fonction existe
 *
 * `garantirFoyer` réutilisait le foyer sans rien vérifier de son contenu : la
 * `dateEffet` du jeu de référence n'était envoyée que dans le `POST /foyers` de
 * CRÉATION. Sur toute instance déjà amorcée — staging, production — la version
 * de ressources gardait donc la date du **premier** seed, et les mois antérieurs
 * n'étaient couverts par aucune version. Sans conséquence tant que l'aval
 * extrapolait ; depuis `AM-55` le calcul de coût les REFUSE (422
 * `RESSOURCES_INCONNUES_AU_MOIS`), et la porte 3 de `deploy.mjs` — dont le smoke
 * perf sonde `/couts/annuel` sur ce foyer — bloque alors le déploiement.
 *
 * C'est la TROISIÈME occurrence du motif `LE-76`/`EM-17` : un correctif posé à
 * la CRÉATION est un no-op sur tout ce qui existe déjà, et la CI ne peut pas le
 * voir puisqu'elle part d'un `down -v`. Le dépôt écrit donc ici la correction
 * durable, pas une nouvelle leçon (cf. `CLAUDE.md`, § boucle d'amélioration).
 *
 * L'écriture passe par `PUT /foyers/:id`, qui **crée ou écrase** la version à
 * `dateEffet` (cf. `svc-foyer.mettreAJour`) : la rejouer est sans effet, et elle
 * ne touche pas les versions postérieures déjà déclarées.
 *
 * @param {string} foyerId
 * @param {{ dateEffet?: string, ressourcesMensuelles: number, rfr: number,
 *           nbEnfantsACharge: number, nbParts: number }} foyer
 * @param {typeof http} requete client HTTP (injecté par `--autotest`)
 * @returns {Promise<'absente-ajoutee' | 'deja-presente' | 'sans-date-effet'>}
 */
async function garantirVersionRessources(foyerId, foyer, requete = http) {
  const dateEffet = foyer.dateEffet;
  // Sans date d'effet déclarée, le jeu de référence ne prétend rien sur
  // l'historique : on ne réécrit pas ce qu'il ne décrit pas.
  if (!dateEffet) return 'sans-date-effet';

  const versions = (await requete('GET', `/foyers/${foyerId}/versions`)) ?? [];
  if (versions.some((v) => v.dateEffet === dateEffet)) {
    console.log(`  ↳ ressources déjà déclarées au ${dateEffet}`);
    return 'deja-presente';
  }

  await requete('PUT', `/foyers/${foyerId}`, {
    ressourcesMensuelles: foyer.ressourcesMensuelles,
    rfr: foyer.rfr,
    nbEnfantsACharge: foyer.nbEnfantsACharge,
    nbParts: foyer.nbParts,
    dateEffet,
    motif: "Alignement du jeu de référence (seed) sur sa date d'effet",
  });
  console.log(`  ↳ ressources déclarées au ${dateEffet} (version rétroactive)`);
  return 'absente-ajoutee';
}

/** Garantit le foyer + ses enfants ; renvoie l'UUID foyer. */
async function garantirFoyer(etat, foyer, requete = http) {
  if (etat.foyerId) {
    try {
      await requete('GET', `/foyers/${etat.foyerId}`);
      console.log(`• Foyer déjà présent (${etat.foyerId}) — réutilisé`);
      // Réutiliser un foyer ne dit RIEN de son contenu : la date d'effet du jeu
      // de référence doit y être garantie comme elle l'est à la création.
      await garantirVersionRessources(etat.foyerId, foyer, requete);
      return etat.foyerId;
    } catch {
      console.log('• Foyer absent en base — recréation (état réinitialisé)');
      etat.contrats = {};
    }
  }
  const { foyer: cree, enfants } = await requete('POST', '/foyers', foyer);
  etat.foyerId = cree.id;
  console.log(
    `• Foyer créé ${cree.id} (tranche ${cree.tranche ?? '?'}) ` +
      `+ ${enfants.length} enfant(s) : ${enfants.map((e) => e.prenom).join(', ')}`,
  );
  return cree.id;
}

/**
 * Garantit les établissements requis par les contrats (idempotent) et renvoie la
 * table `nom → id`. On LISTE d'abord ceux du foyer (réutilise un foyer existant),
 * puis on CRÉE ceux qui manquent — l'unicité `(foyer_id, nom)` évite les doublons.
 */
async function garantirEtablissements(foyerId, noms) {
  const existants =
    (await http('GET', `/foyers/${foyerId}/etablissements`)) ?? [];
  const parNom = {};
  for (const e of existants) parNom[e.nom] = e.id;
  for (const nom of noms) {
    if (parNom[nom]) continue;
    const cree = await http('POST', `/foyers/${foyerId}/etablissements`, {
      nom,
    });
    parNom[nom] = cree.id;
    console.log(`• Établissement « ${nom} » créé (${cree.id})`);
  }
  return parNom;
}

/**
 * Pose le calendrier d'ouverture des établissements seedés (SFD 31, lot 2), via
 * les routes BFF du lot.
 *
 * **Idempotent, mais pas gratuitement** : `PUT …/recurrences` remplace la semaine
 * type d'un bloc, donc le rejouer est sans effet observable — il ajoute en
 * revanche une tranche de connaissance à l'historique. `POST …/exceptions` est un
 * upsert **par jour** : rejouer clôt l'exception du jour et en rouvre une
 * identique. C'est le prix de l'append-only, et il est assumé : un seed n'écrase
 * rien, il déclare l'état voulu à l'instant où on le joue.
 */
async function garantirCalendriers(foyerId, etablissementsParNom) {
  for (const [nom, id] of Object.entries(etablissementsParNom)) {
    const calendrier = CALENDRIERS[nom];
    if (!calendrier) continue;
    const base = `/foyers/${foyerId}/etablissements/${id}`;
    // Zone et régime voyagent par le CRUD établissement : la zone est une colonne
    // simple, le régime est historisé côté service (`AM-106`).
    await http('PUT', base, {
      zoneScolaire: calendrier.zoneScolaire,
      regimeFeries: calendrier.regimeFeries,
    });
    await http('PUT', `${base}/calendrier/recurrences`, {
      recurrences: calendrier.recurrences,
    });
    for (const exception of calendrier.exceptions) {
      await http('POST', `${base}/calendrier/exceptions`, exception);
    }
    console.log(
      `• Calendrier de « ${nom} » posé ` +
        `(${calendrier.recurrences.length} récurrence(s), ` +
        `${calendrier.exceptions.length} exception(s), ` +
        `fériés ${calendrier.regimeFeries})`,
    );
  }
}

/**
 * Table `prénom → id` des enfants du foyer : chaque contrat porte le lien
 * `enfantId` (référence svc-foyer) en plus du prénom dénormalisé. Lus via le
 * dossier foyer (`GET /foyers/:id` → `{ foyer, enfants, parents }`) — la
 * gateway n'expose pas de `GET /foyers/:id/enfants` dédié.
 */
async function enfantsParPrenom(foyerId) {
  const { enfants } = await http('GET', `/foyers/${foyerId}`);
  return Object.fromEntries((enfants ?? []).map((e) => [e.prenom, e.id]));
}

/** Garantit un contrat (POST si nouveau, PUT si déjà connu). */
async function garantirContrat(
  etat,
  foyerId,
  cle,
  def,
  etablissementId,
  enfantId,
) {
  const corps = {
    ...normaliserContrat(def),
    foyerId,
    etablissementId,
    enfantId,
  };
  const idConnu = etat.contrats[cle];
  if (idConnu) {
    try {
      const vue = await http('PUT', `/contrats/${idConnu}`, corps);
      console.log(`• Contrat ${cle} mis à jour (${vue.id})`);
      return vue.id;
    } catch {
      console.log(`• Contrat ${cle} introuvable — recréation`);
    }
  }
  const vue = await http('POST', '/contrats', corps);
  etat.contrats[cle] = vue.id;
  console.log(`• Contrat ${cle} créé (${vue.id})`);
  return vue.id;
}

/** Écrit les plannings nominaux d'un contrat. */
async function ecrirePlannings(contratId, cle) {
  const mois = PLANNINGS[cle] ?? [];
  for (const m of mois) {
    await http('PUT', `/contrats/${contratId}/plannings/${m}`, {});
  }
  if (mois.length) {
    console.log(
      `  ↳ ${mois.length} planning(s) : ${mois[0]} … ${mois[mois.length - 1]}`,
    );
  }
}

/**
 * Contrôle que les coûts calculés reproduisent les montants attendus du jeu de
 * référence.
 *
 * VRAI garde (`--verify`) : après polling de la projection asynchrone (NATS →
 * tarification), si un montant cible attendu strictement positif reste à 0 / absent,
 * ou s'écarte trop de la valeur connue, le script échoue (`process.exit(1)`).
 *
 * Les montants attendus vivent dans l'oracle VERSIONNÉ `scripts/seed-oracle.json`
 * (audit 2026-07) : chaque cible y référence le cas de calcul de
 * `docs/02-modele-de-cout.md` §6 qui la justifie. Si l'algorithme tarifaire change,
 * l'oracle évolue dans le même diff — il n'est plus codé en dur ici.
 */
async function verifierCouts(foyerId) {
  console.log('\n🔎 Vérification des coûts calculés (projection asynchrone)…');
  /**
   * @type {{ cibles: Array<{ mois: string, attendu: string, cas: string,
   *   attenduCentimes?: number, toleranceCentimes?: number, minCentimes?: number }> }}
   */
  const { cibles } = JSON.parse(await readFile(ORACLE_PATH, 'utf8'));
  const eur = (centimes) => (centimes / 100).toFixed(2) + ' €';
  const echecs = [];

  // Un coût est « satisfaisant » quand il atteint la valeur ATTENDUE — pas dès
  // qu'il est > 0. Sur une pile à FROID, la projection NATS agrège les contrats
  // l'un après l'autre : mars passe transitoirement par 412,20 € (Zoé seule)
  // avant d'atteindre 851,16 € (Zoé + Mia). Latcher sur le premier > 0
  // capterait cet état partiel ; on attend donc la cible.
  const estSatisfaisant = (c, cible) => {
    const t = Number(c?.totalCentimes ?? 0);
    if (cible.attenduCentimes !== undefined) {
      return Math.abs(t - cible.attenduCentimes) <= cible.toleranceCentimes;
    }
    if (cible.minCentimes !== undefined) return t >= cible.minCentimes;
    return t > 0;
  };

  for (const cible of cibles) {
    const { mois, attendu } = cible;
    let cout = null;
    // Jusqu'à ~60 s par cible : la projection est lente à froid (cold start JVM/JIT,
    // caches vides, agrégation multi-contrats) — bien plus que sur une pile chaude.
    for (let i = 0; i < 30; i++) {
      try {
        // Pas de rejeu 502/503 ici : cette boucle de polling est déjà bornée
        // (30 × 2 s) et son rythme ne doit pas être modifié par l'helper.
        cout = await http(
          'GET',
          `/couts?foyer=${foyerId}&mois=${mois}`,
          undefined,
          {
            rejouerAmont: false,
          },
        );
        if (cout && estSatisfaisant(cout, cible)) break;
      } catch {
        /* projection asynchrone pas encore prête */
      }
      await pause(2000);
    }

    const total = Number(cout?.totalCentimes ?? 0);
    if (!cout || total === 0) {
      console.log(`  ${mois} → (pas de coût)   (attendu : ${attendu})`);
      echecs.push(`${mois} : aucun coût calculé (attendu : ${attendu})`);
      continue;
    }
    console.log(`  ${mois} → ${eur(total)}   (attendu : ${attendu})`);
    for (const p of cout.prestations ?? []) {
      console.log(`      - ${p.enfant} / ${p.mode} : ${eur(p.totalCentimes)}`);
    }

    // Assertions selon le type de cible.
    if (cible.attenduCentimes !== undefined) {
      const ecart = Math.abs(total - cible.attenduCentimes);
      if (ecart > cible.toleranceCentimes) {
        echecs.push(
          `${mois} : ${eur(total)} ≠ ${eur(cible.attenduCentimes)} ` +
            `(écart ${ecart} c > tolérance ${cible.toleranceCentimes} c)`,
        );
      }
    } else if (cible.minCentimes !== undefined && total < cible.minCentimes) {
      echecs.push(
        `${mois} : ${eur(total)} < minimum attendu ${eur(cible.minCentimes)}`,
      );
    }
  }

  if (echecs.length) {
    console.error('\n❌ Vérification des coûts ÉCHOUÉE :');
    for (const e of echecs) console.error(`   - ${e}`);
    process.exit(1);
  }
  console.log('\n✅ Coûts vérifiés (montants attendus reproduits).');
}

// --- Main -----------------------------------------------------------------

async function main() {
  console.log(`🌱 Seed du jeu de données de référence → ${BASE_URL}\n`);
  await attendreGateway();

  const surcouche = await chargerSurcouche();
  if (surcouche) {
    console.log('• Surcouche locale détectée (scripts/seed.local.json)');
  }
  const { foyer, contrats } = appliquerSurcouche(surcouche);

  const etat = await chargerEtat(surcouche);

  const foyerId = await garantirFoyer(etat, foyer);
  await sauverEtat(etat);

  // Établissements (lien contrat OBLIGATOIRE depuis P5) : créés/réutilisés une fois,
  // partagés par les contrats de même établissement.
  const noms = [
    ...new Set(
      Object.keys(contrats).map(
        (cle) => ETABLISSEMENTS[cle] ?? ETABLISSEMENT_DEFAUT,
      ),
    ),
  ];
  const etablissements = await garantirEtablissements(foyerId, noms);

  // Calendrier d'ouverture des établissements (SFD 31, lot 2) : zone scolaire,
  // régime de fériés, semaine type par régime et fermetures annuelles.
  await garantirCalendriers(foyerId, etablissements);

  // Enfants du foyer (prénom → id) : lien `enfantId` requis à la création.
  const enfants = await enfantsParPrenom(foyerId);

  for (const [cle, def] of Object.entries(contrats)) {
    const nom = ETABLISSEMENTS[cle] ?? ETABLISSEMENT_DEFAUT;
    const enfantId = enfants[def.enfant];
    if (!enfantId) {
      throw new Error(
        `contrat ${cle} : aucun enfant « ${def.enfant} » dans le foyer ${foyerId}`,
      );
    }
    const contratId = await garantirContrat(
      etat,
      foyerId,
      cle,
      def,
      etablissements[nom],
      enfantId,
    );
    await sauverEtat(etat);
    await ecrirePlannings(contratId, cle);
  }

  console.log('\n✅ Peuplement terminé.');
  console.log(`   Foyer : ${foyerId}`);
  console.log(`   État  : ${STATE_PATH}`);

  if (VERIFIER) await verifierCouts(foyerId);
}

// --- Sondes négatives (`--autotest`) ---------------------------------------

/**
 * Client HTTP factice : enregistre les appels et rend des réponses plausibles.
 * Aucun réseau, aucune pile — la sonde doit tourner sur un clone nu.
 *
 * @param {{ versions: { dateEffet: string }[], foyerExiste: boolean }} monde
 */
function clientFactice({ versions, foyerExiste }) {
  /** @type {{ methode: string, chemin: string, corps: unknown }[]} */
  const appels = [];
  /** @type {typeof http} */
  const requete = async (methode, chemin, corps) => {
    appels.push({ methode, chemin, corps });
    if (methode === 'GET' && chemin.endsWith('/versions')) return versions;
    if (methode === 'GET') {
      if (!foyerExiste) throw new Error('404 — foyer absent');
      return { foyer: { id: 'existant' }, enfants: [], parents: [] };
    }
    if (methode === 'POST') {
      return { foyer: { id: 'cree', tranche: 1 }, enfants: [] };
    }
    return undefined;
  };
  return { appels, requete };
}

/**
 * Rejoue les quatre cas de `garantirFoyer` contre le client factice.
 *
 * Ces sondes existent parce que la CI ne PEUT PAS voir le défaut qu'elles
 * gardent : elle part d'un `down -v`, donc toujours par la branche de CRÉATION,
 * où la date d'effet a toujours été correcte. Le défaut ne vivait que sur une
 * instance déjà amorcée (`LE-76`/`EM-17`, 3e occurrence) — c'est-à-dire en
 * staging et en production, là où aucun test ne tournait.
 *
 * Les attendus sont DÉRIVÉS de `FOYER_DEFAUT`, jamais recopiés : si le jeu de
 * référence change de date d'effet ou de montants, la sonde suit.
 *
 * @returns {Promise<number>} code de sortie (0 = toutes les sondes mordent)
 */
async function autotest() {
  const attendue = FOYER_DEFAUT.dateEffet;
  /** @type {{ nom: string, monde: Parameters<typeof clientFactice>[0],
   *           etat: { foyerId?: string, contrats: Record<string, unknown> },
   *           attendu: (appels: { methode: string, chemin: string, corps: any }[]) => string | null }[]} */
  const sondes = [
    {
      // LE CAS QUI ARRIVE VRAIMENT : staging et prod, amorcés avant `AM-55`.
      nom: 'foyer réutilisé SANS la version à la date d’effet → déclarée',
      monde: { versions: [{ dateEffet: '2026-06-22' }], foyerExiste: true },
      etat: { foyerId: 'existant', contrats: {} },
      attendu: (appels) => {
        const put = appels.find((a) => a.methode === 'PUT');
        if (!put)
          return 'aucun PUT : la version manquante n’a pas été déclarée';
        if (put.corps?.dateEffet !== attendue)
          return `PUT à la mauvaise date d’effet : ${put.corps?.dateEffet}`;
        if (put.corps?.rfr !== FOYER_DEFAUT.rfr)
          return `PUT au mauvais RFR : ${put.corps?.rfr}`;
        if (
          put.corps?.ressourcesMensuelles !== FOYER_DEFAUT.ressourcesMensuelles
        )
          return `PUT aux mauvaises ressources : ${put.corps?.ressourcesMensuelles}`;
        if (put.corps?.nbParts !== FOYER_DEFAUT.nbParts)
          return `PUT au mauvais nombre de parts : ${put.corps?.nbParts}`;
        return null;
      },
    },
    {
      nom: 'foyer réutilisé AVEC la version → aucune écriture (idempotence)',
      monde: { versions: [{ dateEffet: attendue }], foyerExiste: true },
      etat: { foyerId: 'existant', contrats: {} },
      attendu: (appels) =>
        appels.some((a) => a.methode !== 'GET')
          ? 'une écriture a été émise alors que la version existait déjà'
          : null,
    },
    {
      nom: 'foyer disparu de la base → recréation (cas création intact)',
      monde: { versions: [], foyerExiste: false },
      etat: { foyerId: 'fantome', contrats: { c1: {} } },
      attendu: (appels) =>
        appels.some((a) => a.methode === 'POST' && a.chemin === '/foyers')
          ? null
          : 'aucun POST /foyers : la recréation ne se fait plus',
    },
    {
      nom: 'premier seed (aucun état) → création directe, sans lecture de versions',
      monde: { versions: [], foyerExiste: false },
      etat: { contrats: {} },
      attendu: (appels) => {
        if (appels.some((a) => a.chemin.endsWith('/versions')))
          return 'lecture des versions sur un foyer qui n’existe pas encore';
        return appels.some(
          (a) => a.methode === 'POST' && a.chemin === '/foyers',
        )
          ? null
          : 'aucun POST /foyers à la création';
      },
    },
  ];

  console.log('Sondes de `garantirFoyer` (client HTTP factice)\n');
  let echecs = 0;
  for (const sonde of sondes) {
    const { appels, requete } = clientFactice(sonde.monde);
    let erreur = null;
    try {
      await garantirFoyer(sonde.etat, FOYER_DEFAUT, requete);
    } catch (e) {
      erreur = `la fonction a levé : ${e.message}`;
    }
    const constat = erreur ?? sonde.attendu(appels);
    if (constat === null) {
      console.log(`  ✔ ${sonde.nom}`);
    } else {
      echecs += 1;
      console.error(`  ✗ ${sonde.nom}\n      ${constat}`);
    }
  }
  console.log(
    `\n  ${sondes.length - echecs}/${sondes.length} sonde(s) vertes.`,
  );
  return echecs === 0 ? 0 : 1;
}

/** Point d'entrée : sondes négatives si `--autotest`, sinon peuplement réel. */
async function demarrer() {
  if (process.argv.includes('--autotest')) {
    process.exit(await autotest());
  }
  await main();
}

demarrer().catch((e) => {
  console.error(`\n❌ Échec du seed : ${e.message}`);
  process.exit(1);
});
