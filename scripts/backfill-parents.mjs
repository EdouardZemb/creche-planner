#!/usr/bin/env node
// @ts-check
/**
 * Back-fill ADMIN des parents des foyers **existants** (feature « parents du
 * foyer », option b-ii — provisioning admin). Associe une adresse e-mail parent
 * à chaque foyer déjà en base, **sans quoi** ces foyers deviendraient
 * inaccessibles une fois l'enforcement d'appartenance activé (PR7).
 *
 * ## Pourquoi via svc-foyer (et pas le BFF)
 * On cible **svc-foyer directement** (`/api/foyers/:id/parents`), pas la gateway :
 *  - la CRUD parents du BFF est désormais `@AdminSeulement()` (PR6) — la
 *    contourner suppose de forger une identité admin, impossible en prod ;
 *  - l'autorisation est **centralisée au BFF** ; les services aval restent
 *    derrière lui (réseau privé). Le back-fill est une **opération d'infra
 *    admin** exécutée au plus près de svc-foyer (SSH / réseau interne).
 * Passer par `FoyerService.ajouterParent` (son endpoint HTTP) garantit l'émission
 * des **événements outbox** `foyer.ParentAjoute.v1` → la projection notifications
 * (`foyer_parent`) et la résolution `email → {foyers}` se mettent à jour.
 *
 * ## Sécurité : dry-run par défaut
 * Sans `--apply`, le script **n'écrit rien** : il affiche le plan (à créer /
 * déjà présent / conflit). Ajouter `--apply` pour exécuter réellement.
 * **Idempotent** : un e-mail déjà parent **actif** du foyer est ignoré (re-run
 * sûr). L'e-mail étant **globalement unique** (identifiant de login), réutiliser
 * une adresse déjà rattachée à un AUTRE foyer renvoie un 409 — signalé, non fatal.
 *
 * ## Fichier de correspondance (gitignoré)
 * JSON : tableau d'objets `{ foyerId, email, prenom?, nom?, principal?, ordre? }`.
 * Chemin via `--file <chemin>` (défaut `scripts/parents-backfill.json`).
 *   [
 *     { "foyerId": "…uuid…", "email": "parent@example.com",
 *       "prenom": "Camille", "nom": "Martin", "principal": true }
 *   ]
 * Astuce pour lister les foyers à back-filler : `GET /api/foyers` sur svc-foyer.
 *
 * ## Usage
 *   node scripts/backfill-parents.mjs                 # dry-run, fichier par défaut
 *   node scripts/backfill-parents.mjs --file mon.json # dry-run, fichier choisi
 *   node scripts/backfill-parents.mjs --apply         # exécute réellement
 *   BACKFILL_BASE_URL=http://svc-foyer:3002/api node scripts/backfill-parents.mjs --apply
 *
 * Variable d'env `BACKFILL_BASE_URL` pour cibler une autre instance svc-foyer
 * (défaut `http://localhost:3002/api`).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute } from 'node:path';

const BASE_URL = process.env.BACKFILL_BASE_URL ?? 'http://localhost:3002/api';
const ICI = dirname(fileURLToPath(import.meta.url));
const APPLIQUER = process.argv.includes('--apply');

/** Résout le chemin du fichier de correspondance (`--file`, sinon défaut). */
function cheminFichier() {
  const i = process.argv.indexOf('--file');
  const brut = i >= 0 ? process.argv[i + 1] : undefined;
  if (!brut) return join(ICI, 'parents-backfill.json');
  return isAbsolute(brut) ? brut : join(process.cwd(), brut);
}

// --- Client HTTP ----------------------------------------------------------

async function http(methode, chemin, corps) {
  const reponse = await fetch(`${BASE_URL}${chemin}`, {
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

// --- Validation du fichier ------------------------------------------------

/** Valide une entrée de correspondance ; renvoie un message d'erreur ou null. */
function erreurEntree(e, i) {
  if (typeof e !== 'object' || e === null) return `entrée #${i} : pas un objet`;
  if (typeof e.foyerId !== 'string' || e.foyerId.trim() === '')
    return `entrée #${i} : foyerId manquant`;
  if (typeof e.email !== 'string' || !e.email.includes('@'))
    return `entrée #${i} : email invalide`;
  return null;
}

/** Charge et valide le fichier de correspondance (lève si introuvable/invalide). */
async function chargerEntrees(chemin) {
  let texte;
  try {
    texte = await readFile(chemin, 'utf8');
  } catch {
    throw new Error(
      `Fichier de correspondance introuvable : ${chemin}\n` +
        `Créez-le (tableau JSON { foyerId, email, … }) ou passez --file <chemin>.`,
    );
  }
  const data = JSON.parse(texte);
  if (!Array.isArray(data))
    throw new Error('Le fichier doit être un tableau JSON.');
  const erreurs = data.map(erreurEntree).filter((m) => m !== null);
  if (erreurs.length) {
    throw new Error(`Entrées invalides :\n  - ${erreurs.join('\n  - ')}`);
  }
  return data;
}

// --- Orchestration --------------------------------------------------------

/** Un e-mail est-il déjà parent ACTIF du foyer ? (idempotence, insensible casse) */
async function dejaParent(foyerId, email) {
  const { ok, charge } = await http(
    'GET',
    `/foyers/${encodeURIComponent(foyerId)}/parents`,
  );
  if (!ok || !Array.isArray(charge)) return false;
  const cible = email.trim().toLowerCase();
  return charge.some(
    (p) => typeof p?.email === 'string' && p.email.toLowerCase() === cible,
  );
}

/** Traite une entrée ; renvoie le verdict (`ajoute`/`present`/`conflit`/`erreur`). */
async function traiter(e) {
  const ref = `${e.email} → foyer ${e.foyerId}`;
  if (await dejaParent(e.foyerId, e.email)) {
    console.log(`• déjà présent — ${ref}`);
    return 'present';
  }
  if (!APPLIQUER) {
    console.log(`• à créer (dry-run) — ${ref}`);
    return 'ajoute';
  }
  const corps = {
    email: e.email,
    ...(e.prenom ? { prenom: e.prenom } : {}),
    ...(e.nom ? { nom: e.nom } : {}),
    ...(typeof e.principal === 'boolean' ? { principal: e.principal } : {}),
    ...(typeof e.ordre === 'number' ? { ordre: e.ordre } : {}),
  };
  const { status, ok } = await http(
    'POST',
    `/foyers/${encodeURIComponent(e.foyerId)}/parents`,
    corps,
  );
  if (ok) {
    console.log(`• AJOUTÉ — ${ref}`);
    return 'ajoute';
  }
  if (status === 409) {
    console.error(
      `• CONFLIT (409) — ${ref} : e-mail déjà utilisé ailleurs ` +
        `(unicité globale). Choisir une autre adresse pour ce foyer.`,
    );
    return 'conflit';
  }
  console.error(`• ERREUR (HTTP ${status}) — ${ref}`);
  return 'erreur';
}

async function main() {
  const chemin = cheminFichier();
  console.log(
    `🔁 Back-fill parents → ${BASE_URL} ` +
      `(${APPLIQUER ? 'APPLY — écriture réelle' : 'dry-run — aucune écriture'})`,
  );
  console.log(`   Correspondance : ${chemin}\n`);

  const entrees = await chargerEntrees(chemin);
  const compte = { ajoute: 0, present: 0, conflit: 0, erreur: 0 };
  for (const e of entrees) {
    compte[await traiter(e)]++;
  }

  console.log(
    `\n${APPLIQUER ? '✅ Terminé' : 'ℹ️  Dry-run terminé'} : ` +
      `${compte.ajoute} ${APPLIQUER ? 'ajouté(s)' : 'à ajouter'}, ` +
      `${compte.present} déjà présent(s), ${compte.conflit} conflit(s), ` +
      `${compte.erreur} erreur(s).`,
  );
  if (!APPLIQUER) {
    console.log('   Relancer avec --apply pour exécuter réellement.');
  }
  if (compte.conflit > 0 || compte.erreur > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n❌ Échec du back-fill : ${e.message}`);
  process.exit(1);
});
