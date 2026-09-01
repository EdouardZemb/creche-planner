import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  CLOCK,
  DRIZZLE,
  type Acteur,
  type Clock,
} from '@creche-planner/nest-commons';
import { Money } from '@creche-planner/shared-kernel';
import { jourCourantParis } from '@creche-planner/shared-semaine';
import {
  SEUIL_ALERTE_ECHEANCE_JOURS,
  calculerSuiviUa,
  type EtatSessionUa,
  type SuiviUa,
  type TypeSessionUa,
} from '@creche-planner/tarification-domain';
import type { Database } from '../database/database.types.js';
import {
  engagementUa,
  sessionUa,
  type EngagementUaRow,
  type SessionUaRow,
} from '../database/schema.js';
import { JournalAuditService } from '../audit/journal-audit.service.js';
import { ACTIONS_AUDIT } from '../audit/journal-audit.actions.js';
import type {
  AjouterSessionDto,
  DeclarerEngagementDto,
  ModifierSessionDto,
} from './unites-associatives.dto.js';

/** L'engagement d'une période, tel que l'API le rend. */
export interface EngagementUaVue {
  readonly id: string;
  readonly foyerId: string;
  readonly debut: string;
  readonly fin: string;
  readonly quotaHeures: number;
  readonly valeurUaCentimes: number;
  readonly cautionCentimes: number | null;
}

/** Une session de bénévolat, telle que l'API la rend. */
export interface SessionUaVue {
  readonly id: string;
  readonly engagementId: string;
  readonly date: string;
  readonly dureeHeures: number;
  readonly type: TypeSessionUa;
  readonly realisePar: string | null;
  readonly etablissementId: string | null;
  readonly etat: EtatSessionUa;
  /**
   * Session `PREVUE` dont la date est passée : « à confirmer ». Dérivée, jamais
   * stockée — le temps qui passe ne change pas un état en base (`RM-40-06`), il
   * change la lecture qu'on en fait aujourd'hui.
   */
  readonly aConfirmer: boolean;
}

/**
 * Le suivi complet d'un foyer (US-40-04). `engagement: null` = aucune période
 * déclarée : l'écran propose alors la déclaration, il n'affiche pas trois zéros
 * qui laisseraient croire que le foyer est à jour.
 */
export interface SuiviUaVue {
  readonly foyerId: string;
  /** Jour de référence des compteurs, ISO — l'écran peut le citer. */
  readonly aujourdhui: string;
  readonly engagement: EngagementUaVue | null;
  readonly compteurs: SuiviUa | null;
  readonly sessions: readonly SessionUaVue[];
  /** Seuil d'alerte d'échéance appliqué, en jours (US-40-05 CA1). */
  readonly seuilAlerteJours: number;
}

/**
 * **Suivi des unités associatives** (SFD 40) — la seule écriture *humaine* de ce
 * service. Elle vit ici, et non dans `svc-foyer`, parce que Tarification est le
 * contexte autorisé à appeler le domaine qui dérive le coût des UA manquantes
 * (doc 02 §4.5) : y placer la saisie évite de dupliquer la formule ou d'inverser
 * une frontière de contexte.
 *
 * **Ce que ce service ne fait pas** : réserver un créneau. Le site travaux de
 * l'association est le système de réservation (`RM-40-01`) ; ce qui est saisi ici
 * est une **recopie** d'un engagement pris ailleurs.
 */
@Injectable()
export class UnitesAssociativesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(CLOCK) private readonly horloge: Clock,
    private readonly audit: JournalAuditService,
  ) {}

  /**
   * Le suivi du foyer à la date du jour : engagement **courant** (celui dont la
   * période couvre aujourd'hui, à défaut le plus récent), ses sessions et les
   * trois compteurs.
   */
  async suivi(foyerId: string): Promise<SuiviUaVue> {
    const aujourdhui = this.aujourdhui();
    const engagement = await this.engagementCourant(foyerId, aujourdhui);
    if (engagement === undefined) {
      return {
        foyerId,
        aujourdhui,
        engagement: null,
        compteurs: null,
        sessions: [],
        seuilAlerteJours: SEUIL_ALERTE_ECHEANCE_JOURS,
      };
    }
    const lignes = await this.db
      .select()
      .from(sessionUa)
      .where(eq(sessionUa.engagementId, engagement.id))
      .orderBy(asc(sessionUa.date));
    const vue = vueEngagement(engagement);
    return {
      foyerId,
      aujourdhui,
      engagement: vue,
      compteurs: calculerSuiviUa(
        {
          quotaHeures: vue.quotaHeures,
          valeurUa: Money.depuisCentimes(vue.valeurUaCentimes),
          fin: vue.fin,
        },
        lignes.map((ligne) => ({
          date: ligne.date,
          dureeHeures: Number(ligne.dureeHeures),
          etat: ligne.etat as EtatSessionUa,
        })),
        aujourdhui,
      ),
      sessions: lignes.map((ligne) => vueSession(ligne, aujourdhui)),
      seuilAlerteJours: SEUIL_ALERTE_ECHEANCE_JOURS,
    };
  }

  /**
   * Déclare l'engagement d'une période (US-40-01). Refuse un **chevauchement**
   * avec une période déjà déclarée pour ce foyer (CA2) : deux périodes qui se
   * recouvrent rendraient le « reste à faire » ambigu, et l'ambiguïté d'un compteur
   * est pire que son absence.
   */
  async declarerEngagement(
    foyerId: string,
    dto: DeclarerEngagementDto,
    acteur: Acteur,
  ): Promise<EngagementUaVue> {
    const existants = await this.db
      .select()
      .from(engagementUa)
      .where(eq(engagementUa.foyerId, foyerId));
    const chevauche = existants.find(
      (e) => dto.debut <= e.fin && e.debut <= dto.fin,
    );
    if (chevauche !== undefined) {
      throw new ConflictException(
        `une période d'unités associatives couvre déjà ces dates (${chevauche.debut} → ${chevauche.fin})`,
      );
    }
    return this.db.transaction(async (tx) => {
      const [ligne] = await tx
        .insert(engagementUa)
        .values({
          foyerId,
          debut: dto.debut,
          fin: dto.fin,
          quotaHeures: String(dto.quotaHeures),
          valeurUaCentimes: dto.valeurUaCentimes,
          cautionCentimes: dto.cautionCentimes ?? null,
        })
        .returning();
      if (ligne === undefined) {
        throw new ConflictException("l'engagement n'a pas pu être enregistré");
      }
      await this.audit.consigner(tx, {
        foyerId,
        action: ACTIONS_AUDIT.ENGAGEMENT_UA_DECLARE,
        cibleType: 'engagement_ua',
        cibleId: ligne.id,
        acteur,
      });
      return vueEngagement(ligne);
    });
  }

  /** Note un créneau pris sur le site travaux (US-40-02). Naît `PREVUE` (CA2). */
  async ajouterSession(
    foyerId: string,
    dto: AjouterSessionDto,
    acteur: Acteur,
  ): Promise<SessionUaVue> {
    const engagement = await this.engagementDuFoyer(foyerId, dto.engagementId);
    if (dto.date < engagement.debut || dto.date > engagement.fin) {
      throw new ConflictException(
        `la date ${dto.date} est hors de la période déclarée (${engagement.debut} → ${engagement.fin})`,
      );
    }
    return this.db.transaction(async (tx) => {
      const [ligne] = await tx
        .insert(sessionUa)
        .values({
          engagementId: engagement.id,
          foyerId,
          date: dto.date,
          dureeHeures: String(dto.dureeHeures),
          type: dto.type,
          realisePar: dto.realisePar ?? null,
          etablissementId: dto.etablissementId ?? null,
          etat: 'PREVUE',
        })
        .returning();
      if (ligne === undefined) {
        throw new ConflictException("la session n'a pas pu être enregistrée");
      }
      await this.audit.consigner(tx, {
        foyerId,
        action: ACTIONS_AUDIT.SESSION_UA_AJOUTEE,
        cibleType: 'session_ua',
        cibleId: ligne.id,
        acteur,
      });
      return vueSession(ligne, this.aujourdhui());
    });
  }

  /**
   * Marque une session réalisée, annulée, ou en corrige les champs (US-40-03).
   * Aucune transition n'est automatique : c'est ce geste, et lui seul, qui déplace
   * des heures d'un compteur à l'autre (`RM-40-06`).
   */
  async modifierSession(
    foyerId: string,
    sessionId: string,
    dto: ModifierSessionDto,
    acteur: Acteur,
  ): Promise<SessionUaVue> {
    await this.sessionDuFoyer(foyerId, sessionId);
    return this.db.transaction(async (tx) => {
      const [ligne] = await tx
        .update(sessionUa)
        .set({
          ...(dto.etat !== undefined ? { etat: dto.etat } : {}),
          ...(dto.date !== undefined ? { date: dto.date } : {}),
          ...(dto.dureeHeures !== undefined
            ? { dureeHeures: String(dto.dureeHeures) }
            : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.realisePar !== undefined
            ? { realisePar: dto.realisePar }
            : {}),
          majLe: this.horloge.maintenant(),
        })
        .where(and(eq(sessionUa.id, sessionId), eq(sessionUa.foyerId, foyerId)))
        .returning();
      if (ligne === undefined) {
        throw new NotFoundException('session introuvable');
      }
      await this.audit.consigner(tx, {
        foyerId,
        action: ACTIONS_AUDIT.SESSION_UA_MODIFIEE,
        cibleType: 'session_ua',
        cibleId: sessionId,
        acteur,
      });
      return vueSession(ligne, this.aujourdhui());
    });
  }

  /**
   * Supprime une session saisie par erreur. À distinguer d'une **annulation**
   * (`etat = ANNULEE`), qui garde la trace d'un créneau qui a existé : effacer et
   * annuler ne racontent pas la même histoire, et le parent choisit laquelle.
   */
  async supprimerSession(
    foyerId: string,
    sessionId: string,
    acteur: Acteur,
  ): Promise<void> {
    await this.sessionDuFoyer(foyerId, sessionId);
    await this.db.transaction(async (tx) => {
      // La ligne d'audit s'écrit AVANT la suppression : aucune clé étrangère ne la
      // rattache à la session (elle porte le foyer), elle survit donc — contrairement
      // à l'effacement d'un foyer côté `svc-foyer`, que la cascade emporte.
      await this.audit.consigner(tx, {
        foyerId,
        action: ACTIONS_AUDIT.SESSION_UA_SUPPRIMEE,
        cibleType: 'session_ua',
        cibleId: sessionId,
        acteur,
      });
      await tx
        .delete(sessionUa)
        .where(
          and(eq(sessionUa.id, sessionId), eq(sessionUa.foyerId, foyerId)),
        );
    });
  }

  /** Jour de référence, en Europe/Paris — jamais un `new Date()` en dur. */
  private aujourdhui(): string {
    return jourCourantParis(this.horloge.maintenant());
  }

  /**
   * L'engagement **courant** : celui dont la période couvre le jour de référence.
   * À défaut, le plus récent — un foyer qui consulte le 15 juin, entre deux
   * périodes, doit voir le bilan de celle qui vient de se clore plutôt qu'un écran
   * vide.
   */
  private async engagementCourant(
    foyerId: string,
    aujourdhui: string,
  ): Promise<EngagementUaRow | undefined> {
    const lignes = await this.db
      .select()
      .from(engagementUa)
      .where(eq(engagementUa.foyerId, foyerId))
      .orderBy(asc(engagementUa.debut));
    return (
      lignes.find((e) => e.debut <= aujourdhui && aujourdhui <= e.fin) ??
      lignes.at(-1)
    );
  }

  /** Charge un engagement en exigeant qu'il appartienne au foyer de la requête. */
  private async engagementDuFoyer(
    foyerId: string,
    engagementId: string,
  ): Promise<EngagementUaRow> {
    const [ligne] = await this.db
      .select()
      .from(engagementUa)
      .where(
        and(
          eq(engagementUa.id, engagementId),
          eq(engagementUa.foyerId, foyerId),
        ),
      );
    if (ligne === undefined) {
      throw new NotFoundException('engagement introuvable');
    }
    return ligne;
  }

  /**
   * Charge une session en exigeant qu'elle appartienne au foyer de la requête.
   * Le `@ScopeFoyerInterServices({ query: 'foyer' })` du contrôleur borne déjà le
   * foyer à ceux de l'assertion ; cette vérification-ci borne la **ressource** à ce
   * foyer, sans quoi un identifiant de session d'un autre foyer passerait.
   */
  private async sessionDuFoyer(
    foyerId: string,
    sessionId: string,
  ): Promise<SessionUaRow> {
    const [ligne] = await this.db
      .select()
      .from(sessionUa)
      .where(and(eq(sessionUa.id, sessionId), eq(sessionUa.foyerId, foyerId)));
    if (ligne === undefined) {
      throw new NotFoundException('session introuvable');
    }
    return ligne;
  }
}

/** `numeric` voyage en chaîne côté Drizzle : le nombre est reconstruit ici, une fois. */
function vueEngagement(ligne: EngagementUaRow): EngagementUaVue {
  return {
    id: ligne.id,
    foyerId: ligne.foyerId,
    debut: ligne.debut,
    fin: ligne.fin,
    quotaHeures: Number(ligne.quotaHeures),
    valeurUaCentimes: ligne.valeurUaCentimes,
    cautionCentimes: ligne.cautionCentimes,
  };
}

function vueSession(ligne: SessionUaRow, aujourdhui: string): SessionUaVue {
  return {
    id: ligne.id,
    engagementId: ligne.engagementId,
    date: ligne.date,
    dureeHeures: Number(ligne.dureeHeures),
    type: ligne.type as TypeSessionUa,
    realisePar: ligne.realisePar,
    etablissementId: ligne.etablissementId,
    etat: ligne.etat as EtatSessionUa,
    aConfirmer: ligne.etat === 'PREVUE' && ligne.date < aujourdhui,
  };
}
