import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { ChevauchementVersionsError } from '@creche-planner/shared-kernel';
import {
  ReferentielService,
  type BaremePsuVue,
  type BaremeTranchesVue,
  type GrilleAbcmVue,
  type GrilleApplicable,
  type JourNonFacturableVue,
} from './referentiel.service.js';

/**
 * Date ISO `YYYY-MM-DD` **calendaire réelle** (AQ-04, doc 27) : `z.iso.date()`
 * valide mois 01-12, jour selon le mois et années bissextiles — là où l'ancienne
 * regex `^\d{4}-\d{2}-\d{2}$` acceptait `2026-13-45`.
 */
const dateIsoSchema = z.iso.date();

@Controller()
export class ReferentielController {
  constructor(private readonly referentiel: ReferentielService) {}

  /** Grille/barème applicable à `(date, tranche, mode)` — cœur de la DoD Phase 4. */
  @Get('grilles/applicable')
  grilleApplicable(
    @Query('date') date?: string,
    @Query('mode') mode?: string,
    @Query('tranche') tranche?: string,
  ): Promise<GrilleApplicable> {
    const dateOk = this.exigerDate(date);
    if (mode === undefined || mode === '') {
      throw new BadRequestException('paramètre « mode » requis');
    }
    const trancheNum =
      tranche === undefined || tranche === '' ? undefined : Number(tranche);
    return this.referentiel.grilleApplicable(dateOk, mode, trancheNum);
  }

  /**
   * Jours non facturables (fériés/fermetures/vacances).
   *
   * @deprecated **Depuis le 2026-09-05 (SFD 31, lot 4), plus aucun appelant.**
   * `svc-planification` dérive désormais ses jours non facturables du calendrier
   * d'ouverture de l'établissement du contrat (RM-31-04, source unique) : cette
   * route ne sert plus la génération des prestations.
   *
   * Elle est **gardée comme filet de repli du déploiement**, pas par oubli : tant
   * que le train qui porte le lot 4 n'est pas passé et vérifié en production, les
   * images précédentes doivent pouvoir refonctionner telles quelles — c'est ce qui
   * rend le retour arrière viable. Pendant la reprise, ne toucher NI cette route
   * NI la table `jour_non_facturable`.
   *
   * **Échéance de suppression : au train suivant celui qui déploie le lot 4**, et
   * au plus tard le **2026-12-31**. La retirer emporte aussi
   * `listerJoursNonFacturables`, la table et son seed.
   */
  @Get('calendrier/jours-non-facturables')
  joursNonFacturables(): Promise<JourNonFacturableVue[]> {
    return this.referentiel.listerJoursNonFacturables();
  }

  /**
   * Liste des grilles ABCM publiées (SFD 30, lot 6) — écran « Tarifs ». Route
   * **sécurisée** (assertion inter-services, référentiel global : pas de scoping
   * foyer). Lecture seule.
   */
  @Get('grilles')
  listerGrilles(): Promise<GrilleAbcmVue[]> {
    return this.referentiel.listerGrilles();
  }

  /**
   * Publie une grille ABCM complète (période + tranches, montants euros) saisie à
   * l'écran (SFD 30, US-30-02). Route **sécurisée** (assertion inter-services, pas
   * de scoping foyer : le catalogue est global). Une période chevauchant une grille
   * existante → **409** (rien d'écrit) ; les autres invariants → 400 (filtre
   * `DomainExceptionFilter`).
   */
  @Post('grilles/abcm')
  publierGrille(@Body() corps: unknown): Promise<GrilleAbcmVue[]> {
    return this.traduireChevauchement(() =>
      this.referentiel.publierGrille(corps),
    );
  }

  /** Publie un barème PSU versionné (SFD 30, lot 6). 409 si période chevauchante. */
  @Post('baremes/psu')
  publierBaremePsu(@Body() corps: unknown): Promise<BaremePsuVue> {
    return this.traduireChevauchement(() =>
      this.referentiel.publierBaremePsu(corps),
    );
  }

  /** Publie un barème de seuils de tranche versionné (SFD 30, lot 6). 409 si chevauchement. */
  @Post('baremes/tranches')
  publierBaremeTranches(@Body() corps: unknown): Promise<BaremeTranchesVue> {
    return this.traduireChevauchement(() =>
      this.referentiel.publierBaremeTranches(corps),
    );
  }

  /**
   * Traduit un `ChevauchementVersionsError` (garde-fou de publication) en **409
   * structuré** (`{ statusCode, code, message }`) pour que le BFF le relaie tel quel
   * et que l'écran affiche un message clair. Les autres `DomainError` retombent sur
   * le `DomainExceptionFilter` global (400).
   */
  private async traduireChevauchement<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (erreur) {
      if (erreur instanceof ChevauchementVersionsError) {
        throw new ConflictException({
          statusCode: 409,
          code: 'PERIODE_CHEVAUCHANTE',
          message: erreur.message,
        });
      }
      throw erreur;
    }
  }

  private exigerDate(date: string | undefined): string {
    if (date === undefined || !dateIsoSchema.safeParse(date).success) {
      throw new BadRequestException(
        'paramètre « date » requis au format YYYY-MM-DD (date calendaire valide)',
      );
    }
    return date;
  }
}
