import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, like, sql } from 'drizzle-orm';
import {
  contratCreeEventSchema,
  contratModifieEventSchema,
  contratSupprimeEventSchema,
  etablissementCreeEventSchema,
  etablissementModifieEventSchema,
  etablissementSupprimeEventSchema,
  CONTRAT_CREE_TYPE,
  CONTRAT_CREE_V2_TYPE,
  CONTRAT_MODIFIE_TYPE,
  CONTRAT_MODIFIE_V2_TYPE,
  CONTRAT_SUPPRIME_TYPE,
  ETABLISSEMENT_CREE_TYPE,
  ETABLISSEMENT_MODIFIE_TYPE,
  ETABLISSEMENT_SUPPRIME_TYPE,
} from '@creche-planner/contracts-planification';
import {
  foyerSupprimeEventSchema,
  parentAjouteEventSchema,
  parentModifieEventSchema,
  parentRetireEventSchema,
  preferencesNotifModifieesEventSchema,
  FOYER_SUPPRIME_TYPE,
  PARENT_AJOUTE_TYPE,
  PARENT_MODIFIE_TYPE,
  PARENT_RETIRE_TYPE,
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
} from '@creche-planner/contracts-foyer';
import { DRIZZLE, type ResultatTraitement } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  deadLetter,
  envoiEtablissement,
  envoiRecapHebdo,
  envoiRecapParent,
  etablissement,
  foyerParent,
  notification,
  notificationHebdo,
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
 *
 * Depuis le lot « effacement » (RGPD, doc 37 §3), il consomme enfin
 * `foyer.FoyerSupprime.v1` : ce service n'est pas qu'un read model reconstructible, il
 * porte des données personnelles **figées** (corps de messages rendus, destinataires
 * gelés, prénoms d'enfants) qu'aucune re-projection ne recréerait — leur effacement
 * doit donc être fait ici, explicitement (cf. `appliquerFoyerSupprime`).
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
        // v2 additive (SFD 30 lot 4) : versionId/dateEffet en plus, ignorés par
        // la projection (schema v1, strip) — champs projetés inchangés.
        case CONTRAT_CREE_TYPE:
        case CONTRAT_CREE_V2_TYPE:
          await this.appliquerContratCree(stream, donnees);
          return 'TRAITE';
        case CONTRAT_MODIFIE_TYPE:
        case CONTRAT_MODIFIE_V2_TYPE:
          await this.appliquerContratModifie(stream, donnees);
          return 'TRAITE';
        case CONTRAT_SUPPRIME_TYPE:
          await this.appliquerContratSupprime(stream, donnees);
          return 'TRAITE';
        case PARENT_AJOUTE_TYPE:
          await this.appliquerParentEtat(
            stream,
            donnees,
            parentAjouteEventSchema,
          );
          return 'TRAITE';
        case PARENT_MODIFIE_TYPE:
          await this.appliquerParentEtat(
            stream,
            donnees,
            parentModifieEventSchema,
          );
          return 'TRAITE';
        case PARENT_RETIRE_TYPE:
          await this.appliquerParentRetire(stream, donnees);
          return 'TRAITE';
        case PREFERENCES_NOTIF_MODIFIEES_TYPE:
          await this.appliquerPreferencesNotif(stream, donnees);
          return 'TRAITE';
        case ETABLISSEMENT_CREE_TYPE:
          await this.appliquerEtablissementEtat(
            stream,
            donnees,
            etablissementCreeEventSchema,
          );
          return 'TRAITE';
        case ETABLISSEMENT_MODIFIE_TYPE:
          await this.appliquerEtablissementEtat(
            stream,
            donnees,
            etablissementModifieEventSchema,
          );
          return 'TRAITE';
        case ETABLISSEMENT_SUPPRIME_TYPE:
          await this.appliquerEtablissementSupprime(stream, donnees);
          return 'TRAITE';
        case FOYER_SUPPRIME_TYPE:
          await this.appliquerFoyerSupprime(stream, donnees);
          return 'TRAITE';
        default:
          return 'IGNORE_TYPE_INCONNU'; // type non consommé par Notifications
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
            etablissementId: p.etablissementId ?? null,
            valideDu: p.valideDu,
            valideAu: p.valideAu,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie : un événement plus ancien re-livré (NAK/backoff
          // JetStream) n'écrase plus un état plus récent (égalité incluse pour
          // qu'un correctif ré-émis au même instant s'applique).
          setWhere: sql`${contrat.occurredAt} is null or ${contrat.occurredAt} <= excluded.occurred_at`,
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
            etablissementId: p.etablissementId ?? null,
            valideDu: p.valideDu,
            valideAu: p.valideAu,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie : un événement plus ancien re-livré (NAK/backoff
          // JetStream) n'écrase plus un état plus récent (égalité incluse pour
          // qu'un correctif ré-émis au même instant s'applique).
          setWhere: sql`${contrat.occurredAt} is null or ${contrat.occurredAt} <= excluded.occurred_at`,
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
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: foyerParent.parentId,
          set: {
            foyerId: p.foyerId,
            email: p.email,
            principal: p.principal,
            actif: p.actif,
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie (cf. appliquerContratCree).
          setWhere: sql`${foyerParent.occurredAt} is null or ${foyerParent.occurredAt} <= excluded.occurred_at`,
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
   * l'event — de sorte qu'une combinaison retirée de l'event disparaisse aussi ici. On ne
   * projette que `actif` (le routage n'a besoin de rien d'autre) ; depuis `AM-57`,
   * **l'absence de ligne ne vaut plus consentement** — elle écarte le destinataire
   * (`DestinatairesService`). C'est le même événement, émis dès l'inscription du parent,
   * qui pose son consentement initial : ce service n'a aucune matrice par défaut à
   * connaître. Idempotent via `processed_event`.
   */
  private async appliquerPreferencesNotif(
    stream: string,
    donnees: unknown,
  ): Promise<void> {
    const evt = preferencesNotifModifieesEventSchema.parse(donnees);
    const occurredAt = new Date(evt.occurredAt);
    await this.db.transaction(async (tx) => {
      if (!(await this.marquerTraite(tx, evt.id, stream, evt.type))) {
        return;
      }
      const p = evt.payload;
      // Garde de monotonie — ce handler **remplace** l'état (delete + insert) : il
      // ne peut pas s'appuyer sur le `setWhere` d'un upsert. On pré-vérifie donc que
      // l'événement est au moins aussi récent que l'état déjà projeté du parent
      // (`max(occurred_at)`). Un `PreferencesNotifModifiees` plus ancien re-livré
      // (NAK/backoff JetStream) est **consommé** (marqueur posé) mais **non appliqué**
      // (pas de retour en arrière de l'état). Égalité incluse (correctif ré-émis).
      const dejaProjetees = await tx
        .select()
        .from(preferenceNotification)
        .where(eq(preferenceNotification.parentId, p.parentId));
      const occurredMaxMs = dejaProjetees.reduce<number | null>(
        (max, ligne) => {
          if (ligne.occurredAt === null) {
            return max;
          }
          const ms = ligne.occurredAt.getTime();
          return max === null || ms > max ? ms : max;
        },
        null,
      );
      if (occurredMaxMs !== null && occurredAt.getTime() < occurredMaxMs) {
        return;
      }
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
            eventId: evt.id,
            occurredAt,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [
              preferenceNotification.parentId,
              preferenceNotification.typeNotification,
              preferenceNotification.canal,
            ],
            set: {
              actif: pref.actif,
              eventId: evt.id,
              occurredAt,
              updatedAt: new Date(),
            },
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
          eventId: evt.id,
          occurredAt: new Date(evt.occurredAt),
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
            eventId: evt.id,
            occurredAt: new Date(evt.occurredAt),
            updatedAt: new Date(),
          },
          // Garde de monotonie (cf. appliquerContratCree).
          setWhere: sql`${etablissement.occurredAt} is null or ${etablissement.occurredAt} <= excluded.occurred_at`,
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

  /**
   * `FoyerSupprime` : le foyer a été **réellement effacé** côté `svc-foyer` (droit à
   * l'effacement, doc 37 §3). Notifications est le service qui concentre le plus de
   * données personnelles **figées** — corps de messages rendus, destinataires gelés à
   * l'envoi, prénoms d'enfants dans les récaps — donc son effacement local est le plus
   * chargé. Aucune contrainte FK ici : chaque table est vidée explicitement, dans une
   * seule transaction, idempotente via `processed_event`.
   *
   * **Résolution des parents.** L'inbox in-app (`notification`) et les préférences
   * (`preference_notification`) sont clés par `parent_id` et **ne portent aucun
   * `foyer_id`** : c'est précisément pour elles que l'événement transporte `parentIds`.
   * On prend l'**union** du payload et des `foyer_parent` projetés localement, et non
   * le seul payload : une ligne `foyer_parent` projetée ici mais absente du payload
   * (écart transitoire ou définitif entre deux read models distribués) laisserait sinon
   * derrière elle des notifications orphelines — donc à jamais ineffaçables, puisque
   * plus rien ne permettrait de les rattacher à un foyer.
   *
   * **`outbox` n'est PAS purgée.** C'est une file de **publication vivante**, pas un
   * magasin : supprimer une ligne non encore publiée annulerait un événement **en vol**
   * (l'événement d'effacement lui-même y transite). Sa borne est **temporelle** —
   * purge 30 j après publication, doc 37 §3 T7 — et relève du lot suivant.
   *
   * **`dead_letter`, elle, EST purgée.** C'est un magasin **terminal** que plus rien ne
   * relit, et il contient aujourd'hui des payloads **en clair** : tout événement du
   * stream `FOYER` non géré par ce service y atterrit avec son contenu
   * (`IGNORE_TYPE_INCONNU`). Le filtre est un `like` sur le texte du payload — un UUID
   * est assez spécifique pour qu'un faux positif soit irréaliste, et cette forme évite
   * tout cast JSON, qui exploserait sur une ligne `PARSE_KO` (message illisible, payload
   * non-JSON par construction).
   *
   * **`processed_event` n'est PAS touchée** : c'est le garde-fou anti-rejeu (une purge
   * ferait re-consommer tout le stream comme neuf), et doc 37 §3 l'exclut nommément —
   * sa borne dépend de la rétention JetStream, qui n'existe pas encore.
   *
   * **Aucune ré-émission.** Les services aval sont eux aussi abonnés au stream `FOYER`
   * et reçoivent `FoyerSupprime` directement de `svc-foyer` : relayer créerait une
   * seconde source de vérité et un ordre de traitement non garanti.
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
      // Union payload ∪ read model local (cf. docblock) : les parents **retirés**
      // (soft-delete `actif = false`) en font partie — ce sont eux, précisément,
      // dont les notifications survivaient jusqu'ici.
      const parentsProjetes = await tx
        .select()
        .from(foyerParent)
        .where(eq(foyerParent.foyerId, foyerId));
      const parentIds = new Set<string>([
        ...evt.payload.parentIds,
        ...parentsProjetes.map((ligne) => ligne.parentId),
      ]);

      // (1) inbox in-app et (2) préférences : clés par parent, une passe par parent.
      for (const parentId of parentIds) {
        await tx
          .delete(notification)
          .where(eq(notification.parentId, parentId));
        await tx
          .delete(preferenceNotification)
          .where(eq(preferenceNotification.parentId, parentId));
      }

      // (3) → (8) : tout ce qui porte un `foyer_id`, journaux d'envoi d'abord
      // (destinataires et corps figés = la charge PII la plus lourde).
      await tx
        .delete(envoiRecapParent)
        .where(eq(envoiRecapParent.foyerId, foyerId));
      await tx
        .delete(envoiRecapHebdo)
        .where(eq(envoiRecapHebdo.foyerId, foyerId));
      await tx
        .delete(envoiEtablissement)
        .where(eq(envoiEtablissement.foyerId, foyerId));
      await tx
        .delete(notificationHebdo)
        .where(eq(notificationHebdo.foyerId, foyerId));
      await tx.delete(contrat).where(eq(contrat.foyerId, foyerId));
      await tx.delete(etablissement).where(eq(etablissement.foyerId, foyerId));

      // (9) `foyer_parent` en dernier : c'est la table de résolution des parents,
      // elle ne disparaît qu'une fois tout ce qu'elle sert à retrouver effacé.
      await tx.delete(foyerParent).where(eq(foyerParent.foyerId, foyerId));

      // (10) dead-letter : magasin terminal à payloads en clair (cf. docblock).
      await tx
        .delete(deadLetter)
        .where(like(deadLetter.payload, `%${foyerId}%`));
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
