#!/usr/bin/env node
// @ts-check
/**
 * Back-fill du lien **contrat → enfant** des contrats **existants** (référence
 * `contrat.enfant_id` vers l'agrégat enfant de `svc-foyer`). La colonne
 * `contrat.enfant_id` a été ajoutée NULLABLE (migration 0005) : les contrats déjà
 * en base ne référencent l'enfant que par son **prénom libre** (`contrat.enfant`).
 * Ce script rapproche chaque contrat orphelin de l'enfant de son foyer portant le
 * même prénom, puis rattache via l'endpoint chirurgical.
 *
 * ## Rapprochement par prénom, AU SEIN du foyer
 * Pour chaque foyer : on liste ses enfants (`svc-foyer`) et ses contrats
 * (`svc-planification`). Un contrat sans `enfantId` est rapproché de l'enfant dont
 * `prenom === contrat.enfant` (comparaison exacte). **Garde d'ambiguïté** : si
 * plusieurs enfants du foyer portent ce prénom (0 ou > 1 correspondance), le
 * contrat est signalé et N'EST PAS rattaché — arbitrage humain requis.
 *
 * ## Pourquoi via les services internes (et pas du SQL brut)
 * Comme `backfill-etablissements.mjs` : le **rattachement** passe par
 * `PUT /contrats/:id/enfant` (endpoint chirurgical) qui ne touche QUE `enfant_id`,
 * **n'écrase pas** le contrat, **n'invalide pas** ses plannings, et émet
 * `ContratModifie` pour les read-models aval. Un `UPDATE` SQL brut ne propagerait
 * PAS l'événement : à proscrire.
 *
 * ## Sécurité : dry-run par défaut
 * Sans `--apply`, le script **n'écrit rien** : il affiche le plan (contrats à
 * rattacher / déjà rattachés / ambigus). Ajouter `--apply` pour exécuter
 * réellement. **Idempotent** : un contrat déjà rattaché est ignoré ; l'endpoint
 * est lui-même no-op si le lien est déjà posé (re-run sûr).
 *
 * ## Vérification post-run
 * En fin de course, le script re-liste les contrats et **compte ceux encore sans
 * enfant** : en mode `--apply`, un reste > 0 fait échouer le script (exit 1).
 * (La promotion NOT NULL de `enfant_id` est une migration différée, à n'embarquer
 * qu'une fois ce script passé en prod — même séquence que `etablissement_id`.)
 *
 * ## Usage
 *   node scripts/backfill-enfants.mjs            # dry-run (aucune écriture)
 *   node scripts/backfill-enfants.mjs --apply    # exécute réellement
 *   BACKFILL_FOYER_URL=http://svc-foyer:3002/api \
 *   BACKFILL_PLANIFICATION_URL=http://svc-planification:3004/api \
 *     node scripts/backfill-enfants.mjs --apply  # cible la pile interne
 *
 * Variables d'env :
 *  - `BACKFILL_FOYER_URL`           (défaut `http://localhost:3002/api`) — svc-foyer
 *  - `BACKFILL_PLANIFICATION_URL`   (défaut `http://localhost:3004/api`) — svc-planification
 */

const FOYER_URL = process.env.BACKFILL_FOYER_URL ?? 'http://localhost:3002/api';
const PLANIF_URL =
  process.env.BACKFILL_PLANIFICATION_URL ?? 'http://localhost:3004/api';
const APPLIQUER = process.argv.includes('--apply');

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

/** Liste les enfants d'un foyer (svc-foyer) ; `[]` si réponse inattendue. */
async function listerEnfants(foyerId) {
  const { ok, charge } = await http(
    FOYER_URL,
    'GET',
    `/foyers/${encodeURIComponent(foyerId)}/enfants`,
  );
  return ok && Array.isArray(charge) ? charge : [];
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

// --- Écritures (gardées par --apply) --------------------------------------

/**
 * Rattache un contrat à son enfant via l'endpoint chirurgical
 * (`PUT /contrats/:id/enfant`) — non destructif sur les plannings. Renvoie le
 * verdict (`rattache` / `erreur`).
 */
async function rattacher(contrat, enfantId) {
  const ref = `${contrat.enfant}/${contrat.mode} (${contrat.id})`;
  const { ok, status } = await http(
    PLANIF_URL,
    'PUT',
    `/contrats/${encodeURIComponent(contrat.id)}/enfant`,
    { enfantId },
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

  const enfants = await listerEnfants(foyer.id);
  for (const c of contrats) {
    if (c.enfantId) {
      compte.dejaRattaches++;
      continue;
    }
    const candidats = enfants.filter((e) => e.prenom === c.enfant);
    if (candidats.length !== 1) {
      // Garde d'ambiguïté : aucun enfant de ce prénom, ou plusieurs — on ne
      // devine pas (arbitrage humain : renommer l'enfant ou rattacher à la main).
      console.error(
        `  • AMBIGU (${candidats.length} enfant(s) « ${c.enfant} ») — ` +
          `contrat ${c.id} (${c.mode}) non rattaché`,
      );
      compte.ambigus++;
      continue;
    }
    const enfant = candidats[0];
    if (!APPLIQUER) {
      console.log(
        `  • à rattacher (dry-run) — ${c.enfant}/${c.mode} (${c.id}) → enfant ${enfant.id}`,
      );
      compte.aRattacher++;
      continue;
    }
    compte[await rattacher(c, enfant.id)]++;
  }
}

/**
 * Vérification post-run : re-liste les contrats de chaque foyer et compte ceux
 * encore sans `enfantId`. Renvoie le nombre de contrats non rattachés.
 */
async function verifier(foyers) {
  let restants = 0;
  for (const foyer of foyers) {
    const contrats = await listerContrats(foyer.id);
    restants += contrats.filter((c) => !c.enfantId).length;
  }
  return restants;
}

async function main() {
  console.log(
    `🔁 Back-fill enfants → foyers ${FOYER_URL} / planification ${PLANIF_URL} ` +
      `(${APPLIQUER ? 'APPLY — écriture réelle' : 'dry-run — aucune écriture'})`,
  );

  const foyers = await listerFoyers();
  console.log(`   ${foyers.length} foyer(s) à examiner.`);

  const compte = {
    rattache: 0,
    aRattacher: 0,
    dejaRattaches: 0,
    ambigus: 0,
    erreur: 0,
  };
  for (const foyer of foyers) {
    await traiterFoyer(foyer, compte);
  }

  console.log(
    `\n${APPLIQUER ? '✅ Terminé' : 'ℹ️  Dry-run terminé'} :\n` +
      `   contrats : ${
        APPLIQUER ? compte.rattache : compte.aRattacher
      } ${APPLIQUER ? 'rattaché(s)' : 'à rattacher'}, ` +
      `${compte.dejaRattaches} déjà rattaché(s)\n` +
      `   anomalies : ${compte.ambigus} ambigu(s), ${compte.erreur} erreur(s)`,
  );

  // Vérification post-run (lecture seule) : tout contrat doit être lié.
  const restants = await verifier(foyers);
  console.log(
    `\n🔎 Vérification : ${restants} contrat(s) encore sans enfant rattaché.`,
  );

  if (!APPLIQUER) {
    console.log('   Relancer avec --apply pour exécuter réellement.');
    return;
  }
  if (compte.erreur > 0 || compte.ambigus > 0 || restants > 0) {
    console.error(
      '\n❌ Back-fill incomplet (erreurs, ambiguïtés, ou contrats non rattachés).',
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n❌ Échec du back-fill : ${e.message}`);
  process.exit(1);
});
