import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  contratCreeEventSchema,
  contratModifieEventSchema,
  contratSupprimeEventSchema,
  etablissementCreeEventSchema,
  etablissementModifieEventSchema,
  etablissementSupprimeEventSchema,
  CONTRAT_CREE_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  ETABLISSEMENT_MODIFIE_TYPE,
  ETABLISSEMENT_SUPPRIME_TYPE,
} from '@creche-planner/contracts-planification';
import {
  parentAjouteEventSchema,
  parentModifieEventSchema,
  parentRetireEventSchema,
  preferencesNotifModifieesEventSchema,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
} from '@creche-planner/contracts-foyer';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  etablissement,
  foyerParent,
  preferenceNotification,
  processedEvent,
} from '../database/schema.js';

/** Transaction Drizzle (type du callback `db.transaction`). */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Projette les événements du stream **PLANIFICATION** dans le **read model** des
 * contrats actifs du service Notifications. Chaque message est traité
 * **idempotemment** dans une seule transaction : on insère d'abord la ligne
 * `processed_event` (clé = `id` d'enveloppe) ; si elle existe déjà (rejeu
 * at-least-once JetStream), la projection est sautée (no-op effectivement-une-fois).
 *
 * Contrairement à `svc-tarification`, Notifications n'a besoin que de l'**identité**
 * et de la **période de validité** des contrats (pas des quantités du planning), donc
 * il ne consomme pas `PlanningModifie` et n'a aucun client de repli vers
 * `svc-planification` : tout ce dont il a besoin tient dans les payloads
 * `ContratCree`/`ContratModifie`/`ContratSupprime`.
 *
 * Depuis la PR4 « parents du foyer », il projette aussi le read model `foyer_parent`
 * depuis le stream `FOYER` (`foyer.Parent{Ajoute,Modifie,Retire}.v1`) pour résoudre
 * les destinataires du récap hebdo. Le `switch` sur `type` aiguille indifféremment
 * les deux streams (l'idempotence reste pilotée par `processed_event`).
 *
 * Depuis P3 « établissements entité libre », il projette enfin le read model
 * `etablissement` depuis le stream `PLANIFICATION`
 * (`planification.Etablissement{Cree,Modifie,Supprime}.v1`) : Notifications cesse
 * d'être source de vérité (plus de seed en dur) et résout le destinataire réel du
 * récap par le lien explicite `contrat.etablissement_id` (lui aussi désormais projeté).
 *
 * Depuis PR4 « préférences de notification », il projette enfin le read model
 * `preference_notification` depuis le stream `FOYER`
 * (`foyer.PreferencesNotifModifiees.v1`) : c'est ce read model qui rend l'opt-out
 * e-mail **fonctionnel** (un parent ayant coupé le canal `EMAIL` pour un type est
 * retiré des destinataires, cf. `DestinatairesService`). L'event transporte l'état
 * **complet** des préférences du parent ; la projection remplace l'ensemble des lignes
 * du parent (delete + upsert dans une transaction).
 */
@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Traite un message brut du stream `PLANIFICATION`. Renvoie `true` si l'événement
   * a été appliqué (ou ignoré proprement) et peut être acquitté ; `false` si une
   * erreur transitoire impose une re-livraison (NAK). La forme inconnue d'un type non
   * géré est acquittée (on ne bloque pas le stream sur un événement étranger).
   */
  async traiter(stream: string, donnees: unknown): Promise<boolean> {
    try {
      const type = this.typeDe(donnees);
      if (type === undefined) {
        return true; // pas une enveloppe reconnue : on acquitte sans projeter
      }
      switch (type) {
        case CONTRAT_CREE_TYPE:
          await this.appliquerContratCree(stream, donnees);
          return true;
        case CONTRAT_MODIFIE_TYPE:
          await this.appliquerContratModifie(stream, donnees);
          return true;
        case CONTRAT_SUPPRIME_TYPE:
          await this.appliquerContratSupprime(stream, donnees);
          return true;
        case PARENT_AJOUTE_TYPE:
          await this.appliquerParentEtat(
            stream,
            donnees,
            parentAjouteEventSchema,
          );
          return true;
        case PARENT_MODIFIE_TYPE:
          await this.appliquerParentEtat(
            stream,
            donnees,
            parentModifieEventSchema,
          );
          return true;
        case PARENT_RETIRE_TYPE:
          await this.appliquerParentRetire(stream, donnees);
          return true;
        case PREFERENCES_NOTIF_MODIFIEES_TYPE:
          await this.appliquerPreferencesNotif(stream, donnees);
          return true;
        case ETABLISSEMENT_CREE_TYPE:
          await this.appliquerEtablissementEtat(
            stream,
            donnees,
            etablissementCreeEventSchema,
          );
          return true;
        case ETABLISSEMENT_MODIFIE_TYPE:
          await this.appliquerEtablissementEtat(
            stream,
            donnees,
            etablissementModifieEventSchema,
          );
          return true;
        case ETABLISSEMENT_SUPPRIME_TYPE:
          await this.appliquerEtablissementSupprime(stream, donnees);
          return true;
        default:
          return true; // type non consommé par Notifications : acquitté
      }
    } catch (erreur) {
      this.logger.warn(
        `Projection échouée (${stream}) : ${(erreur as Error).message} — re-livraison`,
      );
      return false;
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
   * `ContratCree` : on mémorise l'identité du contrat (foyer/enfant/mode) et sa
   * période de validité (`valideDu`/`valideAu`) dans la table locale `contrat`.
   * C'est cette projection que la validation hebdomadaire interrogera pour savoir
   * quels contrats actifs notifier. Idempotent via `processed_event`.
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
          etablissementId: p.etablissementId ?? null,
          valideDu: p.valideDu,
          valideAu: p.valideAu,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: contrat.id,
          set: {
            foyerId: p.foyerId,
            enfant: p.enfant,
            mode: p.mode,
            etablissementId: p.etablissementId ?? null,
            valideDu: p.valideDu,
            valideAu: p.valideAu,
            updatedAt: new Date(),
          },
        });
    });
  }

  /**
   * `ContratModifie` : le contrat a changé (enfant/mode/dates/établissement). On met
   * à jour la table locale `contrat` (upsert : on tolère un `ContratModifie` reçu avant
   * le `ContratCree` correspondant). Idempotent via `processed_event`.
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
          etablissementId: p.etablissementId ?? null,
          valideDu: p.valideDu,
          valideAu: p.valideAu,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: contrat.id,
          set: {
            foyerId: p.foyerId,
            enfant: p.enfant,
            mode: p.mode,
            etablissementId: p.etablissementId ?? null,
            valideDu: p.valideDu,
            valideAu: p.valideAu,
            updatedAt: new Date(),
          },
        });
    });
  }

  /**
   * `ContratSupprime` : retire le contrat du read model. Idempotent via
   * `processed_event` (un rejeu supprime une ligne déjà absente : no-op). Tout dans
   * une seule transaction.
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
      await tx.delete(contrat).where(eq(contrat.id, p.contratId));
    });
  }

  /**
   * `ParentAjoute`/`ParentModifie` : upsert de l'état complet du parent dans le read
   * model local `foyer_parent` (clé = `parent_id`). Les deux événements transportent
   * le même payload (`parentEtatPayloadSchema`) et se projettent à l'identique : un
   * `ParentModifie` reçu avant son `ParentAjoute` (désordre transitoire) crée la
   * ligne. On ne projette que ce qui sert l'envoi (`email`, `principal`, `actif`),
   * pas `prenom`/`nom`. Idempotent via `processed_event`.
   */
  private async appliquerParentEtat(
    stream: string,
    donnees: unknown,
    schema: typeof parentAjouteEventSchema,
  ): Promise<void> {
    const evt = schema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(foyerParent)
        .values({
          parentId: p.parentId,
          foyerId: p.foyerId,
          email: p.email,
          principal: p.principal,
          actif: p.actif,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: foyerParent.parentId,
          set: {
            foyerId: p.foyerId,
            email: p.email,
            principal: p.principal,
            actif: p.actif,
            updatedAt: new Date(),
          },
        });
    });
  }

  /**
   * `ParentRetire` : retrait **soft-delete** côté svc-foyer → on bascule la ligne
   * locale en `actif = false` (la résolution des destinataires ne retient que les
   * parents actifs). La ligne est conservée (historique). Un retrait d'un parent
   * jamais projeté est un no-op. Idempotent via `processed_event`.
   */
  private async appliquerParentRetire(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = parentRetireEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      await tx
        .update(foyerParent)
        .set({ actif: false, updatedAt: new Date() })
        .where(eq(foyerParent.parentId, evt.payload.parentId));
    });
  }

  /**
   * `PreferencesNotifModifiees` : l'event transporte l'**état complet** des préférences
   * du parent (même patron que `ParentAjoute`/`ParentModifie` : le consommateur projette
   * sans relire la source). On **remplace** l'ensemble des lignes du parent dans la
   * même transaction — `delete` de toutes ses préférences puis upsert de chaque ligne de
   * l'event — de sorte qu'une préférence **remise au défaut** côté svc-foyer (ligne
   * retirée de l'event) disparaisse aussi ici. On ne projette que `actif` (le routage
   * n'a besoin de rien d'autre) ; l'absence de ligne vaut le défaut applicatif (actif).
   * Idempotent via `processed_event`.
   */
  private async appliquerPreferencesNotif(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = preferencesNotifModifieesEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      // Remplace l'état : on efface les préférences existantes du parent…
      await tx
        .delete(preferenceNotification)
        .where(eq(preferenceNotification.parentId, p.parentId));
      // …puis on (ré)insère l'état complet porté par l'event.
      for (const pref of p.preferences) {
        await tx
          .insert(preferenceNotification)
          .values({
            parentId: p.parentId,
            typeNotification: pref.typeNotification,
            canal: pref.canal,
            actif: pref.actif,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              preferenceNotification.parentId,
              preferenceNotification.typeNotification,
              preferenceNotification.canal,
            ],
            set: { actif: pref.actif, updatedAt: new Date() },
          });
      }
    });
  }

  /**
   * `EtablissementCree`/`EtablissementModifie` : upsert de l'état complet de la fiche
   * établissement dans le read model local `etablissement` (clé = `id`). Les deux
   * événements transportent le même payload d'état et se projettent à l'identique : un
   * `EtablissementModifie` reçu avant son `EtablissementCree` (désordre transitoire) crée
   * la ligne. On projette ce qui sert le routage/rendu du récap (`nom`, `email_service`,
   * `preavis_regle`, `types`, `actif`) ; les coordonnées internes ne voyagent pas dans
   * l'event. Idempotent via `processed_event`.
   */
  private async appliquerEtablissementEtat(
    stream: string,
    donnees: unknown,
    schema: typeof etablissementCreeEventSchema,
  ): Promise<void> {
    const evt = schema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      await tx
        .insert(etablissement)
        .values({
          id: p.etablissementId,
          foyerId: p.foyerId,
          nom: p.nom,
          emailService: p.emailService,
          preavisRegle: p.preavisRegle,
          types: p.types,
          actif: p.actif,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: etablissement.id,
          set: {
            foyerId: p.foyerId,
            nom: p.nom,
            emailService: p.emailService,
            preavisRegle: p.preavisRegle,
            types: p.types,
            actif: p.actif,
            updatedAt: new Date(),
          },
        });
    });
  }

  /**
   * `EtablissementSupprime` : retire la fiche du read model `etablissement`. Idempotent
   * via `processed_event` (un rejeu supprime une ligne déjà absente : no-op). Le récap
   * d'un contrat encore rattaché retombera alors sur un destinataire introuvable
   * (géré côté envoi). Tout dans une seule transaction.
   */
  private async appliquerEtablissementSupprime(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = etablissementSupprimeEventSchema.parse(donnees);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      await tx
        .delete(etablissement)
        .where(eq(etablissement.id, evt.payload.etablissementId));
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
