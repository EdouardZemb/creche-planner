import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  envoiRecapHebdo,
  envoiRecapParent,
  type EnvoiRecapHebdoRow,
  type StatutEnvoiRecap,
  type StatutEnvoiRecapParent,
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
 * État de livraison d'un parent lu depuis le ledger `envoi_recap_parent` (Lot L1) :
 * `statut` terminal ou `ECHEC`, et `essais` (compteur d'échecs, borné côté scheduler).
 * L'appelant s'en sert pour **sauter** un parent déjà servi et **abandonner** une
 * adresse ayant atteint le plafond de tentatives.
 */
export interface LivraisonParent {
  readonly statut: StatutEnvoiRecapParent;
  readonly essais: number;
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

  // --- Balayage des rappels périmés (Lot 6, GAP B) --------------------------

  /**
   * Slots **non terminés** dont la fenêtre d'envoi est **close** : `statut ∈
   * { A_ENVOYER, ECHEC }` **et** `semaine_iso < semaineCible`. `semaineCible` est la
   * semaine **encore en fenêtre** (`semaineProchaine(maintenant)` côté scheduler) :
   * seules les semaines **strictement passées** sont donc remontées — la semaine cible
   * courante (encore retentée par la phase envoi) est exclue.
   *
   * La comparaison `semaine_iso < semaineCible` sur le format `"YYYY-Www"` est
   * **lexicographique** et correcte, y compris au passage d'année
   * (`"2026-W52" < "2027-W01"`) : ne **pas** parser en nombres. Les états terminaux
   * (`ENVOYE`/`DRY_RUN`/`ABANDONNE`) sont exclus — d'où l'idempotence du balayage.
   */
  async slotsNonTerminesExpires(
    semaineCible: string,
  ): Promise<EnvoiRecapHebdoRow[]> {
    const nonTermines: StatutEnvoiRecap[] = ['A_ENVOYER', 'ECHEC'];
    return this.db
      .select()
      .from(envoiRecapHebdo)
      .where(
        and(
          inArray(envoiRecapHebdo.statut, nonTermines),
          lt(envoiRecapHebdo.semaineIso, semaineCible),
        ),
      );
  }

  /**
   * Transition vers l'état **terminal `ABANDONNE`** (Lot 6) : un rappel dont la fenêtre
   * est close et qui n'a jamais abouti. Compare-and-set gardé par
   * `statut IN ('A_ENVOYER','ECHEC')` : ne peut **jamais** écraser un `ENVOYE`/`DRY_RUN`
   * gagné entre le balayage et l'`update` (course), ni ré-abandonner un slot déjà
   * `ABANDONNE` (idempotence). `maj_le` prend l'instant de l'horloge injectée fourni par
   * le scheduler (jamais `new Date()` dans le raisonnement temporel).
   *
   * Renvoie les lignes **réellement transitionnées** (`returning`) : vide si la garde
   * n'a rien matché (course perdue / déjà abandonné). L'appelant n'émet son signal
   * terminal (log `error` + métrique) que pour une transition effective.
   */
  async marquerAbandonne(
    foyerId: string,
    semaineIso: string,
    maintenant: Date,
  ): Promise<EnvoiRecapHebdoRow[]> {
    const nonTermines: StatutEnvoiRecap[] = ['A_ENVOYER', 'ECHEC'];
    return this.db
      .update(envoiRecapHebdo)
      .set({ statut: 'ABANDONNE', majLe: maintenant })
      .where(
        and(
          eq(envoiRecapHebdo.foyerId, foyerId),
          eq(envoiRecapHebdo.semaineIso, semaineIso),
          inArray(envoiRecapHebdo.statut, nonTermines),
        ),
      )
      .returning();
  }

  // --- Ledger de livraison PAR PARENT (Lot L1) ------------------------------

  /**
   * Carte des livraisons du foyer/semaine indexée par `parentId` : pour chaque parent
   * déjà journalisé, son `statut` (terminal ou `ECHEC`) et son compteur d'`essais`.
   * Chargée **une fois** par slot dans le scheduler pour décider, sans lire ligne par
   * ligne, qui **sauter** (déjà livré) et qui **abandonner** (plafond atteint). Les
   * parents absents de la carte n'ont encore jamais été tentés.
   */
  async livraisonsParFoyerSemaine(
    foyerId: string,
    semaineIso: string,
  ): Promise<Map<string, LivraisonParent>> {
    const lignes = await this.db
      .select({
        parentId: envoiRecapParent.parentId,
        statut: envoiRecapParent.statut,
        essais: envoiRecapParent.essais,
      })
      .from(envoiRecapParent)
      .where(
        and(
          eq(envoiRecapParent.foyerId, foyerId),
          eq(envoiRecapParent.semaineIso, semaineIso),
        ),
      );
    return new Map(
      lignes.map((l) => [
        l.parentId,
        { statut: l.statut as StatutEnvoiRecapParent, essais: l.essais },
      ]),
    );
  }

  /**
   * Journalise la livraison **aboutie** d'un parent (`ENVOYE`/`DRY_RUN`) : fige `email`
   * (preuve), `message_id`, `envoye_le` et efface l'`erreur` d'un essai précédent.
   * Upsert gardé par compare-and-set `statut NOT IN ('ENVOYE','DRY_RUN')` : un parent
   * déjà servi (concurrence multi-réplica) n'est jamais rétrogradé ni relivré. Le
   * compteur `essais` n'est pas remis à zéro (trace du coût passé).
   */
  async marquerParentAbouti(
    foyerId: string,
    semaineIso: string,
    parentId: string,
    params: {
      readonly statut: Extract<StatutEnvoiRecapParent, 'ENVOYE' | 'DRY_RUN'>;
      readonly email: string;
      readonly messageId: string | null;
    },
  ): Promise<void> {
    const maintenant = new Date();
    await this.db
      .insert(envoiRecapParent)
      .values({
        foyerId,
        semaineIso,
        parentId,
        statut: params.statut,
        email: params.email,
        messageId: params.messageId,
        erreur: null,
        envoyeLe: maintenant,
      })
      .onConflictDoUpdate({
        target: [
          envoiRecapParent.foyerId,
          envoiRecapParent.semaineIso,
          envoiRecapParent.parentId,
        ],
        set: {
          statut: params.statut,
          email: params.email,
          messageId: params.messageId,
          erreur: null,
          envoyeLe: maintenant,
          majLe: maintenant,
        },
        setWhere: notInArray(envoiRecapParent.statut, ['ENVOYE', 'DRY_RUN']),
      });
  }

  /**
   * Journalise un **échec** de livraison d'un parent : bascule `ECHEC`, fige l'`erreur`
   * et **incrémente** `essais` (borne des ré-essais vers une adresse invalide). Upsert
   * gardé par le même compare-and-set : un `ECHEC` n'écrase jamais un envoi déjà abouti.
   * Premier échec ⇒ `essais = 1` ; échecs suivants ⇒ `essais = essais + 1`.
   */
  async marquerParentEchec(
    foyerId: string,
    semaineIso: string,
    parentId: string,
    params: { readonly email: string; readonly erreur: string },
  ): Promise<void> {
    await this.db
      .insert(envoiRecapParent)
      .values({
        foyerId,
        semaineIso,
        parentId,
        statut: 'ECHEC',
        email: params.email,
        erreur: params.erreur,
        essais: 1,
      })
      .onConflictDoUpdate({
        target: [
          envoiRecapParent.foyerId,
          envoiRecapParent.semaineIso,
          envoiRecapParent.parentId,
        ],
        set: {
          statut: 'ECHEC',
          email: params.email,
          erreur: params.erreur,
          essais: sql`${envoiRecapParent.essais} + 1`,
          majLe: new Date(),
        },
        setWhere: notInArray(envoiRecapParent.statut, ['ENVOYE', 'DRY_RUN']),
      });
  }
}
