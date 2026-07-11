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
  Req,
} from '@nestjs/common';
import {
  FoyerClient,
  type DossierFoyerVue,
  type EnfantVue,
  type FoyerVue,
  type ParentVue,
} from '../clients/foyer.client.js';
import {
  ajouterEnfantSchema,
  ajouterParentSchema,
  creerDossierFoyerSchema,
  ecrireFoyerScalairesSchema,
  modifierEnfantSchema,
  modifierParentSchema,
  valider,
} from './bff.dto.js';
import { loadConfig } from '../config.js';
import { estAdmin } from '../security/admin.js';
import { CreationFoyerUnique } from '../security/creation-foyer-unique.decorator.js';
import { FoyerScope } from '../security/foyer-scope.decorator.js';
import type { RequeteIdentifiable } from '../security/identite.js';
import { relayer } from './relais.js';

/**
 * Façade BFF `/api/v1/foyers` : agrège `svc-foyer`. La création délègue à
 * `svc-foyer` **une seule commande transactionnelle** (foyer + enfants + parents)
 * et relaie le dossier ; la lecture renvoie le foyer **et** ses enfants/parents en
 * une réponse. Les parents exposent une vraie CRUD (sous-ressource éditable, cf.
 * notifications hebdo).
 *
 * **Autorisation.** La **création** de foyer (`POST`) est `@CreationFoyerUnique()`
 * (P5, besoin B) : **self-service de la 1ʳᵉ création** — un parent non-admin crée
 * son foyer une fois, une 2ᵉ création prend **409** ; l'admin crée sans limite
 * (provisioning), une identité absente reste en mode hérité. Le créateur non-admin
 * est **rattaché comme parent** (sinon il ne pourrait pas éditer via `@FoyerScope`).
 * L'**édition** d'un foyer existant — ses scalaires (`PUT /foyers/:id`) comme ses
 * parents (ajout / édition / retrait) — est `@FoyerScope('param:id')` : le **parent
 * du foyer** la pilote (l'admin garde un bypass réparateur), un tiers prend 403. La
 * gestion des **enfants** du foyer (ajout `POST`, édition `PUT`, suppression
 * `DELETE /foyers/:id/enfants[...]`) suit la même règle. Les **lectures**
 * (liste/lecture de foyer, liste de parents) restent ouvertes ici.
 */
@Controller({ path: 'foyers', version: '1' })
export class FoyersController {
  constructor(private readonly foyers: FoyerClient) {}

  /**
   * Crée un foyer et son dossier (enfants + parents) via **un seul appel**
   * transactionnel à `svc-foyer` : la création réussit entièrement ou échoue
   * entièrement (plus de dossier à moitié créé). **Pas de `@FoyerScope`** :
   * amorçage (le foyer n'existe pas encore) ; l'accès est borné par
   * `@CreationFoyerUnique()` (self-service 1ʳᵉ création, garde create-once, P5). Le
   * **créateur** non-admin (`createurEmail`) est rattaché comme parent **par
   * `svc-foyer`**, pour pouvoir éditer ensuite (cf. `AppartenanceGuard`).
   */
  @Post()
  @CreationFoyerUnique()
  creer(
    @Body() corps: unknown,
    @Req() req?: RequeteIdentifiable,
  ): Promise<DossierFoyerVue> {
    const saisie = valider(creerDossierFoyerSchema, corps);
    const createurEmail = emailCreateur(req);
    return relayer(() =>
      this.foyers.creerFoyer({
        ressourcesMensuelles: saisie.ressourcesMensuelles,
        rfr: saisie.rfr,
        nbEnfantsACharge: saisie.nbEnfantsACharge,
        nbParts: saisie.nbParts,
        enfants: saisie.enfants,
        parents: saisie.parents,
        ...(createurEmail !== undefined ? { createurEmail } : {}),
      }),
    );
  }

  /**
   * Liste les foyers existants (découverte « mode hérité », email inconnu).
   * **Pas de `@FoyerScope`** : ne porte pas de `foyerId` unique (renvoie tout).
   * Gap résiduel connu — une fois l'identité câblée, le web borne via `/moi` ;
   * restreindre cette liste relève d'un suivi (cf. doc 24 §24, PR7).
   */
  @Get()
  lister(): Promise<FoyerVue[]> {
    return relayer(() => this.foyers.lister());
  }

  /** Lit un foyer, ses enfants et ses parents. */
  @Get(':id')
  @FoyerScope('param:id')
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

  /**
   * Édite les scalaires d'un foyer (finances/RFR/parts/nb enfants à charge).
   * `@FoyerScope` : pilotable par le **parent** du foyer (admin bypass).
   */
  @Put(':id')
  @FoyerScope('param:id')
  mettreAJour(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<FoyerVue> {
    const saisie = valider(ecrireFoyerScalairesSchema, corps);
    return relayer(() => this.foyers.mettreAJour(id, saisie));
  }

  /**
   * Rattache un **enfant** au foyer existant (ajout simple). `@FoyerScope` :
   * pilotable par le **parent** du foyer (admin bypass), un tiers prend 403.
   */
  @Post(':id/enfants')
  @FoyerScope('param:id')
  @HttpCode(HttpStatus.CREATED)
  ajouterEnfant(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<EnfantVue> {
    const saisie = valider(ajouterEnfantSchema, corps);
    return relayer(() => this.foyers.ajouterEnfant(id, saisie));
  }

  /**
   * Édite un **enfant** du foyer (prénom/date). `@FoyerScope` : parent du foyer
   * (admin bypass). Renommer un enfant n'affecte **pas** les contrats existants
   * (couplage par prénom libre, inter-services — cf. plan §2.5).
   */
  @Put(':id/enfants/:enfantId')
  @FoyerScope('param:id')
  modifierEnfant(
    @Param('id') id: string,
    @Param('enfantId') enfantId: string,
    @Body() corps: unknown,
  ): Promise<EnfantVue> {
    const saisie = valider(modifierEnfantSchema, corps);
    return relayer(() => this.foyers.modifierEnfant(id, enfantId, saisie));
  }

  /**
   * Retire un **enfant** du foyer (hard delete côté `svc-foyer`). `@FoyerScope` :
   * parent du foyer (admin bypass). Sans effet sur les contrats existants (couplage
   * par prénom).
   */
  @Delete(':id/enfants/:enfantId')
  @FoyerScope('param:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  retirerEnfant(
    @Param('id') id: string,
    @Param('enfantId') enfantId: string,
  ): Promise<void> {
    return relayer(() => this.foyers.retirerEnfant(id, enfantId));
  }

  /** Liste les parents actifs d'un foyer. */
  @Get(':id/parents')
  @FoyerScope('param:id')
  listerParents(@Param('id') id: string): Promise<ParentVue[]> {
    return relayer(() => this.foyers.parents(id));
  }

  /** Rattache un parent au foyer (parent du foyer ; admin bypass). */
  @Post(':id/parents')
  @FoyerScope('param:id')
  @HttpCode(HttpStatus.CREATED)
  ajouterParent(
    @Param('id') id: string,
    @Body() corps: unknown,
  ): Promise<ParentVue> {
    const saisie = valider(ajouterParentSchema, corps);
    return relayer(() => this.foyers.ajouterParent(id, saisie));
  }

  /** Édite un parent (champs fournis uniquement ; parent du foyer, admin bypass). */
  @Put(':id/parents/:parentId')
  @FoyerScope('param:id')
  modifierParent(
    @Param('id') id: string,
    @Param('parentId') parentId: string,
    @Body() corps: unknown,
  ): Promise<ParentVue> {
    const saisie = valider(modifierParentSchema, corps);
    return relayer(() => this.foyers.modifierParent(id, parentId, saisie));
  }

  /** Retire un parent (soft-delete côté `svc-foyer` ; parent du foyer, admin bypass). */
  @Delete(':id/parents/:parentId')
  @FoyerScope('param:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  retirerParent(
    @Param('id') id: string,
    @Param('parentId') parentId: string,
  ): Promise<void> {
    return relayer(() => this.foyers.retirerParent(id, parentId));
  }
}

/**
 * E-mail du **créateur** à transmettre à `svc-foyer` pour rattachement parent
 * (P5), ou `undefined`. On ne le fournit que pour une **identité non-admin** :
 * l'admin **provisionne pour autrui** (le rattacher le ferait destinataire des
 * récaps et polluerait la liste) ; une identité absente reste en mode hérité
 * (aucun rattachement). Le dédoublonnage/rattachement effectif (idempotent,
 * insensible à la casse) est fait par `FoyerService.creer`.
 */
function emailCreateur(req?: RequeteIdentifiable): string | undefined {
  const email = req?.identite?.email;
  if (email === undefined) {
    return undefined; // mode hérité : aucune identité → on ne rattache rien
  }
  const { adminEmails } = loadConfig();
  return estAdmin(email, adminEmails) ? undefined : email;
}
