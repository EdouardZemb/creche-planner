import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TypeNotification } from '@creche-planner/contracts-foyer';
import { DRIZZLE } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import { foyerParent, preferenceNotification } from '../database/schema.js';

/** Canal e-mail (seul canal filtré par la résolution des destinataires du récap). */
const CANAL_EMAIL = 'EMAIL';

/** Canal in-app (inbox générique, PR6) : résolution des destinataires de l'inbox. */
const CANAL_IN_APP = 'IN_APP';

/** Destinataire e-mail résolu : e-mail **et** `parentId` (jeton de désabonnement PR5). */
export interface DestinataireActif {
  readonly parentId: string;
  readonly email: string;
}

/**
 * Résolution des **destinataires e-mail** du récap hebdomadaire à partir du read model
 * `foyer_parent` (projeté depuis le stream `FOYER`, cf. `ProjectionService`), **filtrée
 * par les préférences de notification** (read model `preference_notification`, PR4).
 * Rend les e-mails des parents **actifs** d'un foyer **dont le canal e-mail n'a pas été
 * coupé** pour le type demandé, le `principal` placé en tête puis tri alphabétique
 * stable — l'appelant (`SchedulerHebdo`) compose un unique `to` regroupant les contrats
 * fraîchement notifiés, et se replie sur `NOTIF_EMAIL_PARENT` (dépréciation progressive)
 * quand la liste est vide.
 */
@Injectable()
export class DestinatairesService {
  private readonly logger = new Logger(DestinatairesService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Signale les parents écartés faute de **toute** ligne de préférence projetée — à
   * distinguer d'un désabonnement, qui est un choix et ne se loggue pas.
   *
   * Le filtre fermé d'`AM-57` suppose que le consentement soit **arrivé** : il l'est
   * par le back-fill `0020` pour les parents existants, et par l'événement
   * d'inscription pour les suivants. Reste une fenêtre où ni l'un ni l'autre n'a joué
   * — un parent créé par un `svc-foyer` pas encore déployé pendant qu'un
   * `svc-notifications` déjà migré résout les destinataires. Ce parent cesserait de
   * recevoir **sans que rien ne le dise** : c'est ce silence-là que cette ligne
   * supprime. Rejouer `0020` (idempotent, `ON CONFLICT DO NOTHING`) le répare.
   */
  private signalerSansConsentement(
    canal: string,
    typeNotification: string,
    lignes: readonly { parentId: string; preferenceActive: boolean | null }[],
  ): void {
    const inconnus = lignes
      .filter((l) => l.preferenceActive === null)
      .map((l) => l.parentId);
    if (inconnus.length > 0) {
      this.logger.warn(
        `Aucun consentement projeté pour ${String(inconnus.length)} parent(s) sur ` +
          `(${typeNotification}, ${canal}) — écarté(s) des destinataires : ` +
          `${inconnus.join(', ')}. Rejouer la migration 0020 si l'état persiste.`,
      );
    }
  }

  /**
   * E-mails des parents actifs du foyer **dont la préférence `(type, 'EMAIL')` est
   * explicitement active**, ordonnés `principal` d'abord puis par e-mail.
   *
   * ⚠️ Le filtre est **fermé par défaut** depuis `AM-57` : seule une ligne
   * `(parent, type, 'EMAIL')` portant `actif = true` fait d'un parent un destinataire.
   * Il gardait auparavant tout parent dont la préférence n'était pas explicitement
   * `false` — jointure gauche `NULL` compris — si bien que **supprimer** la ligne d'un
   * parent désabonné le réabonnait. Le consentement est désormais **écrit** en amont
   * (matérialisé à l'inscription, transporté par `PreferencesNotifModifiees`, back-fill
   * `0020`) : une ligne absente ne signifie plus « défaut applicatif » mais « aucun
   * consentement projeté », et un courriel ne part pas sur cette base.
   *
   * Liste vide si le foyer n'a aucun parent joignable (l'appelant déclenche alors le
   * repli vers l'adresse globale).
   */
  async destinatairesActifs(
    foyerId: string,
    typeNotification: TypeNotification,
  ): Promise<DestinataireActif[]> {
    const lignes = await this.db
      .select({
        parentId: foyerParent.parentId,
        email: foyerParent.email,
        principal: foyerParent.principal,
        preferenceActive: preferenceNotification.actif,
      })
      .from(foyerParent)
      .leftJoin(
        preferenceNotification,
        and(
          eq(preferenceNotification.parentId, foyerParent.parentId),
          eq(preferenceNotification.typeNotification, typeNotification),
          eq(preferenceNotification.canal, CANAL_EMAIL),
        ),
      )
      .where(
        and(eq(foyerParent.foyerId, foyerId), eq(foyerParent.actif, true)),
      );
    this.signalerSansConsentement(CANAL_EMAIL, typeNotification, lignes);
    return lignes
      .filter((l) => l.preferenceActive === true) // NULL (aucun consentement) ⇒ écarté
      .slice()
      .sort(
        (a, b) =>
          Number(b.principal) - Number(a.principal) ||
          a.email.localeCompare(b.email),
      )
      .map((l) => ({ parentId: l.parentId, email: l.email }));
  }

  /**
   * Variante ne renvoyant que les **e-mails** (compat PR4). Le récap one-click (PR5)
   * utilise `destinatairesActifs` pour disposer aussi du `parentId` (jeton de
   * désabonnement lié au parent).
   */
  async emailsActifs(
    foyerId: string,
    typeNotification: TypeNotification,
  ): Promise<string[]> {
    return (await this.destinatairesActifs(foyerId, typeNotification)).map(
      (d) => d.email,
    );
  }

  /**
   * **Parents (ids) destinataires de l'inbox in-app** (PR6) : parents actifs du foyer
   * **dont la préférence `(type, 'IN_APP')` est explicitement active**. Même règle
   * fermée que le canal e-mail (`AM-57`) — **ligne absente ⇒ aucun consentement
   * projeté ⇒ écarté**. Indépendant du canal
   * e-mail : un parent qui a coupé l'e-mail mais gardé l'in-app reçoit l'entrée
   * d'inbox (et inversement). Renvoie les `parentId` (l'inbox est keyée par parent) ;
   * l'ordre n'importe pas (une entrée par parent).
   */
  async destinatairesInApp(
    foyerId: string,
    typeNotification: TypeNotification,
  ): Promise<string[]> {
    const lignes = await this.db
      .select({
        parentId: foyerParent.parentId,
        preferenceActive: preferenceNotification.actif,
      })
      .from(foyerParent)
      .leftJoin(
        preferenceNotification,
        and(
          eq(preferenceNotification.parentId, foyerParent.parentId),
          eq(preferenceNotification.typeNotification, typeNotification),
          eq(preferenceNotification.canal, CANAL_IN_APP),
        ),
      )
      .where(
        and(eq(foyerParent.foyerId, foyerId), eq(foyerParent.actif, true)),
      );
    this.signalerSansConsentement(CANAL_IN_APP, typeNotification, lignes);
    return lignes
      .filter((l) => l.preferenceActive === true) // NULL (aucun consentement) ⇒ écarté
      .map((l) => l.parentId);
  }
}
