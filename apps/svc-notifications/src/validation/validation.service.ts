import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  notificationHebdo,
  STATUTS_NOTIFICATION,
  TYPE_VALIDATION_HEBDO,
  type NotificationHebdoRow,
  type StatutNotification,
} from '../database/schema.js';
import { PlanificationClient } from '../fallback/planification.client.js';
import {
  aDesModifs,
  calculerDelta,
  extraireSemaine,
  type DeltaModifs,
} from './validation.diff.js';
import { joursDeLaSemaine, moisDeLaSemaine } from './semaine.js';
import type {
  NotificationAValiderVue,
  ValidationResultat,
} from './validation.dto.js';

/** Paramètres de notification d'une semaine (appelé par le scheduler du Lot 5). */
export interface NotifierParams {
  readonly contratId: string;
  readonly foyerId: string;
  readonly semaineIso: string;
}

/**
 * Cœur de la **validation hebdomadaire** (Lot 4). Le planning amont est sans notion
 * de semaine : ce service fige le snapshot des jours de la semaine N+1 à la
 * notification, puis calcule le `delta_modifs` à la validation en **relisant** le
 * planning du/des mois recouverts. La clé `UNIQUE(contrat_id, semaine_iso, type)`
 * rend la notification idempotente (scheduler multi-réplica) ; la validation l'est
 * aussi (revalider renvoie l'état déjà figé sans recalcul).
 */
@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly planification: PlanificationClient,
  ) {}

  /**
   * Notifie une semaine à valider : fige le snapshot des jours de la semaine et
   * insère une ligne `A_VALIDER`. Idempotent via `onConflictDoNothing` sur la clé
   * d'unicité — un second tick (ou une seconde réplica) ne crée pas de doublon ni
   * n'écrase un snapshot déjà posé. Utilisé par le scheduler du mardi (Lot 5).
   */
  async notifier(params: NotifierParams): Promise<void> {
    const { contratId, foyerId, semaineIso } = params;
    const plannings = await this.relire(contratId, semaineIso);
    const snapshot = extraireSemaine(
      plannings ?? [],
      joursDeLaSemaine(semaineIso),
    );
    await this.db
      .insert(notificationHebdo)
      .values({
        id: randomUUID(),
        contratId,
        foyerId,
        semaineIso,
        type: TYPE_VALIDATION_HEBDO,
        statut: 'A_VALIDER',
        snapshot,
      })
      .onConflictDoNothing({
        target: [
          notificationHebdo.contratId,
          notificationHebdo.semaineIso,
          notificationHebdo.type,
        ],
      });
    this.logger.log(
      `Semaine ${semaineIso} notifiée pour le contrat ${contratId}`,
    );
  }

  /** Liste les semaines `A_VALIDER` d'un foyer (indicateur in-app), triées par semaine. */
  async aValider(foyerId: string): Promise<NotificationAValiderVue[]> {
    const lignes = await this.db
      .select()
      .from(notificationHebdo)
      .where(
        and(
          eq(notificationHebdo.foyerId, foyerId),
          eq(notificationHebdo.statut, 'A_VALIDER'),
        ),
      );
    return lignes
      .map((l) => this.versVue(l))
      .sort((a, b) => a.semaineIso.localeCompare(b.semaineIso));
  }

  /**
   * Valide une semaine : relit le planning, diffe avec le snapshot et fixe le statut
   * (`VALIDEE` ou `VALIDEE_AVEC_MODIFS`). **Idempotent** : si la semaine est déjà
   * validée, renvoie l'état figé sans recalcul. `404` si la semaine n'a jamais été
   * notifiée. Si la relecture est indisponible (planification injoignable), le
   * snapshot fait foi → aucune modif détectée plutôt qu'un faux positif.
   */
  async valider(
    contratId: string,
    semaineIso: string,
  ): Promise<ValidationResultat> {
    const ligne = await this.ligne(contratId, semaineIso);
    if (!ligne) {
      throw new NotFoundException([
        {
          champ: 'semaineIso',
          message: `aucune semaine ${semaineIso} à valider pour le contrat ${contratId}`,
        },
      ]);
    }

    // Idempotence : une semaine déjà validée renvoie son résultat figé.
    if (ligne.statut !== 'A_VALIDER') {
      return {
        contratId,
        semaineIso,
        statut: this.statut(ligne.statut),
        deltaModifs: ligne.deltaModifs ?? null,
      };
    }

    const delta = await this.calculer(contratId, semaineIso, ligne.snapshot);
    const modifie = aDesModifs(delta);
    const statut: StatutNotification = modifie
      ? 'VALIDEE_AVEC_MODIFS'
      : 'VALIDEE';
    const deltaModifs = modifie ? delta : null;

    await this.db
      .update(notificationHebdo)
      .set({
        statut,
        valideeLe: new Date(),
        deltaModifs,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationHebdo.contratId, contratId),
          eq(notificationHebdo.semaineIso, semaineIso),
          eq(notificationHebdo.type, TYPE_VALIDATION_HEBDO),
        ),
      );

    return { contratId, semaineIso, statut, deltaModifs };
  }

  /** Diff de la semaine : relecture du planning vs snapshot (vide si relecture KO). */
  private async calculer(
    contratId: string,
    semaineIso: string,
    snapshot: NotificationHebdoRow['snapshot'],
  ): Promise<DeltaModifs> {
    const plannings = await this.relire(contratId, semaineIso);
    if (plannings === null) {
      return { jours: [] };
    }
    const apres = extraireSemaine(plannings, joursDeLaSemaine(semaineIso));
    return calculerDelta(snapshot, apres);
  }

  /**
   * Relit les saisies du/des mois recouverts par la semaine. Renvoie `null` si **un**
   * mois est indisponible (planification dégradée) — l'appelant conserve alors le
   * snapshot au lieu de conclure à tort à un planning vidé.
   */
  private async relire(
    contratId: string,
    semaineIso: string,
  ): Promise<(Record<string, unknown> | null)[] | null> {
    const saisies: (Record<string, unknown> | null)[] = [];
    for (const mois of moisDeLaSemaine(semaineIso)) {
      const saisie = await this.planification.lirePlanning(contratId, mois);
      if (saisie === undefined) {
        return null;
      }
      saisies.push(saisie);
    }
    return saisies;
  }

  private async ligne(
    contratId: string,
    semaineIso: string,
  ): Promise<NotificationHebdoRow | undefined> {
    const lignes = await this.db
      .select()
      .from(notificationHebdo)
      .where(
        and(
          eq(notificationHebdo.contratId, contratId),
          eq(notificationHebdo.semaineIso, semaineIso),
          eq(notificationHebdo.type, TYPE_VALIDATION_HEBDO),
        ),
      );
    return lignes[0];
  }

  private versVue(ligne: NotificationHebdoRow): NotificationAValiderVue {
    return {
      contratId: ligne.contratId,
      foyerId: ligne.foyerId,
      semaineIso: ligne.semaineIso,
      statut: this.statut(ligne.statut),
      notifieeLe: ligne.notifieeLe.toISOString(),
    };
  }

  /** Renarrow d'un statut lu en base vers `StatutNotification` (contrainte aux écritures). */
  private statut(valeur: string): StatutNotification {
    const connu = STATUTS_NOTIFICATION.find((s) => s === valeur);
    if (!connu) {
      throw new Error(`statut de notification inconnu en base : ${valeur}`);
    }
    return connu;
  }
}
