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
  type FoyerVersionVue,
  type FoyerVue,
  type ParentVue,
} from '../clients/foyer.client.js';
import { NotificationsClient } from '../clients/notifications.client.js';
import { PlanificationClient } from '../clients/planification.client.js';
import {
  assemblerExport,
  type ExportPortabiliteVue,
} from './export-portabilite.js';
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
import { RessourceCreee } from './ressource-creee.decorator.js';

/**
 * Façade BFF `/api/v1/foyers` : agrège `svc-foyer` — plus, pour la seule route
 * d'export de portabilité, `svc-planification` et `svc-notifications`, les deux
 * autres services **sources** de données du foyer. La création délègue à
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
 * `DELETE /foyers/:id/enfants[...]`) suit la même règle, ainsi que
 * l'**effacement du foyer entier** (`DELETE /foyers/:id`, lot 2). Les
 * **lectures** (liste/lecture de foyer, liste de parents) restent ouvertes ici.
 */
@Controller({ path: 'foyers', version: '1' })
export class FoyersController {
  constructor(
    private readonly foyers: FoyerClient,
    // Les deux clients ci-dessous ne servent qu'à l'export de portabilité : c'est
    // la seule route de ce contrôleur qui sorte de `svc-foyer`.
    private readonly planification: PlanificationClient,
    private readonly notifications: NotificationsClient,
  ) {}

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
  @RessourceCreee((vue: DossierFoyerVue) => vue.foyer.id)
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
        // Spread conditionnel (`exactOptionalPropertyTypes`) : jamais de clé à
        // `undefined` sur le fil. Le relais est explicite champ par champ, c'est
        // précisément ce qui avait fait oublier `dateEffet`/`motif` à la création
        // alors que l'édition les porte.
        ...(saisie.dateEffet !== undefined
          ? { dateEffet: saisie.dateEffet }
          : {}),
        ...(saisie.motif !== undefined ? { motif: saisie.motif } : {}),
        ...(createurEmail !== undefined ? { createurEmail } : {}),
      }),
    );
  }

  /**
   * Liste les foyers. **Scopée à l'identité** (lot 5) :
   * - **identité absente** (mode hérité, sans Cloudflare) → liste **complète**
   *   (compatibilité : le web borne alors via `/moi`) ;
   * - **admin** (∈ `ADMIN_EMAILS`) → liste **complète** (provisioning) ;
   * - **tout autre client identifié** → uniquement **ses** foyers
   *   (`foyersParEmail`), y compris quand `ADMIN_EMAILS` est **vide**.
   *
   * Ce dernier point est le correctif d'**AN-17**. La route reprenait l'idiome
   * « allowlist vide ⇒ gating désactivé, tout le monde passe » de l'`AdminGuard`.
   * Cet idiome est juste pour une **affordance** (faut-il afficher l'écran de
   * création ? cf. `MoiVue.admin`) : au pire on montre un bouton que le serveur
   * refusera. Il ne l'est pas pour une **décision d'autorisation sur des données** :
   * ici, « aucun admin désigné » devenait « tout le monde est admin », et la
   * réponse porte les revenus et le RFR de **tous** les foyers de la base. Un
   * défaut d'activation permissif ne se transporte pas d'un affichage vers une
   * lecture de données.
   *
   * Ni `FOYER_AUTHZ_ENFORCE` ni le scoping aval ne rattrapaient ce trou (LE-26) :
   * la route n'a **pas de `@FoyerScope`** (aucun `foyerId` unique à comparer), donc
   * `AppartenanceGuard` la laisse passer d'emblée, et l'appel aval part sans
   * `?parentEmail=`, donc le `ScopeFoyerGuard` de `svc-foyer` n'a rien à comparer
   * non plus. Le scope est appliqué **ici**, explicitement, et nulle part ailleurs.
   *
   * Le filtrage se fait **côté gateway** (server-to-server) : svc-foyer renvoie
   * tout, on ne relaie au client que l'intersection. `MesFoyersPage` fonctionne
   * sans changement (elle reçoit déjà la liste à afficher).
   */
  @Get()
  lister(@Req() req?: RequeteIdentifiable): Promise<FoyerVue[]> {
    const email = req?.identite?.email;
    const { adminEmails } = loadConfig();
    // Sans identité : mode hérité (aucun critère de filtrage ne serait vérifiable ;
    // la barrière reste Cloudflare Access au bord, cf. `AM-30`).
    if (email === undefined || estAdmin(email, adminEmails)) {
      return relayer(() => this.foyers.lister());
    }
    return relayer(async () => {
      const [ids, tous] = await Promise.all([
        this.foyers.foyersParEmail(email),
        this.foyers.lister(),
      ]);
      return tous.filter((f) => ids.includes(f.id));
    });
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
   * **Efface le foyer entier** (droit à l'effacement, lot 2 ; `AM-34`).
   * `@FoyerScope` : parent du foyer (admin bypass) — même garde que l'édition,
   * parce que c'est la seule qui confronte le foyer visé à l'ensemble autorisé
   * de l'appelant. `@AdminSeulement()` serait un piège : la garde est inactive
   * quand `ADMIN_EMAILS` est vide, ce qui laisserait la route ouverte (`AN-17`).
   *
   * La suppression de la source est synchrone (204) ; l'effacement des **copies**
   * détenues par tarification, notifications et planification voyage en
   * événement d'intégration et arrive donc avec un délai.
   */
  @Delete(':id')
  @FoyerScope('param:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  supprimer(@Param('id') id: string): Promise<void> {
    return relayer(() => this.foyers.supprimerFoyer(id));
  }

  /**
   * **Export de portabilité** du foyer (droit à la portabilité, lot 3 ; `AM-35`).
   * `@FoyerScope` : parent du foyer (admin bypass) — la réponse rassemble en un
   * seul document tout ce que les trois services **sources** détiennent sur le
   * foyer, donc la garde est celle de la lecture du dossier, pas moins.
   *
   * **Aucune dégradation gracieuse ici**, contrairement à `apercuImpact` ou aux
   * préférences de `/moi` : un service muet y fait perdre un enrichissement, ce
   * qui est rattrapable ; ici il ferait livrer un export **amputé sans le dire**,
   * c'est-à-dire un document qui affirme être complet et ne l'est pas. Les trois
   * appels sont donc dans un seul `relayer` : soit les trois répondent, soit
   * l'export échoue.
   *
   * `svc-tarification` n'est **pas** interrogé : ses 5 tables sont des copies
   * projetées des données ci-dessus (`docs/37-registre-des-traitements.md` §5).
   * Les inclure ferait passer pour une donnée de plus ce qui n'est qu'un second
   * exemplaire de la même.
   */
  @Get(':id/export')
  @FoyerScope('param:id')
  exporter(@Param('id') id: string): Promise<ExportPortabiliteVue> {
    const genereLe = new Date().toISOString();
    return relayer(async () => {
      const [foyer, planification, notifications] = await Promise.all([
        this.foyers.exporter(id),
        this.planification.exporter(id),
        this.notifications.exporter(id),
      ]);
      return assemblerExport({
        foyerId: id,
        genereLe,
        foyer,
        planification,
        notifications,
      });
    });
  }

  /**
   * Historique des **versions de ressources** du foyer (date d'effet, RFR, tranche)
   * — SFD 30, CA2 US-30-03. `@FoyerScope` : lisible par le parent du foyer.
   */
  @Get(':id/versions')
  @FoyerScope('param:id')
  listerVersions(@Param('id') id: string): Promise<FoyerVersionVue[]> {
    return relayer(() => this.foyers.versions(id));
  }

  /**
   * Rattache un **enfant** au foyer existant (ajout simple). `@FoyerScope` :
   * pilotable par le **parent** du foyer (admin bypass), un tiers prend 403.
   */
  @Post(':id/enfants')
  @FoyerScope('param:id')
  @HttpCode(HttpStatus.CREATED)
  @RessourceCreee((vue: EnfantVue) => vue.id)
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
   * parent du foyer (admin bypass). Sans effet sur les contrats existants : leur
   * `enfantId` pointe alors vers un enfant disparu, et leur suppression reste un
   * geste explicite de l'utilisateur.
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
  @RessourceCreee((vue: ParentVue) => vue.id)
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
