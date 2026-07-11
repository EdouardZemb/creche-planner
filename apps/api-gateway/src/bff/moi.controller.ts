import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  FoyerClient,
  type ParentVue,
  type PreferenceVue,
} from '../clients/foyer.client.js';
import {
  NotificationsClient,
  type InboxVue,
  type NotificationInAppVue,
} from '../clients/notifications.client.js';
import { loadConfig } from '../config.js';
import { estAdmin, estGatingAdminActif } from '../security/admin.js';
import type { RequeteIdentifiable } from '../security/identite.js';
import { majPreferencesSchema, valider } from './bff.dto.js';
import { relayer } from './relais.js';

/**
 * Identité courante du client (Cloudflare Access B1) et ses droits, résolus
 * **côté serveur** : e-mail vérifié, statut admin, ensemble des foyers autorisés.
 * Le web s'en sert pour gater l'écran de création (admin) et **borner** la
 * sélection de foyer à l'ensemble autorisé (0/1/N).
 */
interface MoiVue {
  /** E-mail vérifié de l'identité, ou `null` si aucune identité n'est établie. */
  readonly email: string | null;
  /**
   * `true` si l'e-mail est administrateur. **Permissif** quand le gating admin
   * est inactif (`ADMIN_EMAILS` vide) : tout le monde est « admin » — la prod
   * actuelle conserve ainsi l'accès à la création de foyer.
   */
  readonly admin: boolean;
  /** Ids des foyers dont l'e-mail est parent **actif** (vide sans identité). */
  readonly foyers: readonly string[];
}

/**
 * Vue « Mon profil » du parent connecté (A1) : sa ligne parent ciblée sur *lui*
 * (résolue depuis l'identité, jamais un `parentId` fourni par le client) et ses
 * préférences de notification effectives. `foyerId`/`parentId` servent au web pour
 * réutiliser les routes d'édition existantes sous `@FoyerScope`.
 */
interface MonProfilVue {
  readonly parentId: string;
  readonly foyerId: string;
  readonly email: string;
  readonly prenom: string | null;
  readonly nom: string | null;
  readonly principal: boolean;
  readonly preferences: readonly PreferenceVue[];
}

/**
 * Façade BFF `/api/v1/moi` : « qui suis-je ? ». Lecture seule, **non gardée**
 * par l'admin (toute identité — ou aucune — peut l'interroger). Tolérante aux
 * pannes : si la résolution `email → {foyers}` échoue (svc-foyer indisponible),
 * on renvoie une liste vide plutôt que d'échouer (esprit observe-only).
 */
@Controller({ path: 'moi', version: '1' })
export class MoiController {
  private readonly logger = new Logger(MoiController.name);

  constructor(
    private readonly foyers: FoyerClient,
    private readonly notifications: NotificationsClient,
  ) {}

  @Get()
  async lire(@Req() req: RequeteIdentifiable): Promise<MoiVue> {
    const { adminEmails } = loadConfig();
    const email = req.identite?.email ?? null;
    // Permissif si le gating est inactif (allowlist vide) : prod actuelle ouverte.
    const admin = estGatingAdminActif(adminEmails)
      ? estAdmin(email ?? undefined, adminEmails)
      : true;

    let foyers: readonly string[] = [];
    if (email !== null) {
      try {
        foyers = await this.foyers.foyersParEmail(email);
      } catch (erreur) {
        this.logger.warn(
          `résolution foyers impossible pour ${email} : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }
    }

    return { email, admin, foyers };
  }

  /**
   * `GET /api/v1/moi/profil` — « Mon profil » : la ligne parent du client connecté
   * + ses préférences de notification. **401** si aucune identité, **404** si
   * l'identité ne correspond à aucun parent (aucun foyer, ou foyer sans sa ligne).
   */
  @Get('profil')
  async profil(@Req() req: RequeteIdentifiable): Promise<MonProfilVue> {
    const email = req.identite?.email;
    if (email === undefined) {
      throw new UnauthorizedException('identité requise');
    }
    const { foyerId, parent } = await this.resoudreParentCourant(email);
    const preferences = await relayer(() =>
      this.foyers.preferences(foyerId, parent.id),
    );
    return {
      parentId: parent.id,
      foyerId,
      email: parent.email,
      prenom: parent.prenom,
      nom: parent.nom,
      principal: parent.principal,
      preferences,
    };
  }

  /**
   * `PUT /api/v1/moi/preferences` — met à jour les préférences du parent connecté.
   * **Défense en profondeur** : le `parentId` ciblé est **résolu depuis l'identité**
   * (la ligne dont l'e-mail = `moi.email`), jamais fourni par le client — un parent
   * ne peut donc modifier que **sa** ligne. `svc-foyer` refuse (400 relayé) une
   * combinaison coupant tous les canaux d'un type de service.
   */
  @Put('preferences')
  async majPreferences(
    @Req() req: RequeteIdentifiable,
    @Body() corps: unknown,
  ): Promise<PreferenceVue[]> {
    const email = req.identite?.email;
    if (email === undefined) {
      throw new UnauthorizedException('identité requise');
    }
    const saisie = valider(majPreferencesSchema, corps);
    const { foyerId, parent } = await this.resoudreParentCourant(email);
    return relayer(() =>
      this.foyers.majPreferences(foyerId, parent.id, saisie),
    );
  }

  /**
   * `GET /api/v1/moi/notifications` — inbox in-app du parent connecté (PR6, §5.6) :
   * ses notifications récentes + le compteur de non-lus (cloche). Le `parentId` est
   * **résolu côté serveur** depuis l'identité (jamais fourni par le client), puis passé
   * à `svc-notifications`. **401** sans identité, **404** si l'identité n'a pas de ligne
   * parent. C'est un **journal informationnel** : il ne porte pas l'action « Valider »
   * (celle-ci reste sur `/notifications/a-valider`).
   */
  @Get('notifications')
  async notificationsInbox(@Req() req: RequeteIdentifiable): Promise<InboxVue> {
    const email = req.identite?.email;
    if (email === undefined) {
      throw new UnauthorizedException('identité requise');
    }
    const { parent } = await this.resoudreParentCourant(email);
    return relayer(() => this.notifications.listerInbox(parent.id));
  }

  /**
   * `POST /api/v1/moi/notifications/:id/lu` — marque une notification du parent connecté
   * comme lue (accusé de lecture). **Défense en profondeur** : le `parentId` est résolu
   * depuis l'identité et scope l'écriture côté service — un parent ne marque que **sa**
   * notification (**404** relayé si l'id est inconnu ou appartient à un autre parent).
   */
  @Post('notifications/:id/lu')
  async marquerNotificationLue(
    @Req() req: RequeteIdentifiable,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationInAppVue> {
    const email = req.identite?.email;
    if (email === undefined) {
      throw new UnauthorizedException('identité requise');
    }
    const { parent } = await this.resoudreParentCourant(email);
    return relayer(() =>
      this.notifications.marquerNotificationLue(parent.id, id),
    );
  }

  /**
   * Résout **la** ligne parent du client à partir de son e-mail vérifié : on
   * parcourt ses foyers (dans l'ordre renvoyé par `foyersParEmail`) et on retient
   * la **première** ligne dont l'e-mail correspond (insensible à la casse). Le
   * filtre par e-mail reste explicite (défense en profondeur : on n'édite jamais la
   * ligne d'un autre parent du foyer). Depuis le lot 5, l'e-mail n'est plus
   * globalement unique (unicité **par foyer** ; un parent peut appartenir à
   * plusieurs foyers — familles recomposées) : profil / préférences / inbox sont
   * alors résolus sur son **premier** foyer. C'est une **limitation assumée** (pas
   * de sélecteur de profil multi-foyers, cf. plan §3). `404` si aucune ligne ne
   * correspond (identité sans foyer / sans parent).
   */
  private async resoudreParentCourant(
    email: string,
  ): Promise<{ foyerId: string; parent: ParentVue }> {
    const foyers = await relayer(() => this.foyers.foyersParEmail(email));
    const cible = email.trim().toLowerCase();
    for (const foyerId of foyers) {
      const parents = await relayer(() => this.foyers.parents(foyerId));
      const parent = parents.find(
        (p) => p.email.trim().toLowerCase() === cible,
      );
      if (parent !== undefined) {
        return { foyerId, parent };
      }
    }
    throw new NotFoundException('aucun profil parent pour cette identité');
  }
}
