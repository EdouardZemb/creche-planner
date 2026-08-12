import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, like, ne } from 'drizzle-orm';
import {
  enfantModifieEventSchema,
  foyerSupprimeEventSchema,
  ENFANT_MODIFIE_TYPE,
  FOYER_SUPPRIME_TYPE,
} from '@creche-planner/contracts-foyer';
import {
  CONTRAT_MODIFIE_TYPE,
  type ContratModifiePayload,
  type ModeContrat,
} from '@creche-planner/contracts-planification';
import {
  DRIZZLE,
  traceIdCourant,
  type ResultatTraitement,
} from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  deadLetter,
  etablissement,
  outbox,
  processedEvent,
} from '../database/schema.js';

/** Transaction Drizzle (type du callback `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Projette les événements **enfant** du stream `FOYER` sur les contrats : le prénom
 * `contrat.enfant` est une **dénormalisation d'affichage** dont la référence est
 * `contrat.enfant_id` ; quand l'enfant est renommé côté `svc-foyer`
 * (`foyer.EnfantModifie.v1`), on rafraîchit le prénom de tous ses contrats et on
 * **ré-émet `ContratModifie`** par contrat touché (outbox, même transaction) pour
 * que les read-models aval (`svc-notifications`, `svc-tarification`) se rafraîchissent
 * sans changement de code chez eux.
 *
 * Consomme aussi `foyer.FoyerSupprime.v1` (droit à l'effacement, doc 37 §3) :
 * l'agrégat foyer ayant réellement disparu en amont, tout ce que Planification
 * détient pour lui est supprimé — cf. {@link ProjectionService.appliquerFoyerSupprime}.
 *
 * Idempotence : chaque enveloppe est marquée dans `processed_event` **dans la même
 * transaction** que la mise à jour — un rejeu at-least-once JetStream est un no-op
 * (en particulier, pas de double ré-émission `ContratModifie`).
 *
 * `EnfantAjoute`/`EnfantRetire` ne sont pas consommés : la création de contrat porte
 * déjà l'`enfantId`, et retirer un enfant ne supprime pas ses contrats (geste explicite
 * de l'utilisateur). Attention, « non consommé » ne veut **pas** dire « acquitté sans
 * action » : tout type non géré du stream FOYER part en `dead_letter` avec la raison
 * `TYPE_INCONNU` **et son payload en clair** (`ConsumerModule`, lot 1 Fondations).
 * C'est précisément ce qui rend la purge de `dead_letter` indispensable à l'effacement
 * d'un foyer.
 */
@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
        case ENFANT_MODIFIE_TYPE:
          await this.appliquerEnfantModifie(stream, donnees);
          return 'TRAITE';
        case FOYER_SUPPRIME_TYPE:
          await this.appliquerFoyerSupprime(stream, donnees);
          return 'TRAITE';
        default:
          return 'IGNORE_TYPE_INCONNU'; // type non consommé par Planification
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
   * `EnfantModifie` : rafraîchit le prénom dénormalisé des contrats rattachés à
   * l'enfant (`enfant_id`) dont le prénom stocké diffère, puis ré-émet un
   * `ContratModifie` (état complet, prénom rafraîchi) **par contrat touché**. Les
   * contrats historiques sans `enfant_id` (back-fill en attente) ne sont pas
   * touchés — le rapprochement par prénom est du ressort du back-fill, pas d'un
   * renommage (ambigu par nature).
   */
  private async appliquerEnfantModifie(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = enfantModifieEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      const rafraichis = await tx
        .update(contrat)
        .set({ enfant: p.prenom, updatedAt: new Date() })
        .where(
          and(eq(contrat.enfantId, p.enfantId), ne(contrat.enfant, p.prenom)),
        )
        .returning();
      for (const ligne of rafraichis) {
        const payload: ContratModifiePayload = {
          contratId: ligne.id,
          foyerId: ligne.foyerId,
          enfant: ligne.enfant,
          enfantId: ligne.enfantId,
          mode: ligne.mode as ModeContrat,
          valideDu: ligne.valideDu,
          valideAu: ligne.valideAu,
          etablissementId: ligne.etablissementId,
          // État complet ré-émis : la première inscription ABCM (lot 4a) doit
          // survivre au renommage d'un enfant (sinon le champ « clignote »).
          premiereInscription: ligne.premiereInscription,
        };
        await tx.insert(outbox).values({
          id: randomUUID(),
          type: CONTRAT_MODIFIE_TYPE,
          payload,
          traceId: traceIdCourant(),
        });
      }
      if (rafraichis.length > 0) {
        this.logger.log(
          `Prénom rafraîchi sur ${String(rafraichis.length)} contrat(s) de l'enfant ${p.enfantId} (« ${p.prenom} »)`,
        );
      }
    });
  }

  /**
   * `FoyerSupprime` : le foyer a été **réellement supprimé** en amont (droit à
   * l'effacement, doc 37 §3) ; tout ce que Planification détient pour lui doit
   * disparaître avec lui.
   *
   * Deux tables seulement portent un `foyer_id` : `contrat` et `etablissement`. Les
   * trois tables filles — `contrat_version`, `correction_journal`, `planning_mois` —
   * pendent de `contrat` par une FK `ON DELETE cascade` (migrations 0000 et 0008) :
   * les supprimer explicitement serait non seulement redondant, mais **mensonger sur
   * qui garantit l'effacement**. C'est la contrainte SQL qui le garantit, y compris
   * pour un contrat supprimé par une autre voie que ce handler.
   *
   * **L'ordre des deux DELETE est contraint, pas cosmétique** : la colonne
   * `contrat.etablissement_id` référence `etablissement.id` en `ON DELETE no action`
   * (migration 0003). Vider `etablissement` en premier violerait la contrainte et
   * ferait échouer toute la transaction — l'effacement partirait alors en boucle de
   * re-livraison sans jamais aboutir. C'est la seule régression réellement dangereuse
   * de ce handler, d'où le test qui prouve l'ordre.
   *
   * `dead_letter` est purgée **pour ce foyer** : c'est un magasin **terminal**, que
   * plus rien ne relit, et qui stocke aujourd'hui des **payloads en clair** — ce
   * service ne consomme que deux types du stream FOYER, donc tout le reste y atterrit
   * avec son contenu (`TYPE_INCONNU`). Le filtre est un `like` sur le texte du
   * payload : la table ne porte pas de `foyer_id`, et un UUID est assez spécifique
   * pour qu'un faux positif soit irréaliste. Pas de cast JSON — il exploserait sur une
   * ligne `PARSE_KO`, dont le payload est non-JSON par construction.
   *
   * `outbox` n'est **pas** purgée : c'est une file de publication **vivante**, pas un
   * magasin. Supprimer une ligne non encore publiée annulerait un événement en vol —
   * l'événement d'effacement lui-même y transite, côté émetteur. Sa borne est
   * **temporelle** (30 j après publication, doc 37 §3 T7) et relève du lot suivant.
   *
   * `processed_event` n'est **pas** touchée non plus : c'est le garde-fou anti-rejeu.
   * L'effacer rouvrirait la porte à une re-projection du foyer à la prochaine
   * re-livraison JetStream — soit exactement le résidu qu'on prétend supprimer. Doc 37
   * §3 l'exclut nommément (sa borne dépend d'une rétention JetStream pas encore posée).
   *
   * **Aucune ré-émission** : les services aval sont eux-mêmes abonnés au stream FOYER
   * et reçoivent `FoyerSupprime` directement de svc-foyer. Relayer créerait une seconde
   * source de vérité et un ordre de traitement non garanti. `payload.parentIds` n'est
   * pas exploité ici : aucune table de ce service n'est clée par parent.
   */
  private async appliquerFoyerSupprime(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = foyerSupprimeEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const foyerId = evt.payload.foyerId;
      // 1. Contrats du foyer — la cascade SQL emporte `contrat_version`,
      //    `correction_journal` et `planning_mois`.
      await tx.delete(contrat).where(eq(contrat.foyerId, foyerId));
      // 2. Établissements du foyer — OBLIGATOIREMENT après (1), cf. la FK
      //    `contrat.etablissement_id` en `no action`.
      await tx.delete(etablissement).where(eq(etablissement.foyerId, foyerId));
      // 3. Messages morts portant l'identifiant du foyer dans leur payload.
      await tx
        .delete(deadLetter)
        .where(like(deadLetter.payload, `%${foyerId}%`));
      this.logger.log(`Foyer ${foyerId} effacé du read model Planification`);
    });
  }
}
