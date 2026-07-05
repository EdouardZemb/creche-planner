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
 *  - réécrit contrats (PUT) et plannings (PUT, upsert naturel) sans doublon.
 *
 * ## Usage
 *   docker compose up -d            # stack + amorçage référentiel
 *   node scripts/seed-demo.mjs      # peuplement foyer (ou: pnpm seed:demo)
 *   node scripts/seed-demo.mjs --verify   # + contrôle des coûts calculés
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
  'abcm-cantine-enfant-1': {
    mode: 'CANTINE',
    enfant: 'Zoé',
    valideDu: '2026-09-01',
    valideAu: null,
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

async function http(methode, chemin, corps) {
  const reponse = await fetch(`${BASE_URL}${chemin}`, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  if (!reponse.ok) {
    const texte = await reponse.text().catch(() => '');
    throw new Error(`${methode} ${chemin} → HTTP ${reponse.status} ${texte}`);
  }
  const type = reponse.headers.get('content-type') ?? '';
  return type.includes('application/json') ? reponse.json() : undefined;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend que la gateway réponde (toute réponse HTTP = service prêt). */
async function attendreGateway(essaisMax = 60) {
  process.stdout.write('⏳ Attente de la gateway BFF');
  for (let i = 0; i < essaisMax; i++) {
    try {
      // Sonde sans effet de bord : 400 (param manquant) = service debout.
      await fetch(`${BASE_URL}/couts?mois=2026-01`);
      process.stdout.write(' ✓\n');
      return;
    } catch {
      process.stdout.write('.');
      await pause(2000);
    }
  }
  process.stdout.write('\n');
  throw new Error(
    `Gateway injoignable sur ${BASE_URL} après ${essaisMax} essais`,
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

/** Garantit le foyer + ses enfants ; renvoie l'UUID foyer. */
async function garantirFoyer(etat, foyer) {
  if (etat.foyerId) {
    try {
      await http('GET', `/foyers/${etat.foyerId}`);
      console.log(`• Foyer déjà présent (${etat.foyerId}) — réutilisé`);
      return etat.foyerId;
    } catch {
      console.log('• Foyer absent en base — recréation (état réinitialisé)');
      etat.contrats = {};
    }
  }
  const { foyer: cree, enfants } = await http('POST', '/foyers', foyer);
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
        cout = await http('GET', `/couts?foyer=${foyerId}&mois=${mois}`);
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

main().catch((e) => {
  console.error(`\n❌ Échec du seed : ${e.message}`);
  process.exit(1);
});
