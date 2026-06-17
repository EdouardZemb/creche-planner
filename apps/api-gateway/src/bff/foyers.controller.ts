import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  FoyerClient,
  type EnfantVue,
  type FoyerVue,
} from '../clients/foyer.client.js';
import { creerDossierFoyerSchema, valider } from './bff.dto.js';
import { relayer } from './relais.js';

/** Vue agrégée d'un dossier foyer (identité + enfants rattachés). */
interface DossierFoyerVue {
  readonly foyer: FoyerVue;
  readonly enfants: readonly EnfantVue[];
}

/**
 * Façade BFF `/api/v1/foyers` : agrège `svc-foyer`. La création **orchestre** le
 * foyer puis ses enfants en un seul appel orienté écran ; la lecture renvoie le
 * foyer **et** ses enfants en une réponse.
 */
@Controller({ path: 'foyers', version: '1' })
export class FoyersController {
  constructor(private readonly foyers: FoyerClient) {}

  /** Crée un foyer puis rattache ses enfants (orchestration). */
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
      return { foyer, enfants };
    });
  }

  /** Liste les foyers existants (découverte du foyer déjà configuré). */
  @Get()
  lister(): Promise<FoyerVue[]> {
    return relayer(() => this.foyers.lister());
  }

  /** Lit un foyer et ses enfants. */
  @Get(':id')
  lire(@Param('id') id: string): Promise<DossierFoyerVue> {
    return relayer(async () => {
      const [foyer, enfants] = await Promise.all([
        this.foyers.foyer(id),
        this.foyers.enfants(id),
      ]);
      return { foyer, enfants };
    });
  }
}
