/**
 * Contrat de traitement partagé entre le consommateur JetStream mutualisé
 * (`libs/nest-commons`) et le `ProjectionService` de chaque service. Remplace
 * l'ancien `boolean` (« appliqué / à re-livrer ») par un résultat **discriminé**
 * qui rend explicite ce que le consommateur doit faire du message :
 *
 * - `TRAITE` : appliqué (ou ignoré proprement, ex. type non consommé par ce
 *   service, ou doublon idempotent) → **ACK**, aucune trace.
 * - `IGNORE_ENVELOPPE_INVALIDE` : l'enveloppe décodée n'a pas de champ `type`
 *   exploitable → **dead-letter** (`ENVELOPPE_INVALIDE`) puis **ACK**.
 * - `IGNORE_TYPE_INCONNU` : `type` présent mais non géré → **dead-letter**
 *   (`TYPE_INCONNU`) puis **ACK**.
 * - `ECHEC_TRANSITOIRE` : erreur transitoire (base indisponible, ordre des
 *   événements, repli injoignable…) → **NAK** (re-livraison différée), sauf
 *   épuisement des livraisons (cf. `MAX_LIVRAISONS`) → dead-letter + `term()`.
 */
export type ResultatTraitement =
  | 'TRAITE'
  | 'IGNORE_ENVELOPPE_INVALIDE'
  | 'IGNORE_TYPE_INCONNU'
  | 'ECHEC_TRANSITOIRE';

/**
 * Raison d'enregistrement en dead-letter. `PARSE_KO` et `MAX_LIVRAISONS` sont
 * décidés **dans la lib** (le premier au décodage, le second à l'épuisement des
 * livraisons) ; `ENVELOPPE_INVALIDE`/`TYPE_INCONNU` dérivent du `ResultatTraitement`
 * renvoyé par la projection.
 */
export type RaisonRejet =
  'PARSE_KO' | 'ENVELOPPE_INVALIDE' | 'TYPE_INCONNU' | 'MAX_LIVRAISONS';

/** Un abonnement : stream JetStream amont et nom du consommateur durable. */
export interface Abonnement {
  readonly stream: string;
  readonly durable: string;
}

/**
 * Port implémenté par le `ProjectionService` de chaque service. La seule chose
 * que le consommateur mutualisé exige d'une projection.
 */
export interface ProjectionPort {
  traiter(stream: string, donnees: unknown): Promise<ResultatTraitement>;
}

/** Jeton d'injection du `ProjectionPort` (fourni par chaque service). */
export const PROJECTION_PORT = Symbol('PROJECTION_PORT');
