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
 * Port implémenté par le `ProjectionService` de chaque service. Le consommateur
 * mutualisé exige deux choses d'une projection : traiter un message, et **dire ce
 * qu'elle traite**.
 */
export interface ProjectionPort {
  traiter(stream: string, donnees: unknown): Promise<ResultatTraitement>;
  /**
   * Types d'événement que cette projection applique — donc les sujets NATS que
   * ses consommateurs durables doivent recevoir, et **eux seuls** (`AM-53`).
   *
   * Un durable sans filtre reçoit tout son stream : chaque type non géré retombe
   * dans le `default` du `switch`, ce qui vaut `IGNORE_TYPE_INCONNU`, donc une
   * ligne `dead_letter` **avec le payload en clair** — revenus et adresses
   * e-mail compris. Ce n'est pas une trace utile : c'est une copie que personne
   * ne lit, d'un événement qui n'a jamais été destiné à ce service.
   *
   * La liste est la **source** du filtre, pas son miroir : le test
   * `projection.types-geres.spec.ts` de chaque service exécute la projection sur
   * l'inventaire complet de ses streams amont et exige l'équivalence exacte avec
   * cette liste, dans les deux sens.
   */
  readonly typesGeres: readonly string[];
}

/**
 * Sujets d'un stream que la projection traite, dérivés de `typesGeres`. Le sujet
 * d'un message **est** son `type` (`OutboxRelay` publie sur `evt.type`), et le
 * premier segment du type nomme son contexte — donc son stream (`foyer.…` →
 * `FOYER`). Le rapprochement n'a pas d'autre table : c'est la convention de
 * nommage des contrats, tenue par `pnpm abonnements`.
 */
export function sujetsDuStream(
  typesGeres: readonly string[],
  stream: string,
): readonly string[] {
  return typesGeres.filter(
    (type) => type.split('.')[0]?.toUpperCase() === stream.toUpperCase(),
  );
}

/** Jeton d'injection du `ProjectionPort` (fourni par chaque service). */
export const PROJECTION_PORT = Symbol('PROJECTION_PORT');
