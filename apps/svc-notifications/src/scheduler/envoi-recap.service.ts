import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  envoiRecapHebdo,
  type EnvoiRecapHebdoRow,
  type StatutEnvoiRecap,
} from '../database/schema.js';

/**
 * Issue **aboutie** d'un envoi de récap (statut terminal `ENVOYE`/`DRY_RUN` + preuve).
 * `ENVOYE` = au moins un transport SMTP réel a répondu ; `DRY_RUN` = tentative
 * neutralisée par le garde-fou du mailer. `destinataires` fige les e-mails visés au
 * dernier essai.
 */
export interface IssueEnvoiRecap {
  readonly statut: Extract<StatutEnvoiRecap, 'ENVOYE' | 'DRY_RUN'>;
  readonly messageId: string | null;
  readonly destinataires: readonly string[];
}

/**
 * Accès au journal d'**état d'envoi du récap du mardi** (`envoi_recap_hebdo`, Lot 3).
 * Isole les 3 opérations du découplage création/envoi : **réserver** un slot
 * `A_ENVOYER` (idempotent), **lister** les lignes à (re)tenter d'une semaine, et
 * **transitionner** une ligne vers un état abouti ou en échec. Toutes les transitions
 * sont des compare-and-set gardés par `statut <> 'ENVOYE'` : une ligne déjà aboutie ne
 * redescend jamais (idempotence des ticks / robustesse aux rejeux).
 */
@Injectable()
export class EnvoiRecapService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Réserve (phase **création**) un slot `A_ENVOYER` pour le couple foyer/semaine.
   * Idempotent via `onConflictDoNothing` sur la clé primaire : un second tick — ou un
   * rejeu après reprise — n'écrase pas un slot déjà réservé (fût-il en `ECHEC`).
   */
  async reserver(foyerId: string, semaineIso: string): Promise<void> {
    await this.db
      .insert(envoiRecapHebdo)
      .values({ foyerId, semaineIso, statut: 'A_ENVOYER' })
      .onConflictDoNothing({
        target: [envoiRecapHebdo.foyerId, envoiRecapHebdo.semaineIso],
      });
  }

  /**
   * Lignes d'une semaine restant à (re)tenter : `A_ENVOYER` (jamais parti) ou `ECHEC`
   * (à réessayer tant que la fenêtre est ouverte). Les `ENVOYE`/`DRY_RUN` (états
   * terminaux) sont exclus — d'où l'idempotence de la phase envoi.
   */
  async aRetenter(semaineIso: string): Promise<EnvoiRecapHebdoRow[]> {
    const aRetenter: StatutEnvoiRecap[] = ['A_ENVOYER', 'ECHEC'];
    return this.db
      .select()
      .from(envoiRecapHebdo)
      .where(
        and(
          eq(envoiRecapHebdo.semaineIso, semaineIso),
          inArray(envoiRecapHebdo.statut, aRetenter),
        ),
      );
  }

  /**
   * Transition vers un état **abouti** (`ENVOYE`/`DRY_RUN`) : fige `message_id`,
   * `destinataires`, `envoye_le` et efface l'`erreur` d'un essai précédent.
   * Compare-and-set `statut <> 'ENVOYE'` : une ligne déjà envoyée n'est pas rétrogradée.
   */
  async marquerAbouti(
    foyerId: string,
    semaineIso: string,
    issue: IssueEnvoiRecap,
  ): Promise<void> {
    await this.db
      .update(envoiRecapHebdo)
      .set({
        statut: issue.statut,
        messageId: issue.messageId,
        destinataires: [...issue.destinataires],
        erreur: null,
        envoyeLe: new Date(),
        majLe: new Date(),
      })
      .where(
        and(
          eq(envoiRecapHebdo.foyerId, foyerId),
          eq(envoiRecapHebdo.semaineIso, semaineIso),
          ne(envoiRecapHebdo.statut, 'ENVOYE'),
        ),
      );
  }

  /**
   * Transition vers `ECHEC` (le mailer a levé) : conserve la ligne comme trace
   * diagnosticable (`erreur`), sans horodater `envoye_le`. Compare-and-set
   * `statut <> 'ENVOYE'` : un `ECHEC` ne peut jamais écraser un envoi déjà abouti.
   */
  async marquerEchec(
    foyerId: string,
    semaineIso: string,
    erreur: string,
  ): Promise<void> {
    await this.db
      .update(envoiRecapHebdo)
      .set({ statut: 'ECHEC', erreur, majLe: new Date() })
      .where(
        and(
          eq(envoiRecapHebdo.foyerId, foyerId),
          eq(envoiRecapHebdo.semaineIso, semaineIso),
          ne(envoiRecapHebdo.statut, 'ENVOYE'),
        ),
      );
  }
}
