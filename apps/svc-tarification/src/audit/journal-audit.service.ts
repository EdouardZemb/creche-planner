import { Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import {
  identiteActeur,
  libelleActeur,
  type Acteur,
} from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { journalAudit } from '../database/schema.js';
import type { ActionAudit, CibleAudit } from './journal-audit.actions.js';

/** Transaction Drizzle (type du callback `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Compteur OTel de la piste d'audit, exporté en Prometheus. Miroir de celui de
 * `svc-foyer` : l'étiquette `acteur` ne porte que le **type**, jamais l'e-mail —
 * une adresse en label ferait exploser la cardinalité et publierait une donnée
 * personnelle dans Prometheus, hors de toute politique de rétention.
 *
 * `acteur="inconnu"` n'est pas une anomalie mais un **état réel** du système tant
 * que `INTERSERVICE_AUTHZ_ENFORCE` reste à 0 : une requête sans assertion valide
 * mute quand même. Ce compteur dit combien, et sur quelles actions.
 */
const meter = metrics.getMeter('svc-tarification.audit');
const compteurAudit = meter.createCounter('tarification_audit_actions_total', {
  description:
    "Mutations du suivi des unités associatives consignées à la piste d'audit, par action et par type d'acteur.",
});

/** Ce qu'une ligne d'audit consigne, hors horodatage (posé par la base). */
export interface EntreeAudit {
  readonly foyerId: string;
  readonly action: ActionAudit;
  readonly cibleType: CibleAudit;
  /** Ressource visée ; omise quand l'action porte le foyer entier. */
  readonly cibleId?: string | undefined;
  readonly acteur: Acteur;
}

/**
 * **Piste d'audit acteur** de `svc-tarification` (doc 37 §7 ; OWASP ASVS V7).
 * Écrit **qui** a muté le suivi des unités associatives, en base
 * (`journal_audit`) et dans le journal applicatif.
 *
 * L'écriture en base se fait **dans la transaction de la mutation** (patron
 * outbox) : une piste d'audit qui survivrait à un `ROLLBACK` affirmerait un fait
 * qui n'a pas eu lieu, et une écriture après coup se perdrait au premier incident.
 */
@Injectable()
export class JournalAuditService {
  private readonly logger = new Logger(JournalAuditService.name);

  /**
   * Consigne une mutation **réussie**, dans la transaction qui la porte. À
   * appeler après l'écriture et avant la sortie du `transaction(...)`.
   */
  async consigner(tx: Tx, entree: EntreeAudit): Promise<void> {
    await tx.insert(journalAudit).values({
      foyerId: entree.foyerId,
      action: entree.action,
      cibleType: entree.cibleType,
      cibleId: entree.cibleId ?? null,
      acteurType: entree.acteur.type,
      // L'identité **nue** : la nature est déjà dans `acteur_type`, et `inconnu`
      // laisse la colonne nulle plutôt que d'y écrire le mot « inconnu », qui
      // serait indiscernable d'un acteur réellement nommé ainsi.
      acteur: identiteActeur(entree.acteur),
    });
    compteurAudit.add(1, {
      action: entree.action,
      acteur: entree.acteur.type,
    });
    this.logger.log(
      `audit ${entree.action} — foyer ${entree.foyerId}` +
        (entree.cibleId !== undefined
          ? ` ${entree.cibleType} ${entree.cibleId}`
          : '') +
        ` par ${libelleActeur(entree.acteur)}`,
    );
  }
}
