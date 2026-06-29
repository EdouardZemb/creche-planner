#!/usr/bin/env node
// @ts-check
/**
 * Back-fill du lien **contrat → établissement** des foyers **existants** (feature
 * « établissements en entité libre », Phase 5 — migration de données). La colonne
 * `contrat.etablissement_id` a été ajoutée NULLABLE en P2 : les contrats déjà en
 * base n'ont donc encore aucun établissement rattaché. Ce script crée, **par
 * foyer et par groupe de mode**, un établissement au **nom par défaut** (l'ancien
 * libellé câblé) puis rattache chaque contrat du groupe à cet établissement.
 *
 * ## Groupes de mode (ancien mapping `MODE_VERS_CLE`)
 *  - `CRECHE_PSU`                       → « Crèche Les Hirondelles »
 *  - `CANTINE` / `PERISCOLAIRE` / `ALSH`→ « École ABCM »
 * Les noms sont des **placeholders** : l'utilisateur les renommera ensuite via
 * l'écran établissements (P4). `emailService` / `preavisRegle` reprennent les
 * valeurs des deux fiches globales historiques (`etablissement_destinataire`).
 *
 * ## Pourquoi via les services internes (et pas le BFF / pas du SQL brut)
 * On cible **svc-planification directement** (`/api/etablissements`,
 * `/api/contrats`), propriétaire de l'entité, et **svc-foyer** (`/api/foyers`)
 * pour énumérer les foyers — comme `backfill-parents.mjs`, ces opérations d'infra
 * admin tournent au plus près des services (réseau interne).
 *  - La **création** d'établissement émet `EtablissementCree` (outbox → projection
 *    read-model `etablissement` côté notifications).
 *  - Le **rattachement** passe par `PUT /contrats/:id/etablissement` (endpoint
 *    chirurgical P5) : il ne touche QUE `etablissement_id`, **n'écrase pas** le
 *    contrat et **n'invalide pas** ses plannings (≠ `PUT /contrats/:id`), et émet
 *    `ContratModifie` pour que le read-model notifications route le récap hebdo par
 *    ce lien. Un `UPDATE` SQL brut ne propagerait PAS l'événement → read-models aval
 *    périmés : à proscrire.
 *
 * ## Sécurité : dry-run par défaut
 * Sans `--apply`, le script **n'écrit rien** : il affiche le plan (établissements à
 * créer / déjà présents, contrats à rattacher / déjà rattachés). Ajouter `--apply`
 * pour exécuter réellement. **Idempotent** : un établissement est dédoublonné par
 * `UNIQUE(foyer_id, nom)` (re-trouvé par son nom par défaut) ; un contrat déjà
 * rattaché est ignoré (re-run sûr).
 *
 * ## Vérification post-run
 * En fin de course, le script re-liste les contrats et **compte ceux encore sans
 * établissement** : en mode `--apply`, un reste > 0 fait échouer le script (exit 1).
 *
 * ## Usage
 *   node scripts/backfill-etablissements.mjs            # dry-run (aucune écriture)
 *   node scripts/backfill-etablissements.mjs --apply    # exécute réellement
 *   BACKFILL_FOYER_URL=http://svc-foyer:3002/api \
 *   BACKFILL_PLANIFICATION_URL=http://svc-planification:3004/api \
 *     node scripts/backfill-etablissements.mjs --apply  # cible la pile interne
 *
 * Variables d'env :
 *  - `BACKFILL_FOYER_URL`           (défaut `http://localhost:3002/api`) — svc-foyer
 *  - `BACKFILL_PLANIFICATION_URL`   (défaut `http://localhost:3004/api`) — svc-planification
 */

const FOYER_URL = process.env.BACKFILL_FOYER_URL ?? 'http://localhost:3002/api';
const PLANIF_URL =
  process.env.BACKFILL_PLANIFICATION_URL ?? 'http://localhost:3004/api';
const APPLIQUER = process.argv.includes('--apply');

/**
 * Ancien mapping `mode → clé d'établissement` (cf. `MODE_VERS_CLE`). La clé est un
 * identifiant interne de **groupe** (pas stocké) servant à regrouper les contrats
 * d'un foyer partageant le même établissement par défaut.
 */
const MODE_VERS_CLE = {
  CRECHE_PSU: 'CRECHE_HIRONDELLES',
  PERISCOLAIRE: 'ABCM',
  CANTINE: 'ABCM',
  ALSH: 'ABCM',
};

/**
 * Gabarit d'établissement par défaut, par groupe : nom **placeholder** (renommé
 * ensuite par l'utilisateur) + coordonnées reprises des deux fiches globales
 * historiques (`etablissement_destinataire`, crèche RM-03 / ABCM RM-07).
 */
const GABARITS = {
  CRECHE_HIRONDELLES: {
    nom: 'Crèche Les Hirondelles',
    emailService: 'contact-creche@example.org',
    preavisRegle: { type: 'JOURS_OUVRES', valeur: 2 },
  },
  ABCM: {
    nom: 'École ABCM',
    emailService: 'contact-abcm@example.org',
    preavisRegle: { type: 'JOUR_HEURE', jour: 'JEUDI', heure: '12:00' },
  },
};

// --- Client HTTP ----------------------------------------------------------

/** Requête JSON vers `${base}${chemin}` ; renvoie `{ status, ok, charge }`. */
async function http(base, methode, chemin, corps) {
  const reponse = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : undefined,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const type = reponse.headers.get('content-type') ?? '';
  const charge = type.includes('application/json')
    ? await reponse.json().catch(() => undefined)
    : await reponse.text().catch(() => undefined);
  return { status: reponse.status, ok: reponse.ok, charge };
}

// --- Lectures -------------------------------------------------------------

/** Liste les foyers (svc-foyer) ; lève si la réponse n'est pas un tableau. */
async function listerFoyers() {
  const { ok, status, charge } = await http(FOYER_URL, 'GET', '/foyers');
  if (!ok || !Array.isArray(charge)) {
    throw new Error(
      `GET ${FOYER_URL}/foyers → HTTP ${status} (réponse inattendue)`,
    );
  }
  return charge;
}

/** Liste les contrats d'un foyer (svc-planification) ; `[]` si réponse inattendue. */
async function listerContrats(foyerId) {
  const { ok, charge } = await http(
    PLANIF_URL,
    'GET',
    `/contrats?foyer=${encodeURIComponent(foyerId)}`,
  );
  return ok && Array.isArray(charge) ? charge : [];
}

/** Liste les établissements d'un foyer (svc-planification) ; `[]` si inattendu. */
async function listerEtablissements(foyerId) {
  const { ok, charge } = await http(
    PLANIF_URL,
    'GET',
    `/etablissements?foyer=${encodeURIComponent(foyerId)}`,
  );
  return ok && Array.isArray(charge) ? charge : [];
}

// --- Regroupement ---------------------------------------------------------

/**
 * Regroupe les contrats d'un foyer par **clé de groupe** (`MODE_VERS_CLE`). Chaque
 * groupe porte l'ensemble des modes rencontrés (pour le champ `types` informatif de
 * l'établissement) et la liste des contrats. Les modes inconnus sont signalés à
 * part (jamais rattachés silencieusement).
 */
function regrouperParCle(contrats) {
  const groupes = new Map();
  const sansCle = [];
  for (const c of contrats) {
    const cle = MODE_VERS_CLE[c.mode];
    if (!cle) {
      sansCle.push(c);
      continue;
    }
    let g = groupes.get(cle);
    if (!g) {
      g = { cle, modes: new Set(), contrats: [] };
      groupes.set(cle, g);
    }
    g.modes.add(c.mode);
    g.contrats.push(c);
  }
  return { groupes, sansCle };
}

// --- Écritures (gardées par --apply) --------------------------------------

/**
 * Garantit l'établissement par défaut d'un groupe pour un foyer. Idempotent : on le
 * retrouve d'abord par son nom par défaut (`UNIQUE(foyer_id, nom)`) ; sinon on le
 * crée (`--apply`). En dry-run, renvoie `null` si l'établissement reste à créer (le
 * rattachement sera alors lui aussi simulé). Renvoie `{ id, cree }` ou `null`.
 */
async function garantirEtablissement(foyerId, groupe, etablissementsExistants) {
  const gabarit = GABARITS[groupe.cle];
  const deja = etablissementsExistants.find((e) => e.nom === gabarit.nom);
  if (deja) {
    console.log(
      `  • établissement « ${gabarit.nom} » déjà présent (${deja.id})`,
    );
    return { id: deja.id, cree: false };
  }
  if (!APPLIQUER) {
    console.log(
      `  • établissement « ${gabarit.nom} » à créer (dry-run) ` +
        `[types ${[...groupe.modes].join(', ')}]`,
    );
    return null;
  }
  const corps = {
    nom: gabarit.nom,
    emailService: gabarit.emailService,
    preavisRegle: gabarit.preavisRegle,
    types: [...groupe.modes],
  };
  const { ok, status } = await http(
    PLANIF_URL,
    'POST',
    `/etablissements?foyer=${encodeURIComponent(foyerId)}`,
    corps,
  );
  if (ok) {
    // Relit pour récupérer l'id (la création renvoie l'établissement, mais on
    // repasse par la liste pour rester robuste à une éventuelle course/relance).
    const apres = await listerEtablissements(foyerId);
    const cree = apres.find((e) => e.nom === gabarit.nom);
    if (!cree) {
      throw new Error(
        `établissement « ${gabarit.nom} » introuvable après POST`,
      );
    }
    console.log(`  • établissement « ${gabarit.nom} » CRÉÉ (${cree.id})`);
    return { id: cree.id, cree: true };
  }
  // 409 : course (déjà créé entre le GET et le POST) → on le relit.
  if (status === 409) {
    const apres = await listerEtablissements(foyerId);
    const cree = apres.find((e) => e.nom === gabarit.nom);
    if (cree) {
      console.log(
        `  • établissement « ${gabarit.nom} » déjà présent (course, ${cree.id})`,
      );
      return { id: cree.id, cree: false };
    }
  }
  throw new Error(
    `création établissement « ${gabarit.nom} » échouée (HTTP ${status})`,
  );
}

/**
 * Rattache un contrat à un établissement via l'endpoint chirurgical P5
 * (`PUT /contrats/:id/etablissement`) — non destructif sur les plannings. Renvoie
 * le verdict (`rattache` / `erreur`).
 */
async function rattacher(contrat, etablissementId) {
  const ref = `${contrat.enfant}/${contrat.mode} (${contrat.id})`;
  const { ok, status } = await http(
    PLANIF_URL,
    'PUT',
    `/contrats/${encodeURIComponent(contrat.id)}/etablissement`,
    { etablissementId },
  );
  if (ok) {
    console.log(`    ↳ RATTACHÉ — ${ref}`);
    return 'rattache';
  }
  console.error(`    ↳ ERREUR (HTTP ${status}) — ${ref}`);
  return 'erreur';
}

// --- Orchestration --------------------------------------------------------

/** Traite un foyer ; cumule les compteurs dans `compte`. */
async function traiterFoyer(foyer, compte) {
  const contrats = await listerContrats(foyer.id);
  if (contrats.length === 0) {
    return; // foyer sans contrat : rien à migrer.
  }
  console.log(`\n▶ Foyer ${foyer.id} — ${contrats.length} contrat(s)`);

  const { groupes, sansCle } = regrouperParCle(contrats);
  for (const c of sansCle) {
    console.error(
      `  • mode inconnu « ${c.mode} » (contrat ${c.id}) — non rattaché`,
    );
    compte.modeInconnu++;
  }

  const etablissementsExistants = await listerEtablissements(foyer.id);
  for (const groupe of groupes.values()) {
    const etab = await garantirEtablissement(
      foyer.id,
      groupe,
      etablissementsExistants,
    );
    if (etab?.cree) compte.etabCrees++;
    else if (etab) compte.etabReutilises++;
    else compte.etabACreer++;

    for (const c of groupe.contrats) {
      if (c.etablissementId) {
        compte.dejaRattaches++;
        continue;
      }
      if (!APPLIQUER || !etab) {
        console.log(
          `    ↳ à rattacher (dry-run) — ${c.enfant}/${c.mode} (${c.id})`,
        );
        compte.aRattacher++;
        continue;
      }
      compte[await rattacher(c, etab.id)]++;
    }
  }
}

/**
 * Vérification post-run : re-liste les contrats de chaque foyer et compte ceux
 * encore sans `etablissementId`. Renvoie le nombre de contrats non rattachés.
 */
async function verifier(foyers) {
  let restants = 0;
  for (const foyer of foyers) {
    const contrats = await listerContrats(foyer.id);
    restants += contrats.filter(
      (c) => MODE_VERS_CLE[c.mode] && !c.etablissementId,
    ).length;
  }
  return restants;
}

async function main() {
  console.log(
    `🔁 Back-fill établissements → foyers ${FOYER_URL} / planification ${PLANIF_URL} ` +
      `(${APPLIQUER ? 'APPLY — écriture réelle' : 'dry-run — aucune écriture'})`,
  );

  const foyers = await listerFoyers();
  console.log(`   ${foyers.length} foyer(s) à examiner.`);

  const compte = {
    etabCrees: 0,
    etabReutilises: 0,
    etabACreer: 0,
    rattache: 0,
    aRattacher: 0,
    dejaRattaches: 0,
    modeInconnu: 0,
    erreur: 0,
  };
  for (const foyer of foyers) {
    await traiterFoyer(foyer, compte);
  }

  console.log(
    `\n${APPLIQUER ? '✅ Terminé' : 'ℹ️  Dry-run terminé'} :\n` +
      `   établissements : ${
        APPLIQUER ? compte.etabCrees : compte.etabACreer
      } ${APPLIQUER ? 'créé(s)' : 'à créer'}, ${compte.etabReutilises} réutilisé(s)\n` +
      `   contrats : ${
        APPLIQUER ? compte.rattache : compte.aRattacher
      } ${APPLIQUER ? 'rattaché(s)' : 'à rattacher'}, ` +
      `${compte.dejaRattaches} déjà rattaché(s)\n` +
      `   anomalies : ${compte.modeInconnu} mode(s) inconnu(s), ${compte.erreur} erreur(s)`,
  );

  // Vérification post-run (lecture seule) : tout contrat de mode connu doit être lié.
  const restants = await verifier(foyers);
  console.log(
    `\n🔎 Vérification : ${restants} contrat(s) de mode connu encore sans établissement.`,
  );

  if (!APPLIQUER) {
    console.log('   Relancer avec --apply pour exécuter réellement.');
    return;
  }
  if (compte.erreur > 0 || compte.modeInconnu > 0 || restants > 0) {
    console.error(
      '\n❌ Back-fill incomplet (erreurs, modes inconnus, ou contrats non rattachés).',
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n❌ Échec du back-fill : ${e.message}`);
  process.exit(1);
});
