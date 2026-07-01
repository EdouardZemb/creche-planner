import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, gte, isNull, lte, or } from 'drizzle-orm';
import { DRIZZLE, MailerService } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  contrat,
  TYPE_VALIDATION_HEBDO,
  type ContratRow,
} from '../database/schema.js';
import { ValidationService } from '../validation/validation.service.js';
import {
  EtablissementProjeteService,
  type EtablissementProjeteVue,
} from '../etablissement/etablissement-projete.service.js';
import {
  joursDeLaSemaine,
  semaineIsoDeDate,
} from '@creche-planner/shared-semaine';
import { recapMardi } from '../email/templates/recapMardi.js';
import { DestinatairesService } from '../destinataires/destinataires.service.js';
import { DesabonnementClient } from '../desabonnement/desabonnement.client.js';
import { CLOCK, type Clock } from './clock.js';
import {
  OPTIONS_SCHEDULER,
  type OptionsScheduler,
} from './scheduler.options.js';

const INTERVALLE_MS = 60_000;

/** Indice de jour `weekday: 'short'` (en-US) du mardi. */
const MARDI = 'Tue';

/**
 * Scheduler hebdomadaire du **mardi** (Lot 5). Reprend le pattern maison
 * `setInterval` + garde de réentrance de `OutboxRelay` (pas de nouvelle dépendance
 * @Cron/Bull). À chaque tick (~60 s), il décide en **Europe/Paris** — jamais via
 * l'heure UTC du serveur — si l'on est mardi à/au-delà de l'heure de déclenchement.
 *
 * Le cas échéant, pour chaque contrat **actif** sur la semaine N+1, il fige (via
 * `ValidationService.notifier`) une ligne `notification_hebdo` idempotente — la clé
 * `UNIQUE(contrat_id, semaine_iso, type)` garantit l'exactly-once multi-réplica : la
 * 1ʳᵉ écriture gagne, les ticks/réplicas suivants sont des no-op. L'idempotence reste
 * **par contrat** ; **l'envoi**, lui, est **regroupé par foyer** (PR4 parents-foyer) :
 * un unique mail récap liste tous les enfants/contrats fraîchement notifiés du foyer
 * et part vers les e-mails des **parents actifs** (read model `foyer_parent`), avec
 * repli sur `NOTIF_EMAIL_PARENT` + warning si le foyer n'a aucun parent (dépréciation
 * progressive). Un second tick le même mardi ne crée aucune ligne neuve → n'envoie
 * rien. Les garde-fous du `MailerService` (dry-run par défaut, allowlist) restent en
 * vigueur.
 *
 * L'horloge est injectée (`CLOCK`) : les tests poussent un instant précis sans
 * dépendre de l'horloge réelle ni du fuseau du serveur.
 */
@Injectable()
export class SchedulerHebdo
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(SchedulerHebdo.name);
  private timer?: ReturnType<typeof setInterval>;
  private enCours = false;

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(OPTIONS_SCHEDULER) private readonly options: OptionsScheduler,
    private readonly validation: ValidationService,
    private readonly etablissements: EtablissementProjeteService,
    private readonly destinataires: DestinatairesService,
    private readonly desabonnement: DesabonnementClient,
    private readonly mailer: MailerService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.declencher(), INTERVALLE_MS);
  }

  /**
   * Un tick du scheduler. No-op hors fenêtre de déclenchement (mardi ≥ heure, en
   * Europe/Paris). Réentrant-safe (garde `enCours`) et tolérant : une erreur de base
   * ou de mailer est journalisée et réessayée au tick suivant, jamais propagée.
   */
  async declencher(): Promise<void> {
    if (this.enCours) {
      return;
    }
    this.enCours = true;
    try {
      const maintenant = this.clock.maintenant();
      if (!this.estFenetreDeclenchement(maintenant)) {
        return;
      }
      const semaineIso = this.semaineProchaine(maintenant);
      const contrats = await this.contratsActifs(semaineIso);
      if (contrats.length === 0) {
        return;
      }
      const annuaire = await this.annuaireParId();
      // Idempotence **par contrat** (clé UNIQUE notification_hebdo) : on fige chaque
      // contrat et on retient ceux que CET appel a réellement notifiés (les ticks /
      // réplicas suivants renvoient `false` → rien à renvoyer).
      const frais: ContratRow[] = [];
      for (const c of contrats) {
        const cree = await this.validation.notifier({
          contratId: c.id,
          foyerId: c.foyerId,
          semaineIso,
        });
        if (cree) {
          frais.push(c);
        }
      }
      // Envoi **regroupé par foyer** : un seul mail récap par foyer fraîchement notifié.
      for (const [foyerId, contratsFoyer] of this.grouperParFoyer(frais)) {
        await this.envoyerRecapFoyer(
          foyerId,
          contratsFoyer,
          semaineIso,
          annuaire,
        );
      }
    } catch (erreur) {
      this.logger.warn(
        `Scheduler hebdo interrompu : ${(erreur as Error).message} — réessai au prochain tick`,
      );
    } finally {
      this.enCours = false;
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Vrai si l'instant tombe un mardi à/au-delà de l'heure de déclenchement (Paris). */
  private estFenetreDeclenchement(maintenant: Date): boolean {
    const parties = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris',
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(maintenant);
    const jour = parties.find((p) => p.type === 'weekday')?.value;
    const heure = Number(parties.find((p) => p.type === 'hour')?.value ?? '0');
    return jour === MARDI && heure >= this.options.heureDeclenchement;
  }

  /** Semaine ISO **N+1** : la semaine du jour de Paris décalé de 7 jours. */
  private semaineProchaine(maintenant: Date): string {
    const ajd = this.dateParis(maintenant);
    const d = new Date(`${ajd}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    const annee = String(d.getUTCFullYear()).padStart(4, '0');
    const mois = String(d.getUTCMonth() + 1).padStart(2, '0');
    const jour = String(d.getUTCDate()).padStart(2, '0');
    return semaineIsoDeDate(`${annee}-${mois}-${jour}`);
  }

  /** Date calendaire `YYYY-MM-DD` de l'instant, lue dans le fuseau Europe/Paris. */
  private dateParis(maintenant: Date): string {
    const parties = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(maintenant);
    const valeur = (type: string) =>
      parties.find((p) => p.type === type)?.value ?? '';
    return `${valeur('year')}-${valeur('month')}-${valeur('day')}`;
  }

  /**
   * Contrats actifs sur la semaine : période de validité chevauchant `[lundi,
   * dimanche]` de la semaine ISO (`valide_du` ≤ dimanche ET `valide_au` ≥ lundi, une
   * `valide_au` nulle valant période ouverte). Comparaisons lexicographiques sûres
   * sur des dates ISO `YYYY-MM-DD`.
   */
  private async contratsActifs(semaineIso: string): Promise<ContratRow[]> {
    const jours = joursDeLaSemaine(semaineIso);
    const lundi = jours[0];
    const dimanche = jours[jours.length - 1];
    if (lundi === undefined || dimanche === undefined) {
      return [];
    }
    return this.db
      .select()
      .from(contrat)
      .where(
        and(
          lte(contrat.valideDu, dimanche),
          or(isNull(contrat.valideAu), gte(contrat.valideAu, lundi)),
        ),
      );
  }

  /**
   * Annuaire des établissements projetés indexé par `id` (résolution du préavis du
   * mail via le lien explicite `contrat.etablissement_id`).
   */
  private async annuaireParId(): Promise<Map<string, EtablissementProjeteVue>> {
    const liste = await this.etablissements.lister();
    return new Map(liste.map((e) => [e.id, e]));
  }

  /** Regroupe les contrats fraîchement notifiés par foyer (préserve l'ordre d'arrivée). */
  private grouperParFoyer(contrats: ContratRow[]): Map<string, ContratRow[]> {
    const parFoyer = new Map<string, ContratRow[]>();
    for (const c of contrats) {
      const liste = parFoyer.get(c.foyerId);
      if (liste) {
        liste.push(c);
      } else {
        parFoyer.set(c.foyerId, [c]);
      }
    }
    return parFoyer;
  }

  /**
   * Compose et envoie le récap du mardi d'un foyer, regroupant tous ses contrats
   * fraîchement notifiés. Destinataires = parents **actifs** du foyer **dont le canal
   * e-mail n'est pas coupé** pour `VALIDATION_HEBDO` (préférences projetées, PR4).
   *
   * RFC 8058 (PR5) : **un mail par destinataire** (et non un `to` groupé), afin de
   * poser un en-tête `List-Unsubscribe` **propre au parent** (jeton one-shot frappé
   * auprès de `svc-foyer`). Si la frappe du jeton échoue (dégradation propre), le mail
   * part quand même, sans en-tête ni lien de désabonnement. **Repli** sur
   * `NOTIF_EMAIL_PARENT` (un seul mail, sans désabonnement — ce n'est pas un parent
   * réel) + warning si aucun parent n'a d'e-mail actif. Les garde-fous du
   * `MailerService` (dry-run/allowlist) s'appliquent à chaque `to`.
   */
  private async envoyerRecapFoyer(
    foyerId: string,
    contratsFoyer: ContratRow[],
    semaineIso: string,
    annuaire: Map<string, EtablissementProjeteVue>,
  ): Promise<void> {
    const enfants = contratsFoyer.map((c) => {
      const etab = this.etablissementPourContrat(c.etablissementId, annuaire);
      return {
        enfant: c.enfant,
        etablissementLibelle: etab?.nom ?? null,
        preavisRegle: etab?.preavisRegle ?? null,
      };
    });
    const lienApp = `${this.options.appUrl}/planning?semaine=${semaineIso}`;

    const destinataires = await this.destinataires.destinatairesActifs(
      foyerId,
      TYPE_VALIDATION_HEBDO,
    );

    if (destinataires.length === 0) {
      this.logger.warn(
        `Foyer ${foyerId} sans parent destinataire — repli sur NOTIF_EMAIL_PARENT (${this.options.emailParent}, déprécié)`,
      );
      const message = recapMardi({ enfants, semaineIso, lienApp });
      const resultat = await this.mailer.envoyer({
        to: this.options.emailParent,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      this.logger.log(
        `Récap mardi ${resultat.dryRun ? '(dry-run) ' : ''}foyer ${foyerId} (${String(enfants.length)} enfant(s), repli) — semaine ${semaineIso}`,
      );
      return;
    }

    for (const dest of destinataires) {
      const token = await this.desabonnement.emettreJeton({
        foyerId,
        parentId: dest.parentId,
        typeNotification: TYPE_VALIDATION_HEBDO,
        canal: 'EMAIL',
      });
      const message = recapMardi({
        enfants,
        semaineIso,
        lienApp,
        ...(token
          ? {
              lienDesabonnement: `${this.options.appUrl}/desabonnement?token=${encodeURIComponent(token)}`,
            }
          : {}),
      });
      const resultat = await this.mailer.envoyer({
        to: dest.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(token ? { headers: this.entetesDesabonnement(token) } : {}),
      });
      this.logger.log(
        `Récap mardi ${resultat.dryRun ? '(dry-run) ' : ''}foyer ${foyerId} → ${dest.email} (${String(enfants.length)} enfant(s)${token ? '' : ', sans désabonnement'}) — semaine ${semaineIso}`,
      );
    }
  }

  /**
   * En-têtes de désabonnement **RFC 8058** pour un jeton donné : le lien HTTPS
   * one-click (POST direct du client de messagerie vers la gateway) et, si
   * configuré, un `mailto:` de repli, plus l'en-tête `List-Unsubscribe-Post`.
   */
  private entetesDesabonnement(token: string): Record<string, string> {
    const oneClick = `${this.options.publicApiUrl}/api/v1/desabonnement?token=${encodeURIComponent(token)}`;
    const parties = [`<${oneClick}>`];
    if (this.options.unsubscribeMailto) {
      parties.push(
        `<mailto:${this.options.unsubscribeMailto}?subject=desabonnement>`,
      );
    }
    return {
      'List-Unsubscribe': parties.join(', '),
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  /**
   * Résout l'établissement destinataire à partir du **lien explicite**
   * `contrat.etablissement_id` (sinon `undefined` : contrat non rattaché ou fiche non
   * encore projetée — le mail retombe alors sur libellé/préavis nuls).
   */
  private etablissementPourContrat(
    etablissementId: string | null,
    annuaire: Map<string, EtablissementProjeteVue>,
  ): EtablissementProjeteVue | undefined {
    if (etablissementId === null) {
      return undefined;
    }
    return annuaire.get(etablissementId);
  }
}
