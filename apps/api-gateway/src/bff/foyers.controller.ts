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
  type EnfantVue,
  type FoyerVue,
  type ParentVue,
  type SaisieParent,
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
   * Crée un foyer puis rattache ses enfants et parents (orchestration).
   * **Pas de `@FoyerScope`** : amorçage (le foyer n'existe pas encore) ; l'accès
   * est borné par `@CreationFoyerUnique()` (self-service 1ʳᵉ création, garde
   * create-once, P5). Le **créateur** non-admin est ajouté à ses parents s'il n'y
   * figure pas, pour pouvoir éditer ensuite (cf. `AppartenanceGuard`).
   */
  @Post()
  @CreationFoyerUnique()
  creer(
    @Body() corps: unknown,
    @Req() req?: RequeteIdentifiable,
  ): Promise<DossierFoyerVue> {
    const saisie = valider(creerDossierFoyerSchema, corps);
    const parentsSaisis = parentsAvecCreateur(saisie.parents, req);
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
      for (const parent of parentsSaisis) {
        parents.push(await this.foyers.ajouterParent(foyer.id, parent));
      }
      return { foyer, enfants, parents };
    });
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
 * Garantit que l'**e-mail du créateur** figure parmi les parents (P5) : sans cela
 * un parent qui s'auto-crée un foyer ne pourrait pas l'éditer ensuite
 * (`AppartenanceGuard` autorise via `foyersParEmail`). On n'auto-ajoute que pour
 * une **identité non-admin** : l'admin **provisionne pour autrui** (le rattacher à
 * chaque foyer créé le ferait destinataire des récaps et polluerait la liste) ;
 * une identité absente reste en mode hérité (aucun ajout). Idempotent : on ne
 * duplique pas un e-mail déjà saisi (comparaison insensible à la casse).
 */
function parentsAvecCreateur(
  parents: readonly SaisieParent[],
  req?: RequeteIdentifiable,
): SaisieParent[] {
  const email = req?.identite?.email;
  if (email === undefined) {
    return [...parents]; // mode hérité : aucune identité → on ne rattache rien
  }
  const { adminEmails } = loadConfig();
  if (estAdmin(email, adminEmails)) {
    return [...parents]; // provisioning admin : ne pas s'auto-rattacher
  }
  const cible = email.trim().toLowerCase();
  const dejaPresent = parents.some(
    (p) => p.email.trim().toLowerCase() === cible,
  );
  return dejaPresent ? [...parents] : [...parents, { email }];
}
