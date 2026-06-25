// @ts-check
/**
 * Garde de compatibilité de contrats — surrogate `can-i-deploy` en pacts FICHIERS.
 *
 * Contexte (DEC-06) : faute d'infrastructure de Pact Broker serveur dans ce
 * contexte offline/local (cf. docs/adr/0005-registre-de-contrats.md), la
 * compatibilité de contrats est gardée par les pacts COMMITÉS dans `/pacts/`.
 * La vérification provider (specs `*.provider.pact.spec.ts`, exécutées par le
 * job `ci` avec ses 4 Postgres) prouve déjà que chaque provider HONORE le pact.
 *
 * Ce script ajoute la couche « puis-je déployer ? » que le job `ci` ne couvre
 * pas : il vérifie que la MATRICE de contrats attendue est complète et cohérente
 * AVANT de construire/publier des images. Il échoue si :
 *   - un pact attendu (api-gateway ↔ provider) est manquant ;
 *   - un fichier pact référence un consommateur/provider inconnu ;
 *   - un pact est vide (aucune interaction) ou JSON invalide.
 *
 * Limites assumées (vs un vrai broker) : pas de matrice de versions déployées,
 * pas de tag d'environnement, pas d'historique `verificationResults`. Voir ADR-0005.
 *
 * Sortie : code 0 si déployable, code 1 sinon. Aucune dépendance npm (Node pur).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RACINE = process.cwd();
const PACTS_DIR = join(RACINE, 'pacts');

// Le seul consommateur HTTP est la gateway (BFF). Chaque service métier qui
// expose une API consommée par la gateway DOIT avoir un pact provider.
const CONSOMMATEUR_ATTENDU = 'api-gateway';
const PROVIDERS_ATTENDUS = [
  'svc-foyer',
  'svc-referentiel',
  'svc-planification',
  'svc-tarification',
  'svc-notifications',
];

/** @type {string[]} */
const erreurs = [];

let fichiers = [];
try {
  fichiers = readdirSync(PACTS_DIR).filter((f) => f.endsWith('.json'));
} catch {
  erreurs.push(`Répertoire de pacts introuvable : ${PACTS_DIR}`);
}

/** @type {Set<string>} paires "consommateur->provider" présentes */
const pairesPresentes = new Set();

for (const fichier of fichiers) {
  const chemin = join(PACTS_DIR, fichier);
  let pact;
  try {
    pact = JSON.parse(readFileSync(chemin, 'utf8'));
  } catch (e) {
    erreurs.push(`Pact illisible (JSON invalide) : ${fichier} — ${e.message}`);
    continue;
  }

  const consommateur = pact?.consumer?.name;
  const provider = pact?.provider?.name;
  const interactions = Array.isArray(pact?.interactions)
    ? pact.interactions
    : [];

  if (consommateur !== CONSOMMATEUR_ATTENDU) {
    erreurs.push(
      `Pact ${fichier} : consommateur inattendu "${consommateur}" (attendu "${CONSOMMATEUR_ATTENDU}").`,
    );
  }
  if (!PROVIDERS_ATTENDUS.includes(provider)) {
    erreurs.push(
      `Pact ${fichier} : provider inconnu "${provider}" (connus : ${PROVIDERS_ATTENDUS.join(', ')}).`,
    );
  }
  if (interactions.length === 0) {
    erreurs.push(`Pact ${fichier} : aucune interaction — contrat vide.`);
  }

  if (consommateur && provider) {
    pairesPresentes.add(`${consommateur}->${provider}`);
  }
}

// Toute paire attendue doit avoir son pact (un provider non couvert = trou de contrat).
for (const provider of PROVIDERS_ATTENDUS) {
  const paire = `${CONSOMMATEUR_ATTENDU}->${provider}`;
  if (!pairesPresentes.has(paire)) {
    erreurs.push(`Pact manquant pour la paire attendue : ${paire}.`);
  }
}

if (erreurs.length > 0) {
  console.error('can-i-deploy : INCOMPATIBLE — déploiement bloqué.\n');
  for (const e of erreurs) console.error(`  ✗ ${e}`);
  console.error(
    '\nVoir docs/adr/0005-registre-de-contrats.md (garde de contrats en pacts fichiers).',
  );
  process.exit(1);
}

console.log(
  'can-i-deploy : COMPATIBLE — toutes les paires de contrats sont présentes et cohérentes.',
);
for (const paire of [...pairesPresentes].sort()) {
  console.log(`  ✓ ${paire}`);
}
