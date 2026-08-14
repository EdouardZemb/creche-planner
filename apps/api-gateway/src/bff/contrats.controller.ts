import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  PlanificationClient,
  type ContratVersionVue,
  type ContratVue,
  type ImpactVersion,
  type LirePlanningReponse,
  type SaisieAvenant,
  type SaisieContrat,
  type SaisieCorrectionVersion,
} from '../clients/planification.client.js';
import { NotificationsClient } from '../clients/notifications.client.js';
import {
  corrigerVersionSchema,
  creerAvenantSchema,
  creerContratSchema,
  ecrirePlanningSchema,
  modifierContratSchema,
  moisSchema,
  semaineIsoSchema,
  valider,
} from './bff.dto.js';
import { FoyerScope } from '../security/foyer-scope.decorator.js';
import { relayer } from './relais.js';
import { RessourceCreee } from './ressource-creee.decorator.js';

/**
 * Façade BFF `/api/v1/contrats` : relaie `svc-planification` (création de contrat
 * crèche/ABCM et écriture du planning mensuel réel ou simulé).
 */
/**
 * Aperçu d'impact d'une version **enrichi** (SFD 30, US-30-05) : les mois recalculés
 * (`moisCouverts`, de svc-planification) et, parmi eux, ceux déjà **communiqués** à un
 * établissement (`moisCommuniques`, croisé avec le suivi des envois de svc-notifications).
 * `moisCommuniques ⊆ moisCouverts`. Sert l'avertissement « déjà envoyé » avant correction.
 */
export interface ImpactVersionEnrichi extends ImpactVersion {
  readonly moisCommuniques: string[];
}

@Controller({ path: 'contrats', version: '1' })
export class ContratsController {
  constructor(
    private readonly planification: PlanificationClient,
    private readonly notifications: NotificationsClient,
  ) {}

  /** Liste les contrats d'un foyer : `?foyer=<uuid>`. */
  @Get()
  @FoyerScope('query:foyer')
  lister(
    @Query('foyer') foyer: string | undefined,
  ): Promise<readonly ContratVue[]> {
    if (!foyer) {
      throw new BadRequestException('paramètre « foyer » requis');
    }
    return relayer(() => this.planification.listerContrats(foyer));
  }

  /** Crée un contrat de garde. */
  @Post()
  @FoyerScope('body:foyerId')
  @RessourceCreee((vue: ContratVue) => vue.id)
  creer(@Body() corps: unknown): Promise<ContratVue> {
    const saisie = valider(creerContratSchema, corps);
    return relayer(() =>
      this.planification.creerContrat(saisie as SaisieContrat),
    );
  }

  /**
   * Modifie les **paramètres versionnés courants** d'un contrat (SFD 30 lot 4).
   * URL BFF inchangée (le web « durcit » un contrat par ce chemin) mais le relais
   * vise `PUT /contrats/:id/version-courante` amont : correction **non
   * destructive** (les plannings saisis survivent), limitée aux champs versionnés.
   */
  @Put(':id')
  @FoyerScope('contrat:id')
  modifier(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<ContratVue> {
    const saisie = valider(modifierContratSchema, corps);
    return relayer(() =>
      this.planification.modifierContrat(id, saisie as SaisieContrat),
    );
  }

  /**
   * Crée un **avenant** : nouvelle version du contrat à date d'effet (SFD 30
   * lot 4, US-30-01). 201 ; 409 si une version existe déjà à cette date ; 400 si
   * la date précède le début du contrat.
   *
   * **Pas de `@RessourceCreee` ici** (lot 7, `AM-39`), et c'est un constat, pas
   * un oubli : la réponse est le **contrat** mis à jour, pas la version créée.
   * L'identifiant de la version ne quitte jamais `svc-planification` — le nommer
   * demanderait un aller-retour de plus (`GET /contrats/:id/versions`) puis une
   * *supposition* sur celle des lignes qui est la nouvelle. Un `Location` faux
   * serait pire qu'absent : la RFC en fait l'URI de la ressource créée, et un
   * client qui la suivrait tomberait sur le contrat.
   */
  @Post(':id/versions')
  @FoyerScope('contrat:id')
  creerAvenant(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<ContratVue> {
    const saisie = valider(creerAvenantSchema, corps);
    return relayer(() =>
      this.planification.creerAvenant(id, saisie as SaisieAvenant),
    );
  }

  /** Historique des versions d'un contrat (US-30-04/06). */
  @Get(':id/versions')
  @FoyerScope('contrat:id')
  listerVersions(@Param('id') id: string): Promise<ContratVersionVue[]> {
    return relayer(() => this.planification.listerVersions(id));
  }

  /**
   * Aperçu d'impact d'une version : les mois qui seraient recalculés par une
   * correction (US-30-05). Lecture seule.
   */
  @Get(':id/versions/:versionId/impact')
  @FoyerScope('contrat:id')
  apercuImpact(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
  ): Promise<ImpactVersionEnrichi> {
    return relayer(async () => {
      const impact = await this.planification.apercuImpactVersion(
        id,
        versionId,
      );
      const moisCommuniques = await this.moisDejaCommuniques(id, impact);
      return { ...impact, moisCommuniques };
    });
  }

  /**
   * Croise les mois recalculés (`impact.moisCouverts`) avec ceux déjà **communiqués** à
   * un établissement (suivi des envois de svc-notifications). Dégradation gracieuse : si
   * svc-notifications est indisponible, on renvoie `[]` (l'avertissement ne s'affiche pas)
   * plutôt que de faire échouer tout l'aperçu — la correction reste possible.
   */
  private async moisDejaCommuniques(
    contratId: string,
    impact: ImpactVersion,
  ): Promise<string[]> {
    if (impact.moisCouverts.length === 0) {
      return [];
    }
    const bornes = [...impact.moisCouverts].sort();
    const du = bornes[0];
    const au = bornes[bornes.length - 1];
    try {
      const contrat = await this.planification.contrat(contratId);
      const communiques = await this.notifications.moisCommuniques(
        contrat.foyerId,
        du,
        au,
      );
      const couverts = new Set(impact.moisCouverts);
      return communiques.filter((m) => couverts.has(m)).sort();
    } catch {
      return [];
    }
  }

  /**
   * **Corrige** une version existante (geste rétroactif tracé, US-30-05) : écrase
   * ses paramètres versionnés sans déplacer sa date d'effet.
   */
  @Put(':id/versions/:versionId')
  @FoyerScope('contrat:id')
  corrigerVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body() corps: unknown,
  ): Promise<ContratVue> {
    const saisie = valider(corrigerVersionSchema, corps);
    return relayer(() =>
      this.planification.corrigerVersion(
        id,
        versionId,
        saisie as SaisieCorrectionVersion,
      ),
    );
  }

  /** Supprime un contrat de garde. */
  @Delete(':id')
  @FoyerScope('contrat:id')
  @HttpCode(204)
  async supprimer(@Param('id') id: string): Promise<void> {
    await relayer(() => this.planification.supprimerContrat(id));
  }

  /** Lit la saisie de planning d'un mois (réel par défaut, simulé si `?simule=true`). */
  @Get(':id/plannings/:mois')
  @FoyerScope('contrat:id')
  lirePlanning(
    @Param('id') id: string,
    @Param('mois') mois: string,
    @Query('simule') simule: string | undefined,
  ): Promise<LirePlanningReponse> {
    valider(moisSchema, mois);
    return relayer(() =>
      this.planification.lirePlanning(id, mois, simule === 'true'),
    );
  }

  /** Écrit le planning d'un mois (réel par défaut, simulé si `?simule=true`). */
  @Put(':id/plannings/:mois')
  @FoyerScope('contrat:id')
  @HttpCode(204)
  async ecrirePlanning(
    @Param('id') id: string,
    @Param('mois') mois: string,
    @Query('simule') simule: string | undefined,
    @Body() corps: unknown,
  ): Promise<void> {
    valider(moisSchema, mois);
    const planning = valider(ecrirePlanningSchema, corps);
    await relayer(() =>
      this.planification.ecrirePlanning(id, mois, simule === 'true', planning),
    );
  }

  /**
   * Édite les besoins d'une seule semaine (réel par défaut, simulé si
   * `?simule=true`) sans écraser le reste du/des mois. Corps relayé tel quel ;
   * la fusion read-modify-write est faite par `svc-planification`.
   */
  @Put(':id/plannings/semaine/:semaineIso')
  @FoyerScope('contrat:id')
  @HttpCode(204)
  async ecrireSemaine(
    @Param('id') id: string,
    @Param('semaineIso') semaineIso: string,
    @Query('simule') simule: string | undefined,
    @Body() corps: unknown,
  ): Promise<void> {
    valider(semaineIsoSchema, semaineIso);
    const besoins = valider(ecrirePlanningSchema, corps);
    await relayer(() =>
      this.planification.ecrireSemaine(
        id,
        semaineIso,
        simule === 'true',
        besoins,
      ),
    );
  }
}
