import { Body, Controller, Get, Logger, Post } from '@nestjs/common';
import {
  ReferentielClient,
  type BaremePsuVue,
  type BaremeTranchesVue,
  type GrilleAbcmVue,
} from '../clients/referentiel.client.js';
import { AdminSeulement } from '../security/admin.decorator.js';
import { relayer } from './relais.js';

/**
 * Façade BFF `/api/v1/referentiel` : publication du **catalogue tarifaire**
 * (grilles ABCM, barèmes PSU/tranches) depuis l'écran « Tarifs » (SFD 30, lot 6).
 *
 * Le référentiel est **global** (une seule source de vérité pour tout le produit) :
 * ces routes ne portent **pas** de `@FoyerScope` (le scoping par foyer n'aurait pas
 * de sens). Un chevauchement de période remonté par le service (**409** structuré)
 * est relayé tel quel à l'écran.
 *
 * **Lecture ouverte, écriture réservée à l'admin (AN-16).** Que la donnée soit
 * globale justifie l'absence de scoping par foyer ; l'inverse en découle pour
 * l'écriture. Une grille ABCM ou un barème PSU pilote le **calcul de coût de tous
 * les foyers** : la publication est donc `@AdminSeulement()`, comme la création de
 * foyer et la CRUD parents. Le `GET` reste ouvert — consulter le catalogue est
 * légitime pour tout parent.
 *
 * L'`AdminGuard` étant **opt-in** (allowlist `ADMIN_EMAILS` vide ⇒ inactif), ce
 * décorateur n'introduit **aucun 403** dans la prod actuelle : il place la route
 * sous la même bascule que les autres écritures privilégiées. La fermer reste un
 * geste d'exploitation (`AM-27`) — c'est ce que le décorateur rend possible, et
 * l'écran Tarifs masque désormais le formulaire quand `MoiVue.admin` est faux,
 * pour ne pas proposer un geste que le serveur refuserait.
 */
@Controller({ path: 'referentiel', version: '1' })
export class ReferentielBffController {
  private readonly logger = new Logger(ReferentielBffController.name);

  constructor(private readonly referentiel: ReferentielClient) {}

  /** GET `/api/v1/referentiel/grilles` — liste des grilles ABCM publiées. */
  @Get('grilles')
  listerGrilles(): Promise<GrilleAbcmVue[]> {
    return relayer(() => this.referentiel.listerGrilles());
  }

  /** POST `/api/v1/referentiel/grilles` — publie une grille complète (201 ; **409** si chevauchement). */
  @AdminSeulement()
  @Post('grilles')
  publierGrille(@Body() corps: unknown): Promise<GrilleAbcmVue[]> {
    this.logger.log('Publication d’une grille ABCM (écran Tarifs)');
    return relayer(() => this.referentiel.publierGrille(corps));
  }

  /** POST `/api/v1/referentiel/baremes/psu` — publie un barème PSU (201 ; **409**). */
  @AdminSeulement()
  @Post('baremes/psu')
  publierBaremePsu(@Body() corps: unknown): Promise<BaremePsuVue> {
    this.logger.log('Publication d’un barème PSU (écran Tarifs)');
    return relayer(() => this.referentiel.publierBaremePsu(corps));
  }

  /** POST `/api/v1/referentiel/baremes/tranches` — publie un barème de seuils (201 ; **409**). */
  @AdminSeulement()
  @Post('baremes/tranches')
  publierBaremeTranches(@Body() corps: unknown): Promise<BaremeTranchesVue> {
    this.logger.log('Publication d’un barème de tranches (écran Tarifs)');
    return relayer(() => this.referentiel.publierBaremeTranches(corps));
  }
}
