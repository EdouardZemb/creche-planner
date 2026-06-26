import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  FoyerClient,
  type EnfantVue,
  type FoyerVue,
  type ParentVue,
} from '../clients/foyer.client.js';
import {
  ajouterParentSchema,
  creerDossierFoyerSchema,
  modifierParentSchema,
  valider,
} from './bff.dto.js';
import { relayer } from './relais.js';

/** Vue agrégée d'un dossier foyer (identité + enfants + parents rattachés). */
interface DossierFoyerVue {
  readonly foyer: FoyerVue;
  readonly enfants: readonly EnfantVue[];
  readonly parents: readonly ParentVue[];
}

/**
 * Façade BFF `/api/v1/foyers` : agrège `svc-foyer`. La création **orchestre** le
 * foyer puis ses enfants et parents en un seul appel orienté écran ; la lecture
 * renvoie le foyer **et** ses enfants/parents en une réponse. Les parents
 * exposent une vraie CRUD (sous-ressource éditable, cf. notifications hebdo).
 */
@Controller({ path: 'foyers', version: '1' })
export class FoyersController {
  constructor(private readonly foyers: FoyerClient) {}

  /** Crée un foyer puis rattache ses enfants et parents (orchestration). */
  @Post()
  creer(@Body() corps: unknown): Promise<DossierFoyerVue> {
    const saisie = valider(creerDossierFoyerSchema, corps);
    return relayer(async () => {
      const foyer = await this.foyers.creerFoyer({
        ressourcesMensuelles: saisie.ressourcesMensuelles,
        rfr: saisie.rfr,
        nbEnfantsACharge: saisie.nbEnfantsACharge,
        nbParts: saisie.nbParts,
      });
      const enfants: EnfantVue[] = [];
      for (const enfant of saisie.enfants) {
        enfants.push(await this.foyers.ajouterEnfant(foyer.id, enfant));
      }
      const parents: ParentVue[] = [];
      for (const parent of saisie.parents) {
        parents.push(await this.foyers.ajouterParent(foyer.id, parent));
      }
      return { foyer, enfants, parents };
    });
  }

  /** Liste les foyers existants (découverte du foyer déjà configuré). */
  @Get()
  lister(): Promise<FoyerVue[]> {
    return relayer(() => this.foyers.lister());
  }

  /** Lit un foyer, ses enfants et ses parents. */
  @Get(':id')
  lire(@Param('id') id: string): Promise<DossierFoyerVue> {
    return relayer(async () => {
      const [foyer, enfants, parents] = await Promise.all([
        this.foyers.foyer(id),
        this.foyers.enfants(id),
        this.foyers.parents(id),
      ]);
      return { foyer, enfants, parents };
    });
  }

  /** Liste les parents actifs d'un foyer. */
  @Get(':id/parents')
  listerParents(@Param('id') id: string): Promise<ParentVue[]> {
    return relayer(() => this.foyers.parents(id));
  }

  /** Rattache un parent au foyer. */
  @Post(':id/parents')
  @HttpCode(HttpStatus.CREATED)
  ajouterParent(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<ParentVue> {
    const saisie = valider(ajouterParentSchema, corps);
    return relayer(() => this.foyers.ajouterParent(id, saisie));
  }

  /** Édite un parent (champs fournis uniquement). */
  @Put(':id/parents/:parentId')
  modifierParent(
    @Param('id') id: string,
    @Param('parentId') parentId: string,
    @Body() corps: unknown,
  ): Promise<ParentVue> {
    const saisie = valider(modifierParentSchema, corps);
    return relayer(() => this.foyers.modifierParent(id, parentId, saisie));
  }

  /** Retire un parent (soft-delete côté `svc-foyer`). */
  @Delete(':id/parents/:parentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  retirerParent(
    @Param('id') id: string,
    @Param('parentId') parentId: string,
  ): Promise<void> {
    return relayer(() => this.foyers.retirerParent(id, parentId));
  }
}
