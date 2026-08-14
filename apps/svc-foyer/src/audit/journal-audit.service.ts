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
 * Compteur OTel de la piste d'audit, exporté en Prometheus (le label `service.name`
 * est ajouté par le collector). Sans `MeterProvider` enregistré, l'API OTel est un
 * no-op silencieux. Modèle d'émission : `AppartenanceGuard` de la passerelle.
 *
 * Il n'est pas décoratif : `acteur="inconnu"` **est** l'indicateur de bascule.
 * Tant que `INTERSERVICE_AUTHZ_ENFORCE` reste à 0, une requête sans assertion
 * valide mute quand même le dossier ; ce compteur dit combien, et sur quelles
 * actions. Un flux nul pendant une semaine est la preuve que l'enforce ne
 * refuserait rien de légitime — la même lecture que `gateway_authz_refus_total`
 * pour l'appartenance foyer.
 *
 * L'étiquette `acteur` ne porte que le **type**, jamais l'e-mail : une adresse en
 * label ferait exploser la cardinalité et publierait une donnée personnelle dans
 * Prometheus, hors de toute politique de rétention (doc 37 §1, T5).
 */
const meter = metrics.getMeter('svc-foyer.audit');
const compteurAudit = meter.createCounter('foyer_audit_actions_total', {
  description:
    "Mutations sensibles du dossier foyer consignées à la piste d'audit, par action, par type d'acteur et selon que la ligne a pu être persistée.",
});

/** Ce qu'une ligne d'audit consigne, hors horodatage (posé par la base). */
export interface EntreeAudit {
  readonly foyerId: string;
  readonly action: ActionAudit;
  readonly cibleType: CibleAudit;
  /** Ressource visée ; omis quand l'action porte le foyer entier. */
  readonly cibleId?: string | undefined;
  readonly acteur: Acteur;
}

/**
 * **Piste d'audit acteur** de `svc-foyer` (lot 6 du plan standards, `AM-45` ;
 * OWASP ASVS V7). Écrit **qui** a muté le dossier du foyer, en base (`journal_audit`)
 * et dans le journal applicatif.
 *
 * Les deux sorties ne font pas double emploi, et c'est l'effacement du foyer qui le
 * prouve : la table part en `ON DELETE CASCADE` avec le foyer, donc l'action qui
 * efface un foyer ne peut **par construction** pas s'y écrire — une insertion après
 * le `DELETE` violerait la clé étrangère, une insertion avant serait emportée par la
 * cascade. Le journal applicatif est le seul lieu où cette action-là survit, avec sa
 * propre rétention (doc 37, T5). Toutes les autres écrivent aux deux endroits.
 *
 * L'écriture en base se fait **dans la transaction de la mutation** (patron outbox) :
 * une piste d'audit qui survivrait à un `ROLLBACK` affirmerait un fait qui n'a pas eu
 * lieu, et une écriture après coup se perdrait au premier incident.
 */
@Injectable()
export class JournalAuditService {
  private readonly logger = new Logger(JournalAuditService.name);

  /**
   * Consigne une mutation **réussie**, dans la transaction qui la porte. À appeler
   * après l'écriture et avant la sortie du `transaction(...)`, comme l'outbox.
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
    this.tracer(entree, true);
  }

  /**
   * Consigne une mutation que la base **ne peut pas** garder : l'effacement du
   * foyer, dont la ligne partirait avec lui. Journal applicatif et compteur
   * seulement — l'appelant reste responsable de dire pourquoi (doc 37 §7).
   */
  consignerHorsBase(entree: EntreeAudit): void {
    this.tracer(entree, false);
  }

  /** Journal applicatif + compteur, communs aux deux voies. */
  private tracer(entree: EntreeAudit, persiste: boolean): void {
    compteurAudit.add(1, {
      action: entree.action,
      acteur: entree.acteur.type,
      persiste: String(persiste),
    });
    this.logger.log(
      `audit ${entree.action} — foyer ${entree.foyerId}` +
        (entree.cibleId !== undefined
          ? ` ${entree.cibleType} ${entree.cibleId}`
          : '') +
        ` par ${libelleActeur(entree.acteur)}` +
        (persiste ? '' : ' (journal applicatif seul)'),
    );
  }
}
