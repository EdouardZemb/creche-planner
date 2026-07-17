/**
 * **Port de résolution ressource → foyer** (chantier « fondations backend », lot 4).
 *
 * Le scoping par ressource ({@link ScopeFoyerGuard}) revérifie, dans **chaque
 * service** et contre ses **propres tables**, qu'une requête ne touche que des
 * données du/des foyer(s) couverts par l'assertion. Pour les routes qui ne portent
 * pas le `foyerId` directement (`/contrats/:id`, `/etablissements/:id`,
 * `/moi/notifications?parent=`…), le service doit résoudre l'id de la ressource en
 * sa **portée** — c'est le rôle de ce port, implémenté par chaque service (requêtes
 * Drizzle `select foyer_id from … where id = …`).
 *
 * **Ne jamais** y résoudre « quels foyers a ce parent » : c'est le rôle de la
 * gateway, transporté par l'assertion (`foyers`). Ce port résout uniquement « à quel
 * foyer (ou quel propriétaire) appartient CETTE ressource ».
 */

/**
 * Portée d'une ressource résolue localement, comparée à l'assertion par le guard :
 * - `foyer` : la ressource appartient à `foyerId` → exigence `foyerId ∈ assertion.foyers` ;
 * - `proprietaire` : la ressource appartient au parent d'e-mail `email` → exigence
 *   `email === assertion.email` (insensible à la casse, convention `lower(email)` du
 *   repo). Utilisé pour l'inbox in-app, scopée au parent lui-même (pas au foyer).
 *
 * Union discriminée (état invalide irreprésentable) — le guard traite les deux cas
 * de façon exhaustive.
 */
export type PorteeRessource =
  | { readonly type: 'foyer'; readonly foyerId: string }
  | { readonly type: 'proprietaire'; readonly email: string };

/**
 * Port fourni par chaque service pour résoudre l'id d'une ressource **locale** en sa
 * {@link PorteeRessource}. `ressource` est le nom déclaré par le décorateur
 * (`@ScopeFoyerInterServices({ resoudre: 'contrat', … })`) ; `id` la valeur extraite
 * de la requête (param/query/body).
 *
 * Renvoie **`null`** si la ressource n'existe pas : le guard laisse alors le handler
 * répondre son **404** habituel (jamais un 403, qui révélerait l'existence). Lève une
 * erreur de configuration si le nom de ressource est inconnu du service (erreur de
 * programmation, pas d'utilisateur).
 */
export interface ResolveurFoyerRessource {
  resoudre(ressource: string, id: string): Promise<PorteeRessource | null>;
}

/** Jeton d'injection du {@link ResolveurFoyerRessource} d'un service. */
export const RESOLVEUR_FOYER_RESSOURCE = Symbol('RESOLVEUR_FOYER_RESSOURCE');
