import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import {
  enfantAjouteEventSchema,
  foyerMisAJourEventSchema,
  foyerMisAJourEventV2Schema,
  ENFANT_AJOUTE_TYPE,
  FOYER_MIS_A_JOUR_TYPE,
  FOYER_MIS_A_JOUR_V2_TYPE,
} from '@creche-planner/contracts-foyer';
import {
  grillePublieeEventSchema,
  GRILLE_PUBLIEE_TYPE,
} from '@creche-planner/contracts-referentiel';
import {
  contratCreeEventSchema,
  contratModifieEventSchema,
  contratSupprimeEventSchema,
  planningModifieEventSchema,
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  PLANNING_MODIFIE_TYPE,
} from '@creche-planner/contracts-planification';
import { DRIZZLE, type ResultatTraitement } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  enfant,
  foyer,
  grilleTarifaire,
  prestationMois,
  processedEvent,
} from '../database/schema.js';
import { PlanificationClient } from '../fallback/planification.client.js';

/** Transaction Drizzle (type du callback `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Projette les événements d'intégration amont dans le **read model** Tarification
 * (doc 06 §10.4). Chaque message est traité **idempotemment** dans une seule
 * transaction : on insère d'abord la ligne `processed_event` (clé = `id`
 * d'enveloppe) ; si elle existe déjà (rejeu at-least-once JetStream), la
 * projection est sautée (no-op effectivement-une-fois). Le détail tarifaire reste
 * brut (`jsonb`) ; aucune formule ici.
 */
@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly planificationClient: PlanificationClient,
  ) {}

  /**
   * Traite un message brut d'un stream et renvoie un {@link ResultatTraitement}
   * qui dit au consommateur quoi en faire : `TRAITE` (appliqué ou ignoré
   * proprement → ACK), `IGNORE_ENVELOPPE_INVALIDE`/`IGNORE_TYPE_INCONNU`
   * (dead-letter + ACK), `ECHEC_TRANSITOIRE` (erreur transitoire → NAK, ou
   * dead-letter au bout des livraisons). Aucun message ne disparaît en silence.
   */
  async traiter(stream: string, donnees: unknown): Promise<ResultatTraitement> {
    try {
      const type = this.typeDe(donnees);
      if (type === undefined) {
        return 'IGNORE_ENVELOPPE_INVALIDE'; // pas une enveloppe reconnue
      }
      switch (type) {
        case FOYER_MIS_A_JOUR_TYPE:
        case FOYER_MIS_A_JOUR_V2_TYPE:
          await this.appliquerFoyerMisAJour(stream, donnees);
          return 'TRAITE';
        case ENFANT_AJOUTE_TYPE:
          await this.appliquerEnfantAjoute(stream, donnees);
          return 'TRAITE';
        case GRILLE_PUBLIEE_TYPE:
          await this.appliquerGrillePubliee(stream, donnees);
          return 'TRAITE';
        case CONTRAT_CREE_TYPE:
          await this.appliquerContratCree(stream, donnees);
          return 'TRAITE';
        case CONTRAT_MODIFIE_TYPE:
          await this.appliquerContratModifie(stream, donnees);
          return 'TRAITE';
        case CONTRAT_SUPPRIME_TYPE:
          await this.appliquerContratSupprime(stream, donnees);
          return 'TRAITE';
        case PLANNING_MODIFIE_TYPE:
          await this.appliquerPlanningModifie(stream, donnees);
          return 'TRAITE';
        default:
          return 'IGNORE_TYPE_INCONNU'; // type non consommé par Tarification
      }
    } catch (erreur) {
      this.logger.warn(
        `Projection échouée (${stream}) : ${(erreur as Error).message} — re-livraison`,
      );
      return 'ECHEC_TRANSITOIRE';
    }
  }

  /** Lit le champ `type` d'une enveloppe brute sans valider le payload. */
  private typeDe(donnees: unknown): string | undefined {
    if (
      typeof donnees === 'object' &&
      donnees !== null &&
      'type' in donnees &&
      typeof donnees.type === 'string'
    ) {
      return (donnees as { type: string }).type;
    }
    return undefined;
  }

  /**
   * Décode un `foyer.FoyerMisAJour` en **choisissant le schéma par `version`**
   * d'enveloppe : `version >= 2` ⇒ schéma v2 (champ optionnel `anneeRevenus`
   * toléré), sinon ⇒ schéma v1 historique. Garantit la rétro-compatibilité : un
   * payload v1 reste décodable après l'introduction de v2, et un payload v2 est
   * accepté sans planter. Lève (parse strict) si le payload est invalide.
   */
  private decoderFoyerMisAJour(donnees: unknown) {
    const version =
      typeof donnees === 'object' &&
      donnees !== null &&
      'version' in donnees &&
      typeof donnees.version === 'number'
        ? (donnees as { version: number }).version
        : 1;
    return version >= 2
      ? foyerMisAJourEventV2Schema.parse(donnees)
      : foyerMisAJourEventSchema.parse(donnees);
  }

  /**
   * Insère le marqueur d'idempotence ; renvoie `false` si déjà présent (doublon),
   * auquel cas l'appelant n'applique pas la projection.
   */
  private async marquerTraite(
    tx: Tx,
    id: string,
    stream: string,
    type: string,
  ): Promise<boolean> {
    const insere = await tx
      .insert(processedEvent)
      .values({ id, stream, type })
      .onConflictDoNothing({ target: processedEvent.id })
      .returning({ id: processedEvent.id });
    return insere.length > 0;
  }

  /**
   * Projette `foyer.FoyerMisAJour`. **Dispatch par `version` de l'enveloppe**
   * (DEC-02, ADR-0004 décision 2) : la v1 historique et la v2 rétrocompatible
   * coexistent. Le décodage choisit le schéma Zod d'après `version` (1 ⇒ v1,
   * ≥2 ⇒ v2). La projection reste **identique** pour v1 ; le champ optionnel
   * ajouté en v2 (`anneeRevenus`) est toléré au décodage mais n'altère pas la
   * projection (read model inchangé), donc aucune régression.
   */
  private async appliquerFoyerMisAJour(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = this.decoderFoyerMisAJour(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(foyer)
        .values({
          id: p.foyerId,
          ressourcesMensuellesCentimes: p.ressourcesMensuellesCentimes,
          rfrCentimes: p.rfrCentimes,
          tranche: p.tranche,
          nbParts: String(p.nbParts),
          nbEnfantsACharge: p.nbEnfantsACharge,
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: foyer.id,
          set: {
            ressourcesMensuellesCentimes: p.ressourcesMensuellesCentimes,
            rfrCentimes: p.rfrCentimes,
            tranche: p.tranche,
            nbParts: String(p.nbParts),
            nbEnfantsACharge: p.nbEnfantsACharge,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie : n'écrase l'état que si l'événement entrant est
          // au moins aussi récent (égalité incluse : un correctif ré-émis au même
          // instant doit pouvoir s'appliquer). Une re-livraison tardive (NAK/backoff
          // JetStream) d'un événement périmé est ainsi ignorée.
          setWhere: sql`${foyer.occurredAt} is null or ${foyer.occurredAt} <= excluded.occurred_at`,
        });
    });
  }

  private async appliquerEnfantAjoute(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = enfantAjouteEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(enfant)
        .values({
          id: p.enfantId,
          foyerId: p.foyerId,
          prenom: p.prenom,
          dateNaissance: p.dateNaissance,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: enfant.id,
          set: {
            foyerId: p.foyerId,
            prenom: p.prenom,
            dateNaissance: p.dateNaissance,
            updatedAt: new Date(),
          },
        });
    });
  }

  private async appliquerGrillePubliee(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = grillePublieeEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(grilleTarifaire)
        .values({
          id: p.grilleId,
          mode: p.mode,
          tranche: p.tranche,
          valideDu: p.valideDu,
          valideAu: p.valideAu,
          parametres: p,
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            grilleTarifaire.mode,
            grilleTarifaire.tranche,
            grilleTarifaire.valideDu,
          ],
          set: {
            valideAu: p.valideAu,
            parametres: p,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie (cf. appliquerFoyerMisAJour).
          setWhere: sql`${grilleTarifaire.occurredAt} is null or ${grilleTarifaire.occurredAt} <= excluded.occurred_at`,
        });
    });
  }

  /**
   * `ContratCree` : on mémorise l'identité du contrat (foyer/enfant/mode) dans la
   * table locale `contrat` pour pouvoir, ensuite, rattacher les prestations d'un
   * mois au foyer et à l'enfant. Le payload ne porte pas les quantités : celles-ci
   * sont récupérées sur `PlanningModifie`.
   */
  private async appliquerContratCree(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = contratCreeEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(contrat)
        .values({
          id: p.contratId,
          foyerId: p.foyerId,
          enfant: p.enfant,
          mode: p.mode,
          // Champ additif lot 4a : un événement historique ne le porte pas.
          premiereInscription: p.premiereInscription ?? false,
          valideDu: p.valideDu,
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: contrat.id,
          set: {
            foyerId: p.foyerId,
            enfant: p.enfant,
            mode: p.mode,
            premiereInscription: p.premiereInscription ?? false,
            valideDu: p.valideDu,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie (cf. appliquerFoyerMisAJour).
          setWhere: sql`${contrat.occurredAt} is null or ${contrat.occurredAt} <= excluded.occurred_at`,
        });
    });
  }

  /**
   * `ContratModifie` : le contrat a changé (enfant/mode/dates). On met à jour la
   * table locale `contrat` (identité projetée). Les prestations déjà projetées
   * (`prestation_mois`) seront rafraîchies à la réception du prochain `PlanningModifie`
   * (qui relit les quantités) ; on aligne ici au moins l'identité (enfant/mode) sur
   * les lignes existantes pour rester cohérent en lecture. Idempotent via `processed_event`.
   */
  private async appliquerContratModifie(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = contratModifieEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(contrat)
        .values({
          id: p.contratId,
          foyerId: p.foyerId,
          enfant: p.enfant,
          mode: p.mode,
          // Champ additif lot 4a : un événement historique ne le porte pas.
          premiereInscription: p.premiereInscription ?? false,
          valideDu: p.valideDu,
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: contrat.id,
          set: {
            foyerId: p.foyerId,
            enfant: p.enfant,
            mode: p.mode,
            premiereInscription: p.premiereInscription ?? false,
            valideDu: p.valideDu,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie (cf. appliquerFoyerMisAJour).
          setWhere: sql`${contrat.occurredAt} is null or ${contrat.occurredAt} <= excluded.occurred_at`,
        });
      // Réaligne l'identité des prestations déjà projetées (les quantités seront
      // recalculées au prochain PlanningModifie).
      await tx
        .update(prestationMois)
        .set({
          foyerId: p.foyerId,
          enfant: p.enfant,
          mode: p.mode,
          updatedAt: new Date(),
        })
        .where(eq(prestationMois.contratId, p.contratId));
    });
  }

  /**
   * `ContratSupprime` : retire le contrat de l'identité projetée **et** toutes ses
   * prestations (`prestation_mois`). Idempotent via `processed_event` (un rejeu
   * supprime des lignes déjà absentes : no-op). Tout dans une seule transaction.
   */
  private async appliquerContratSupprime(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = contratSupprimeEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .delete(prestationMois)
        .where(eq(prestationMois.contratId, p.contratId));
      await tx.delete(contrat).where(eq(contrat.id, p.contratId));
    });
  }

  /**
   * `PlanningModifie` : l'événement ne porte que `{contratId, mois, simule}`. On va
   * chercher les **quantités** générées via le client `svc-planification` (repli
   * résilient), puis on upsert la projection `prestation_mois`. Le marqueur
   * d'idempotence est posé dans la même transaction que l'upsert.
   */
  private async appliquerPlanningModifie(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = planningModifieEventSchema.parse(donnees);
    const p = evt.payload;

    // Court-circuit d'**optimisation** : sur un rejeu d'un événement déjà traité
    // (livraison at-least-once / re-livraison), on ACK sans refaire l'appel réseau
    // de repli. Le dédup **autoritatif** reste l'insert transactionnel de
    // `marquerTraite` plus bas (cette lecture hors-transaction est seulement un
    // raccourci : une course éventuelle est rattrapée par le marqueur en base).
    if (await this.dejaTraite(evt.id)) {
      return;
    }

    // Identité du contrat (foyer/enfant/mode), déjà projetée par ContratCree.
    const contrats = await this.db
      .select()
      .from(contrat)
      .where(eq(contrat.id, p.contratId));
    const identite = contrats[0];
    if (!identite) {
      // Contrat pas encore projeté (ordre des événements) : NAK → re-livraison.
      throw new Error(
        `contrat ${p.contratId} inconnu — ContratCree pas encore projeté`,
      );
    }

    const prestations = await this.planificationClient.prestations(
      p.contratId,
      p.mois,
      p.simule,
    );
    if (!prestations) {
      throw new Error(
        `prestations injoignables pour ${p.contratId}/${p.mois} — re-livraison`,
      );
    }
    const prestation = prestations.prestations[0];
    if (!prestation) {
      // Aucun mode à projeter : on acquitte en posant seulement le marqueur.
      await this.db.transaction(async (tx) => {
        await this.marquerTraite(tx, evt.id, stream, evt.type);
      });
      return;
    }

    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      await tx
        .insert(prestationMois)
        .values({
          contratId: p.contratId,
          foyerId: identite.foyerId,
          enfant: identite.enfant,
          mode: identite.mode,
          mois: p.mois,
          simule: p.simule,
          prestations: prestation,
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            prestationMois.contratId,
            prestationMois.mois,
            prestationMois.simule,
          ],
          set: {
            foyerId: identite.foyerId,
            enfant: identite.enfant,
            mode: identite.mode,
            prestations: prestation,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie (cf. appliquerFoyerMisAJour).
          setWhere: sql`${prestationMois.occurredAt} is null or ${prestationMois.occurredAt} <= excluded.occurred_at`,
        });
    });
  }

  /** Indique si un événement a déjà été traité (utilitaire de diagnostic/test). */
  async dejaTraite(id: string): Promise<boolean> {
    const lignes = await this.db
      .select()
      .from(processedEvent)
      .where(eq(processedEvent.id, id));
    return lignes.length > 0;
  }
}
