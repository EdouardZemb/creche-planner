import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, MailerService } from '@creche-planner/nest-commons';
import { MODES_CONTRAT } from '@creche-planner/contracts-planification';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  envoiMail,
  notificationHebdo,
  STATUTS_ENVOI,
  TYPE_VALIDATION_HEBDO,
  type ContratRow,
  type EnvoiMailRow,
  type NotificationHebdoRow,
  type StatutEnvoi,
} from '../database/schema.js';
import { EtablissementService } from '../etablissement/etablissement.service.js';
import {
  cleEtablissementPourMode,
  CLES_ETABLISSEMENT,
  type CleEtablissement,
} from '../etablissement/etablissement.dto.js';
import type { DeltaModifs } from '../validation/validation.diff.js';
import { brouillonService } from '../email/templates/brouillonService.js';
import { loadConfig } from '../config.js';
import type { BrouillonVue, EnvoiResultat } from './envoi.dto.js';

/** Brouillon construit côté service (corps figé + métadonnées de résolution). */
interface BrouillonConstruit {
  readonly contratId: string;
  readonly semaineIso: string;
  readonly etablissementCle: CleEtablissement;
  readonly etablissementLibelle: string;
  readonly destinataire: string;
  readonly sujet: string;
  readonly corps: string;
  readonly texte: string;
  readonly deltaModifs: DeltaModifs;
}

/**
 * Service du **mail au service** (Lot 6) — la première action sortante vers un tiers
 * réel. Deux opérations :
 *
 * - `brouillon` : régénère, en **lecture seule**, le récap (destinataire résolu via
 *   l'annuaire × le mode du contrat, sujet, corps rendu, diff figé du Lot 4) pour la
 *   relecture humaine. Indique si un envoi réel serait neutralisé (`dryRun`).
 * - `envoyer` : **après** le clic « Envoyer », réserve un slot `envoi_mail` (`EN_COURS`)
 *   via la clé `UNIQUE(contrat, semaine, etablissement)`, sollicite le `MailerService`
 *   (garde-fous dry-run/allowlist du Lot 2), puis fige le statut (`ENVOYE`/`DRY_RUN`/
 *   `ECHEC`). **Idempotent** : un second envoi de la même semaine renvoie l'envoi déjà
 *   journalisé sans ré-émettre de mail — on ne spamme jamais une vraie crèche.
 *
 * Le corps est **régénéré côté service** au moment de l'envoi (jamais repris du client) :
 * ce qui est figé dans `envoi_mail.corps` est exactement ce qui part.
 */
@Injectable()
export class EnvoiService {
  private readonly logger = new Logger(EnvoiService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly etablissements: EtablissementService,
    private readonly mailer: MailerService,
  ) {}

  /** Régénère le brouillon (lecture seule) pour la relecture avant envoi. */
  async brouillon(
    contratId: string,
    semaineIso: string,
  ): Promise<BrouillonVue> {
    const b = await this.construire(contratId, semaineIso);
    return {
      contratId: b.contratId,
      semaineIso: b.semaineIso,
      etablissementCle: b.etablissementCle,
      etablissementLibelle: b.etablissementLibelle,
      destinataire: b.destinataire,
      sujet: b.sujet,
      corps: b.corps,
      texte: b.texte,
      deltaModifs: b.deltaModifs,
      dryRun: this.dryRunEffectif(b.destinataire),
    };
  }

  /**
   * Envoie réellement (après relecture) le récap au service. Réserve d'abord le slot
   * `envoi_mail` (idempotence via la clé d'unicité) : si la ligne existe déjà, renvoie
   * l'envoi journalisé sans rien ré-émettre. Sinon sollicite le mailer et fige l'issue.
   */
  async envoyer(contratId: string, semaineIso: string): Promise<EnvoiResultat> {
    const b = await this.construire(contratId, semaineIso);

    const id = randomUUID();
    const insere = await this.db
      .insert(envoiMail)
      .values({
        id,
        contratId: b.contratId,
        semaineIso: b.semaineIso,
        etablissementCle: b.etablissementCle,
        destinataire: b.destinataire,
        sujet: b.sujet,
        corps: b.corps,
        statut: 'EN_COURS',
      })
      .onConflictDoNothing({
        target: [
          envoiMail.contratId,
          envoiMail.semaineIso,
          envoiMail.etablissementCle,
        ],
      })
      .returning({ id: envoiMail.id });

    // Conflit (slot déjà réservé par un envoi antérieur) : idempotent, on renvoie
    // l'envoi déjà journalisé — pas de second mail pour le même récap.
    if (insere.length === 0) {
      const existant = await this.envoiExistant(
        b.contratId,
        b.semaineIso,
        b.etablissementCle,
      );
      this.logger.log(
        `Envoi déjà journalisé pour ${b.contratId}/${b.semaineIso} (${b.etablissementCle}) — ignoré`,
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
        .update(envoiMail)
        .set({ statut, messageId: res.messageId, envoyeLe })
        .where(eq(envoiMail.id, id));
      this.logger.log(
        `Récap ${statut} vers ${b.destinataire} pour ${b.contratId}/${b.semaineIso}`,
      );
      return {
        contratId: b.contratId,
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
        .update(envoiMail)
        .set({ statut: 'ECHEC', erreur: message, envoyeLe })
        .where(eq(envoiMail.id, id));
      this.logger.warn(
        `Échec d'envoi vers ${b.destinataire} pour ${b.contratId}/${b.semaineIso} : ${message}`,
      );
      return {
        contratId: b.contratId,
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
   * Construit le brouillon : résout le contrat (mode → établissement destinataire),
   * lit le `delta_modifs` figé de la semaine et rend le corps. `404` si le contrat,
   * la semaine notifiée ou l'établissement destinataire est introuvable.
   */
  private async construire(
    contratId: string,
    semaineIso: string,
  ): Promise<BrouillonConstruit> {
    const c = await this.contratRow(contratId);
    if (!c) {
      throw new NotFoundException([
        { champ: 'contratId', message: `contrat ${contratId} inconnu` },
      ]);
    }

    const cle = this.cleEtablissement(c.mode);
    const etab = cle ? await this.etablissements.parCle(cle) : undefined;
    if (!cle || !etab) {
      throw new NotFoundException([
        {
          champ: 'etablissement',
          message: `aucun établissement destinataire pour le mode ${c.mode}`,
        },
      ]);
    }

    const notif = await this.notificationRow(contratId, semaineIso);
    if (!notif) {
      throw new NotFoundException([
        {
          champ: 'semaineIso',
          message: `aucune semaine ${semaineIso} notifiée pour le contrat ${contratId}`,
        },
      ]);
    }
    const deltaModifs: DeltaModifs = notif.deltaModifs ?? { jours: [] };

    const rendu = brouillonService({
      enfant: c.enfant,
      semaineIso,
      etablissementLibelle: etab.libelle,
      deltaModifs,
    });

    return {
      contratId,
      semaineIso,
      etablissementCle: cle,
      etablissementLibelle: etab.libelle,
      destinataire: etab.emailService,
      sujet: rendu.subject,
      corps: rendu.html,
      texte: rendu.text,
      deltaModifs,
    };
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

  private async contratRow(contratId: string): Promise<ContratRow | undefined> {
    const lignes = await this.db
      .select()
      .from(contrat)
      .where(eq(contrat.id, contratId));
    return lignes[0];
  }

  private async notificationRow(
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

  private async envoiExistant(
    contratId: string,
    semaineIso: string,
    etablissementCle: string,
  ): Promise<EnvoiMailRow> {
    const lignes = await this.db
      .select()
      .from(envoiMail)
      .where(
        and(
          eq(envoiMail.contratId, contratId),
          eq(envoiMail.semaineIso, semaineIso),
          eq(envoiMail.etablissementCle, etablissementCle),
        ),
      );
    const ligne = lignes[0];
    if (!ligne) {
      // Le conflit d'insert garantit l'existence ; une absence ici signale une course
      // anormale (suppression concurrente) plutôt qu'un cas nominal.
      throw new Error(
        `envoi introuvable après conflit : ${contratId}/${semaineIso}/${etablissementCle}`,
      );
    }
    return ligne;
  }

  private versResultat(ligne: EnvoiMailRow): EnvoiResultat {
    return {
      contratId: ligne.contratId,
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
