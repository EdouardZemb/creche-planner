import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, MailerService } from '@creche-planner/nest-commons';
import { MODES_CONTRAT } from '@creche-planner/contracts-planification';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  envoiEtablissement,
  notificationHebdo,
  STATUTS_ENVOI,
  TYPE_VALIDATION_HEBDO,
  type ContratRow,
  type EnvoiEtablissementRow,
  type StatutEnvoi,
} from '../database/schema.js';
import { EtablissementService } from '../etablissement/etablissement.service.js';
import {
  cleEtablissementPourMode,
  CLES_ETABLISSEMENT,
  type CleEtablissement,
} from '../etablissement/etablissement.dto.js';
import { aDesModifs, type DeltaModifs } from '../validation/validation.diff.js';
import {
  brouillonServiceAgrege,
  type EnfantModifie,
} from '../email/templates/brouillonService.js';
import { loadConfig } from '../config.js';
import type {
  BrouillonEtablissementVue,
  EnfantBrouillon,
  EnvoiEtablissementResultat,
} from './envoi.dto.js';

/** Brouillon agrégé construit côté service (corps figé + métadonnées de résolution). */
interface BrouillonConstruit {
  readonly foyerId: string;
  readonly semaineIso: string;
  readonly etablissementCle: CleEtablissement;
  readonly etablissementLibelle: string;
  readonly destinataire: string;
  readonly sujet: string;
  readonly corps: string;
  readonly texte: string;
  readonly enfants: readonly EnfantBrouillon[];
}

/**
 * Service du **mail au service** **agrégé par établissement** (édition hebdo, Phase 4)
 * — l'action sortante vers un tiers réel. Granularité : **un seul mail par
 * établissement** regroupant tous les enfants du foyer dont la semaine a été validée
 * avec modifications (remplace l'envoi par-contrat du Lot 6). Deux opérations :
 *
 * - `brouillon` : régénère, en **lecture seule**, le récap agrégé (destinataire résolu
 *   via l'annuaire, sujet, corps rendu multi-enfant à partir des diffs figés du Lot 4)
 *   pour la relecture humaine. Indique si un envoi réel serait neutralisé (`dryRun`).
 * - `envoyer` : **après** le clic « Envoyer », réserve un slot `envoi_etablissement`
 *   (`EN_COURS`) via la clé `UNIQUE(foyer, semaine, établissement)`, sollicite le
 *   `MailerService` (garde-fous dry-run/allowlist du Lot 2), puis fige le statut
 *   (`ENVOYE`/`DRY_RUN`/`ECHEC`). **Idempotent** : un second envoi du même récap renvoie
 *   l'envoi déjà journalisé sans ré-émettre de mail — on ne spamme jamais une crèche.
 *
 * Le corps est **régénéré côté service** au moment de l'envoi (jamais repris du client) :
 * ce qui est figé dans `envoi_etablissement.corps` est exactement ce qui part. Seuls les
 * contrats `VALIDEE_AVEC_MODIFS` (deltas non vides) alimentent le récap.
 */
@Injectable()
export class EnvoiService {
  private readonly logger = new Logger(EnvoiService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly etablissements: EtablissementService,
    private readonly mailer: MailerService,
  ) {}

  /** Régénère le brouillon agrégé (lecture seule) pour la relecture avant envoi. */
  async brouillon(
    foyerId: string,
    semaineIso: string,
    cle: CleEtablissement,
  ): Promise<BrouillonEtablissementVue> {
    const b = await this.construire(foyerId, semaineIso, cle);
    return {
      foyerId: b.foyerId,
      semaineIso: b.semaineIso,
      etablissementCle: b.etablissementCle,
      etablissementLibelle: b.etablissementLibelle,
      destinataire: b.destinataire,
      sujet: b.sujet,
      corps: b.corps,
      texte: b.texte,
      enfants: b.enfants,
      dryRun: this.dryRunEffectif(b.destinataire),
    };
  }

  /**
   * Envoie réellement (après relecture) le récap agrégé au service. Réserve d'abord le
   * slot `envoi_etablissement` (idempotence via la clé d'unicité) : si la ligne existe
   * déjà, renvoie l'envoi journalisé sans rien ré-émettre. Sinon sollicite le mailer et
   * fige l'issue.
   */
  async envoyer(
    foyerId: string,
    semaineIso: string,
    cle: CleEtablissement,
  ): Promise<EnvoiEtablissementResultat> {
    const b = await this.construire(foyerId, semaineIso, cle);

    const id = randomUUID();
    const insere = await this.db
      .insert(envoiEtablissement)
      .values({
        id,
        foyerId: b.foyerId,
        semaineIso: b.semaineIso,
        etablissementCle: b.etablissementCle,
        destinataire: b.destinataire,
        sujet: b.sujet,
        corps: b.corps,
        statut: 'EN_COURS',
      })
      .onConflictDoNothing({
        target: [
          envoiEtablissement.foyerId,
          envoiEtablissement.semaineIso,
          envoiEtablissement.etablissementCle,
        ],
      })
      .returning({ id: envoiEtablissement.id });

    // Conflit (slot déjà réservé par un envoi antérieur) : idempotent, on renvoie
    // l'envoi déjà journalisé — pas de second mail pour le même récap.
    if (insere.length === 0) {
      const existant = await this.envoiExistant(
        b.foyerId,
        b.semaineIso,
        b.etablissementCle,
      );
      this.logger.log(
        `Envoi déjà journalisé pour ${b.foyerId}/${b.semaineIso} (${b.etablissementCle}) — ignoré`,
      );
      return this.versResultat(existant);
    }

    // Slot réservé par CET appel : on sollicite le transport et on fige l'issue.
    try {
      const res = await this.mailer.envoyer({
        to: b.destinataire,
        subject: b.sujet,
        html: b.corps,
        text: b.texte,
      });
      const statut: StatutEnvoi = res.dryRun ? 'DRY_RUN' : 'ENVOYE';
      const envoyeLe = new Date();
      await this.db
        .update(envoiEtablissement)
        .set({ statut, messageId: res.messageId, envoyeLe })
        .where(eq(envoiEtablissement.id, id));
      this.logger.log(
        `Récap ${statut} vers ${b.destinataire} pour ${b.foyerId}/${b.semaineIso}`,
      );
      return {
        foyerId: b.foyerId,
        semaineIso: b.semaineIso,
        etablissementCle: b.etablissementCle,
        destinataire: b.destinataire,
        statut,
        messageId: res.messageId,
        erreur: null,
        envoyeLe: envoyeLe.toISOString(),
      };
    } catch (erreur) {
      const message = erreur instanceof Error ? erreur.message : String(erreur);
      const envoyeLe = new Date();
      await this.db
        .update(envoiEtablissement)
        .set({ statut: 'ECHEC', erreur: message, envoyeLe })
        .where(eq(envoiEtablissement.id, id));
      this.logger.warn(
        `Échec d'envoi vers ${b.destinataire} pour ${b.foyerId}/${b.semaineIso} : ${message}`,
      );
      return {
        foyerId: b.foyerId,
        semaineIso: b.semaineIso,
        etablissementCle: b.etablissementCle,
        destinataire: b.destinataire,
        statut: 'ECHEC',
        messageId: null,
        erreur: message,
        envoyeLe: envoyeLe.toISOString(),
      };
    }
  }

  /**
   * Construit le brouillon agrégé : résout l'établissement destinataire, rassemble les
   * contrats du foyer rattachés à cet établissement dont la semaine est
   * `VALIDEE_AVEC_MODIFS` (deltas non vides), et rend un corps multi-enfant. `404` si
   * l'établissement destinataire est inconnu. Une liste d'enfants vide rend un récap
   * « aucune modification » (le front ne propose pas l'envoi dans ce cas).
   */
  private async construire(
    foyerId: string,
    semaineIso: string,
    cle: CleEtablissement,
  ): Promise<BrouillonConstruit> {
    const etab = await this.etablissements.parCle(cle);
    if (!etab) {
      throw new NotFoundException([
        {
          champ: 'etablissement',
          message: `établissement destinataire ${cle} inconnu`,
        },
      ]);
    }

    const enfants = await this.enfantsConcernes(foyerId, semaineIso, cle);
    const rendu = brouillonServiceAgrege({
      semaineIso,
      etablissementLibelle: etab.libelle,
      enfants: enfants.map(
        (e): EnfantModifie => ({
          enfant: e.enfant,
          deltaModifs: e.deltaModifs,
        }),
      ),
    });

    return {
      foyerId,
      semaineIso,
      etablissementCle: cle,
      etablissementLibelle: etab.libelle,
      destinataire: etab.emailService,
      sujet: rendu.subject,
      corps: rendu.html,
      texte: rendu.text,
      enfants,
    };
  }

  /**
   * Rassemble les enfants du foyer concernés par l'établissement `cle` : les semaines
   * `VALIDEE_AVEC_MODIFS` (delta non vide) du foyer dont le mode du contrat se résout
   * vers cette clé. Deux requêtes (notifications du foyer + contrats du foyer), jointes
   * en mémoire — la cardinalité est faible (quelques contrats par foyer).
   */
  private async enfantsConcernes(
    foyerId: string,
    semaineIso: string,
    cle: CleEtablissement,
  ): Promise<EnfantBrouillon[]> {
    const notifs = await this.db
      .select()
      .from(notificationHebdo)
      .where(
        and(
          eq(notificationHebdo.foyerId, foyerId),
          eq(notificationHebdo.semaineIso, semaineIso),
          eq(notificationHebdo.type, TYPE_VALIDATION_HEBDO),
          eq(notificationHebdo.statut, 'VALIDEE_AVEC_MODIFS'),
        ),
      );
    if (notifs.length === 0) {
      return [];
    }

    const contrats = await this.db
      .select()
      .from(contrat)
      .where(eq(contrat.foyerId, foyerId));
    const parId = new Map<string, ContratRow>(contrats.map((c) => [c.id, c]));

    const enfants: EnfantBrouillon[] = [];
    for (const n of notifs) {
      const c = parId.get(n.contratId);
      if (!c || this.cleEtablissement(c.mode) !== cle) {
        continue;
      }
      const delta: DeltaModifs = n.deltaModifs ?? { jours: [] };
      if (!aDesModifs(delta)) {
        continue;
      }
      enfants.push({ contratId: c.id, enfant: c.enfant, deltaModifs: delta });
    }
    // Ordre déterministe (prénom puis contrat) pour un corps stable et testable.
    enfants.sort(
      (a, b) =>
        a.enfant.localeCompare(b.enfant) ||
        a.contratId.localeCompare(b.contratId),
    );
    return enfants;
  }

  /** Résout la clé d'établissement depuis le mode du contrat (renarrow sûr). */
  private cleEtablissement(mode: string): CleEtablissement | undefined {
    const connu = MODES_CONTRAT.find((m) => m === mode);
    return connu ? cleEtablissementPourMode(connu) : undefined;
  }

  /**
   * Dry-run **effectif** pour un destinataire : actif si le bac à sable global l'est,
   * ou si une allowlist est renseignée et n'inclut pas l'adresse (même logique que
   * `MailerService`). Pilote le bandeau d'avertissement avant l'envoi.
   */
  private dryRunEffectif(destinataire: string): boolean {
    const { dryRun, allowlist } = loadConfig().email;
    if (dryRun) {
      return true;
    }
    return allowlist.length > 0 && !allowlist.includes(destinataire);
  }

  private async envoiExistant(
    foyerId: string,
    semaineIso: string,
    etablissementCle: string,
  ): Promise<EnvoiEtablissementRow> {
    const lignes = await this.db
      .select()
      .from(envoiEtablissement)
      .where(
        and(
          eq(envoiEtablissement.foyerId, foyerId),
          eq(envoiEtablissement.semaineIso, semaineIso),
          eq(envoiEtablissement.etablissementCle, etablissementCle),
        ),
      );
    const ligne = lignes[0];
    if (!ligne) {
      // Le conflit d'insert garantit l'existence ; une absence ici signale une course
      // anormale (suppression concurrente) plutôt qu'un cas nominal.
      throw new Error(
        `envoi introuvable après conflit : ${foyerId}/${semaineIso}/${etablissementCle}`,
      );
    }
    return ligne;
  }

  private versResultat(
    ligne: EnvoiEtablissementRow,
  ): EnvoiEtablissementResultat {
    return {
      foyerId: ligne.foyerId,
      semaineIso: ligne.semaineIso,
      etablissementCle: this.cle(ligne.etablissementCle),
      destinataire: ligne.destinataire,
      statut: this.statut(ligne.statut),
      messageId: ligne.messageId,
      erreur: ligne.erreur,
      envoyeLe: ligne.envoyeLe ? ligne.envoyeLe.toISOString() : null,
    };
  }

  /** Renarrow d'une clé d'établissement lue en base. */
  private cle(valeur: string): CleEtablissement {
    const connue = CLES_ETABLISSEMENT.find((c) => c === valeur);
    if (!connue) {
      throw new Error(`clé d'établissement inconnue en base : ${valeur}`);
    }
    return connue;
  }

  /** Renarrow d'un statut d'envoi lu en base. */
  private statut(valeur: string): StatutEnvoi {
    const connu = STATUTS_ENVOI.find((s) => s === valeur);
    if (!connu) {
      throw new Error(`statut d'envoi inconnu en base : ${valeur}`);
    }
    return connu;
  }
}
