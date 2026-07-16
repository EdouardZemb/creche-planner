import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  MailerService,
  partitionnerParAllowlist,
} from '@creche-planner/nest-commons';
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
import { EtablissementProjeteService } from '../etablissement/etablissement-projete.service.js';
import { aDesModifs, type DeltaModifs } from '../validation/validation.diff.js';
import {
  brouillonServiceAgrege,
  type EnfantModifie,
} from '../email/templates/brouillonService.js';
import { echapperEnHtml } from '../email/echapperEnHtml.js';
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
  readonly etablissementId: string;
  readonly etablissementLibelle: string;
  /** Adresse visée ; **chaîne vide** `''` quand l'établissement n'est pas joignable. */
  readonly destinataire: string;
  readonly sujet: string;
  readonly corps: string;
  readonly texte: string;
  readonly enfants: readonly EnfantBrouillon[];
  /** Vrai si l'établissement a une adresse de service **ET** est actif (envoi possible). */
  readonly routable: boolean;
  /**
   * Raison de non-routabilité quand `routable === false`, sinon `null`. `'ARCHIVE'` a la
   * priorité sur `'SANS_EMAIL'`.
   */
  readonly raisonNonRoutable: 'SANS_EMAIL' | 'ARCHIVE' | null;
}

/**
 * Service du **mail au service** **agrégé par établissement** (édition hebdo, Phase 4)
 * — l'action sortante vers un tiers réel. Granularité : **un seul mail par
 * établissement** regroupant tous les enfants du foyer dont la semaine a été validée
 * avec modifications (remplace l'envoi par-contrat du Lot 6). Deux opérations :
 *
 * - `brouillon` : régénère, en **lecture seule**, le récap agrégé (destinataire résolu
 *   via la fiche établissement projetée, sujet, corps rendu multi-enfant à partir des diffs figés du Lot 4)
 *   pour la relecture humaine. Indique si un envoi réel serait neutralisé (`dryRun`).
 * - `envoyer` : **après** le clic « Envoyer », réserve un slot `envoi_etablissement`
 *   (`EN_COURS`) via la clé `UNIQUE(foyer, semaine, établissement)`, sollicite le
 *   `MailerService` (garde-fous dry-run/allowlist du Lot 2), puis fige le statut
 *   (`ENVOYE`/`DRY_RUN`/`ECHEC`). **Idempotent** : un second envoi du même récap renvoie
 *   l'envoi déjà journalisé sans ré-émettre de mail — on ne spamme jamais une crèche.
 *
 * Par défaut, le corps est **régénéré côté service** au moment de l'envoi (depuis les
 * deltas figés des contrats `VALIDEE_AVEC_MODIFS`). Le parent peut toutefois **relire et
 * éditer** ce brouillon dans l'app : dans ce cas il fournit `sujet`+`corps` (texte brut),
 * qui sont **envoyés et journalisés tels quels** après échappement HTML (jamais de HTML
 * libre du client). Dans les deux cas, ce qui est figé dans `envoi_etablissement.corps`
 * est exactement ce qui part, et le **destinataire reste résolu côté serveur** (jamais
 * fourni par le client).
 */
@Injectable()
export class EnvoiService {
  private readonly logger = new Logger(EnvoiService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly etablissements: EtablissementProjeteService,
    private readonly mailer: MailerService,
  ) {}

  /** Régénère le brouillon agrégé (lecture seule) pour la relecture avant envoi. */
  async brouillon(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
  ): Promise<BrouillonEtablissementVue> {
    const b = await this.construire(foyerId, semaineIso, etablissementId);
    return {
      foyerId: b.foyerId,
      semaineIso: b.semaineIso,
      etablissementId: b.etablissementId,
      etablissementLibelle: b.etablissementLibelle,
      destinataire: b.destinataire,
      sujet: b.sujet,
      corps: b.corps,
      texte: b.texte,
      enfants: b.enfants,
      routable: b.routable,
      raisonNonRoutable: b.raisonNonRoutable,
      // `dryRun` n'a de sens que pour un envoi possible : neutralisé (`false`) sinon.
      dryRun: b.routable ? this.dryRunEffectif(b.destinataire) : false,
    };
  }

  /**
   * Envoie réellement (après relecture) le récap agrégé au service. Réserve d'abord le
   * slot `envoi_etablissement` (idempotence via la clé d'unicité) : si la ligne existe
   * déjà, renvoie l'envoi journalisé sans rien ré-émettre. Sinon sollicite le mailer et
   * fige l'issue.
   *
   * `corpsEdite` (optionnel) : quand le parent a relu/édité le brouillon dans l'app, il
   * fournit l'objet + le corps en **texte brut**. Ils sont alors envoyés/journalisés tels
   * quels (le corps est échappé en HTML — jamais de HTML libre du client). Absent, le
   * corps est régénéré côté serveur (comportement historique). Le **destinataire**, lui,
   * reste **toujours résolu côté serveur** depuis la fiche établissement.
   */
  async envoyer(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
    corpsEdite?: { sujet: string; corps: string },
  ): Promise<EnvoiEtablissementResultat> {
    const b = await this.construire(foyerId, semaineIso, etablissementId);

    // Ceinture et bretelles côté serveur : un brouillon non routable (crèche sans e-mail
    // ou archivée) est refusé **avant** toute réservation de slot ou sollicitation du
    // mailer — on n'envoie jamais à vide, même si le front laissait passer le clic. Le
    // message dépend de la raison (priorité `'ARCHIVE'` déjà appliquée par `construire`).
    if (!b.routable) {
      throw new BadRequestException([
        {
          champ: 'etablissement',
          message:
            b.raisonNonRoutable === 'ARCHIVE'
              ? 'crèche archivée : réactivez-la avant d’envoyer le récapitulatif'
              : "crèche sans e-mail : ajoutez une adresse avant d'envoyer le récapitulatif",
        },
      ]);
    }

    // Contenu réellement envoyé : soit le texte édité par le parent (échappé en HTML —
    // jamais de HTML libre du client), soit la régénération serveur depuis le delta. Le
    // `corps` figé/envoyé est le fragment HTML (preuve exacte de ce qui est parti) ; le
    // `texte` est la version brute (alternative accessible du mail). Le destinataire
    // reste résolu serveur (`b.destinataire`), jamais fourni par le client.
    const sujet = corpsEdite ? corpsEdite.sujet : b.sujet;
    const html = corpsEdite ? echapperEnHtml(corpsEdite.corps) : b.corps;
    const texte = corpsEdite ? corpsEdite.corps : b.texte;

    const id = randomUUID();
    const insere = await this.db
      .insert(envoiEtablissement)
      .values({
        id,
        foyerId: b.foyerId,
        semaineIso: b.semaineIso,
        etablissementId: b.etablissementId,
        destinataire: b.destinataire,
        sujet,
        corps: html,
        statut: 'EN_COURS',
      })
      .onConflictDoNothing({
        target: [
          envoiEtablissement.foyerId,
          envoiEtablissement.semaineIso,
          envoiEtablissement.etablissementId,
        ],
      })
      .returning({ id: envoiEtablissement.id });

    // Conflit (slot déjà réservé par un envoi antérieur) : idempotent, on renvoie
    // l'envoi déjà journalisé — pas de second mail pour le même récap.
    if (insere.length === 0) {
      const existant = await this.envoiExistant(
        b.foyerId,
        b.semaineIso,
        b.etablissementId,
      );
      this.logger.log(
        `Envoi déjà journalisé pour ${b.foyerId}/${b.semaineIso} (${b.etablissementId}) — ignoré`,
      );
      return this.versResultat(existant);
    }

    // Slot réservé par CET appel : on sollicite le transport et on fige l'issue.
    try {
      const res = await this.mailer.envoyer({
        to: b.destinataire,
        subject: sujet,
        html,
        text: texte,
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
        etablissementId: b.etablissementId,
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
        etablissementId: b.etablissementId,
        destinataire: b.destinataire,
        statut: 'ECHEC',
        messageId: null,
        erreur: message,
        envoyeLe: envoyeLe.toISOString(),
      };
    }
  }

  /**
   * Construit le brouillon agrégé : résout la fiche établissement destinataire (read
   * model projeté), rassemble les contrats du foyer **rattachés à cet établissement**
   * (lien explicite `contrat.etablissement_id`) dont la semaine est `VALIDEE_AVEC_MODIFS`
   * (deltas non vides), et rend un corps multi-enfant. `404` **uniquement** si
   * l'établissement est inconnu ou hors du foyer. Un établissement **connu, du bon foyer,
   * mais sans adresse de service OU archivé** ne 404 pas : le brouillon est construit
   * normalement (le calcul des enfants ne dépend ni de l'e-mail ni de l'état actif) et
   * marqué **non routable** (`destinataire = ''`, `routable = false`,
   * `raisonNonRoutable = 'ARCHIVE'` si archivé, sinon `'SANS_EMAIL'`) afin que le front
   * l'affiche en avertissement au lieu de l'écarter silencieusement. Une liste d'enfants
   * vide rend un récap « aucune modification » (le front ne propose pas l'envoi dans ce cas).
   */
  private async construire(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
  ): Promise<BrouillonConstruit> {
    const etab = await this.etablissements.parId(etablissementId);
    // 404 réservé à l'établissement inconnu ou hors du foyer : un établissement sans
    // e-mail reste un cas nominal (récap non routable), pas une ressource introuvable.
    if (etab === undefined || etab.foyerId !== foyerId) {
      throw new NotFoundException([
        {
          champ: 'etablissement',
          message: `établissement destinataire ${etablissementId} inconnu`,
        },
      ]);
    }

    // Routable ⇔ e-mail présent ET actif (non archivé). `raisonNonRoutable` avec la
    // priorité `'ARCHIVE'` > `'SANS_EMAIL'` : une crèche archivée est signalée
    // « archivée » (réactivable en un geste) même sans e-mail par ailleurs. Le
    // `destinataire` reste vide quand on n'est pas routable (le front ne le lit qu'alors).
    const routable = etab.emailService !== null && etab.actif;
    const raisonNonRoutable: 'SANS_EMAIL' | 'ARCHIVE' | null = !etab.actif
      ? 'ARCHIVE'
      : etab.emailService === null
        ? 'SANS_EMAIL'
        : null;
    const destinataire = routable ? (etab.emailService ?? '') : '';

    const enfants = await this.enfantsConcernes(
      foyerId,
      semaineIso,
      etablissementId,
    );
    const rendu = brouillonServiceAgrege({
      semaineIso,
      etablissementLibelle: etab.nom,
      enfants: enfants.map((e): EnfantModifie => ({
        enfant: e.enfant,
        deltaModifs: e.deltaModifs,
      })),
    });

    return {
      foyerId,
      semaineIso,
      etablissementId,
      etablissementLibelle: etab.nom,
      destinataire,
      sujet: rendu.subject,
      corps: rendu.html,
      texte: rendu.text,
      enfants,
      routable,
      raisonNonRoutable,
    };
  }

  /**
   * Rassemble les enfants du foyer concernés par l'établissement : les semaines
   * `VALIDEE_AVEC_MODIFS` (delta non vide) du foyer dont le contrat est **rattaché** à
   * cet établissement (`contrat.etablissement_id`). Deux requêtes (notifications du foyer
   * + contrats du foyer), jointes en mémoire — la cardinalité est faible (quelques
   * contrats par foyer).
   */
  private async enfantsConcernes(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
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
      if (c?.etablissementId !== etablissementId) {
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

  /**
   * Dry-run **effectif** pour un destinataire : actif si le bac à sable global l'est,
   * ou si l'allowlist (vérifiée **par adresse**, AN-14 — même logique que
   * `MailerService`) ne retient aucun destinataire. Pilote le bandeau
   * d'avertissement avant l'envoi.
   */
  private dryRunEffectif(destinataire: string): boolean {
    const { dryRun, allowlist } = loadConfig().email;
    if (dryRun) {
      return true;
    }
    return (
      partitionnerParAllowlist(destinataire, allowlist).autorises.length === 0
    );
  }

  private async envoiExistant(
    foyerId: string,
    semaineIso: string,
    etablissementId: string,
  ): Promise<EnvoiEtablissementRow> {
    const lignes = await this.db
      .select()
      .from(envoiEtablissement)
      .where(
        and(
          eq(envoiEtablissement.foyerId, foyerId),
          eq(envoiEtablissement.semaineIso, semaineIso),
          eq(envoiEtablissement.etablissementId, etablissementId),
        ),
      );
    const ligne = lignes[0];
    if (!ligne) {
      // Le conflit d'insert garantit l'existence ; une absence ici signale une course
      // anormale (suppression concurrente) plutôt qu'un cas nominal.
      throw new Error(
        `envoi introuvable après conflit : ${foyerId}/${semaineIso}/${etablissementId}`,
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
      etablissementId: ligne.etablissementId,
      destinataire: ligne.destinataire,
      statut: this.statut(ligne.statut),
      messageId: ligne.messageId,
      erreur: ligne.erreur,
      envoyeLe: ligne.envoyeLe ? ligne.envoyeLe.toISOString() : null,
    };
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
