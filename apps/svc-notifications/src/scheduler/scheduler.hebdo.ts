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
import {
  recapMardi,
  type RecapMardiEnfant,
} from '../email/templates/recapMardi.js';
import {
  DestinatairesService,
  type DestinataireActif,
} from '../destinataires/destinataires.service.js';
import { DesabonnementClient } from '../desabonnement/desabonnement.client.js';
import { InboxService } from '../inbox/inbox.service.js';
import { messageValidationHebdo } from '../inbox/inbox.message.js';
import type { EnvoiRecapHebdoRow } from '../database/schema.js';
import { CLOCK, type Clock } from './clock.js';
import {
  EnvoiRecapService,
  type IssueEnvoiRecap,
} from './envoi-recap.service.js';
import {
  OPTIONS_SCHEDULER,
  type OptionsScheduler,
} from './scheduler.options.js';

const INTERVALLE_MS = 60_000;

/** Indices de jour `weekday: 'short'` (en-US) du lundi et du mardi. */
const LUNDI = 'Mon';
const MARDI = 'Tue';

/**
 * Scheduler hebdomadaire du **mardi** (Lot 5, fiabilisé Lot 3). Reprend le pattern
 * maison `setInterval` + garde de réentrance de `OutboxRelay` (pas de nouvelle
 * dépendance @Cron/Bull). À chaque tick (~60 s), il décide en **Europe/Paris** —
 * jamais via l'heure UTC du serveur — dans quelle **phase** agir.
 *
 * **Création** (le mardi ≥ heure de déclenchement uniquement) : pour chaque contrat
 * **actif** sur la semaine N+1, il fige (via `ValidationService.notifier`) une ligne
 * `notification_hebdo` idempotente — la clé `UNIQUE(contrat_id, semaine_iso, type)`
 * garantit l'exactly-once multi-réplica — puis **réserve** un slot d'envoi `A_ENVOYER`
 * par foyer (`envoi_recap_hebdo`, idempotent). La création est ainsi **découplée** de
 * l'envoi.
 *
 * **Envoi** (à **chaque** tick de la fenêtre — du mardi 8 h au dimanche précédant la
 * semaine cible) : il relit les slots `A_ENVOYER`/`ECHEC` de la semaine, **reconstruit**
 * le récap depuis les données **courantes** (un seul mail par foyer regroupant tous ses
 * enfants notifiés, vers les **parents actifs** — read model `foyer_parent` — avec repli
 * sur `NOTIF_EMAIL_PARENT`), tente l'e-mail et **transitionne** le slot :
 * `ENVOYE`/`DRY_RUN` (abouti, plus jamais retenté) ou `ECHEC` (retenté au tick suivant).
 * Un échec SMTP ne perd donc plus le rappel : il laisse une trace `ECHEC` diagnosticable
 * et retentée. Un slot déjà abouti n'est jamais renvoyé (compare-and-set). Les garde-fous
 * du `MailerService` (dry-run par défaut, allowlist) restent en vigueur ; un échec d'un
 * foyer n'interrompt pas les autres.
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
    private readonly inbox: InboxService,
    private readonly mailer: MailerService,
    private readonly envoiRecap: EnvoiRecapService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.declencher(), INTERVALLE_MS);
    if (this.options.forcerFenetre) {
      // Affordance de TEST (e2e stack) : fenêtre mardi ignorée, tick immédiat
      // pour que la notification à valider existe dès le boot de la pile.
      this.logger.warn(
        'NOTIF_SCHEDULER_FORCER actif — fenêtre du mardi ignorée (réservé aux environnements de test)',
      );
      void this.declencher();
    }
  }

  /**
   * Un tick du scheduler. No-op hors de la **fenêtre d'envoi** (mardi ≥ heure jusqu'au
   * dimanche précédant la semaine cible, Europe/Paris). Réentrant-safe (garde
   * `enCours`) et tolérant : une erreur de base ou de mailer est journalisée et
   * réessayée au tick suivant, jamais propagée. Enchaîne, dans le même tick, la phase
   * **création** (le seul mardi ≥ heure) puis la phase **envoi** (chaque tick).
   */
  async declencher(): Promise<void> {
    if (this.enCours) {
      return;
    }
    this.enCours = true;
    try {
      const maintenant = this.clock.maintenant();
      if (!this.estFenetreEnvoi(maintenant)) {
        return;
      }
      const semaineIso = this.semaineProchaine(maintenant);
      if (this.estJourCreation(maintenant)) {
        await this.creerNotifications(semaineIso);
      }
      await this.traiterEnvois(semaineIso);
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

  /**
   * **Phase création** (le mardi ≥ heure) : fige les `notification_hebdo` de la semaine
   * N+1 (idempotent par contrat) et **réserve** un slot d'envoi `A_ENVOYER` par foyer
   * concerné (idempotent par clé primaire). La réservation est **découplée** de l'envoi :
   * même si l'envoi échoue plus tard, le slot subsiste et sera retenté.
   */
  private async creerNotifications(semaineIso: string): Promise<void> {
    const contrats = await this.contratsActifs(semaineIso);
    if (contrats.length === 0) {
      return;
    }
    // Idempotence **par contrat** (clé UNIQUE notification_hebdo) : la 1ʳᵉ écriture
    // gagne, les ticks/réplicas suivants sont des no-op.
    for (const c of contrats) {
      await this.validation.notifier({
        contratId: c.id,
        foyerId: c.foyerId,
        semaineIso,
      });
    }
    // Réserve un slot d'envoi par foyer concerné (onConflictDoNothing) : rejouable à
    // vide, ne réinitialise jamais un slot déjà réservé (fût-il en ECHEC).
    for (const foyerId of this.foyersDistincts(contrats)) {
      await this.envoiRecap.reserver(foyerId, semaineIso);
    }
  }

  /**
   * **Phase envoi** (chaque tick de la fenêtre) : (re)tente les slots `A_ENVOYER`/`ECHEC`
   * de la semaine, **reconstruits depuis les données courantes**. Un échec d'un foyer
   * (mailer qui lève) est isolé (try/catch → `ECHEC`, log WARN) et n'interrompt pas les
   * autres foyers du tick.
   */
  private async traiterEnvois(semaineIso: string): Promise<void> {
    const enAttente = await this.envoiRecap.aRetenter(semaineIso);
    if (enAttente.length === 0) {
      return;
    }
    const annuaire = await this.annuaireParId();
    const parFoyer = this.grouperParFoyer(
      await this.contratsActifs(semaineIso),
    );
    for (const ligne of enAttente) {
      const contratsFoyer = parFoyer.get(ligne.foyerId) ?? [];
      try {
        await this.envoyerRecapFoyer(ligne, contratsFoyer, annuaire);
      } catch (erreur) {
        const message = (erreur as Error).message;
        this.logger.warn(
          `Récap mardi foyer ${ligne.foyerId} semaine ${semaineIso} en échec : ${message} — réessai au prochain tick`,
        );
        await this.envoiRecap.marquerEchec(ligne.foyerId, semaineIso, message);
      }
    }
  }

  /** Foyers distincts des contrats, dans leur ordre d'apparition. */
  private foyersDistincts(contrats: ContratRow[]): string[] {
    return [...new Set(contrats.map((c) => c.foyerId))];
  }

  /**
   * Vrai dans la **fenêtre d'envoi** : du mardi ≥ heure de déclenchement au dimanche
   * précédant la semaine cible (Europe/Paris). Le lundi (avant le mardi déclencheur, ou
   * premier jour de la semaine cible une fois celle-ci atteinte) est **hors** fenêtre.
   */
  private estFenetreEnvoi(maintenant: Date): boolean {
    if (this.options.forcerFenetre) {
      return true;
    }
    const { jour, heure } = this.jourEtHeureParis(maintenant);
    if (jour === MARDI) {
      return heure >= this.options.heureDeclenchement;
    }
    return jour !== LUNDI;
  }

  /** Vrai le seul jour de **création** : mardi ≥ heure de déclenchement (Paris). */
  private estJourCreation(maintenant: Date): boolean {
    if (this.options.forcerFenetre) {
      return true;
    }
    const { jour, heure } = this.jourEtHeureParis(maintenant);
    return jour === MARDI && heure >= this.options.heureDeclenchement;
  }

  /** Jour (`weekday: 'short'` en-US) et heure (0-23) de l'instant, en Europe/Paris. */
  private jourEtHeureParis(maintenant: Date): { jour: string; heure: number } {
    const parties = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris',
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(maintenant);
    const jour = parties.find((p) => p.type === 'weekday')?.value ?? '';
    const heure = Number(parties.find((p) => p.type === 'hour')?.value ?? '0');
    return { jour, heure };
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

  /** Regroupe les contrats par foyer (préserve l'ordre d'arrivée). */
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
   * (Re)compose et envoie le récap du mardi d'un slot `envoi_recap_hebdo`, **reconstruit
   * depuis les données courantes**. Le foyer n'ayant **plus** de contrat actif (contrat
   * supprimé entre la création et l'envoi) → slot clôturé en `ENVOYE` sans mail (rien à
   * rappeler), plutôt qu'un plantage. Sinon, envoi puis transition du slot :
   *
   * - Destinataires = parents **actifs** du foyer pour `VALIDATION_HEBDO` (préférences
   *   projetées, PR4) ; RFC 8058 (PR5) : **un mail par destinataire** avec en-tête
   *   `List-Unsubscribe` propre au parent (jeton one-shot ; dégradation propre si sa
   *   frappe échoue). **Repli** sur `NOTIF_EMAIL_PARENT` si aucun parent joignable.
   * - Volet **in-app** (PR6) : créé **après** l'envoi abouti seulement — la phase envoi
   *   ne traite que des slots non encore aboutis, donc l'in-app n'est jamais dupliqué au
   *   retry (un échec mailer lève avant, laissant le slot en `ECHEC`, sans in-app).
   * - Transition finale : `ENVOYE`/`DRY_RUN` (selon les garde-fous du mailer). Une
   *   exception du mailer se propage à l'appelant, qui bascule le slot en `ECHEC`.
   */
  private async envoyerRecapFoyer(
    ligne: EnvoiRecapHebdoRow,
    contratsFoyer: ContratRow[],
    annuaire: Map<string, EtablissementProjeteVue>,
  ): Promise<void> {
    const { foyerId, semaineIso } = ligne;

    if (contratsFoyer.length === 0) {
      // Reconstruction depuis les données courantes : plus aucun contrat concerné.
      this.logger.log(
        `Récap mardi foyer ${foyerId} — aucun contrat actif, clôturé sans mail — semaine ${semaineIso}`,
      );
      await this.envoiRecap.marquerAbouti(foyerId, semaineIso, {
        statut: 'ENVOYE',
        messageId: null,
        destinataires: [],
      });
      return;
    }

    const enfants: RecapMardiEnfant[] = contratsFoyer.map((c) => {
      const etab = this.etablissementPourContrat(c.etablissementId, annuaire);
      return {
        enfant: c.enfant,
        etablissementLibelle: etab?.nom ?? null,
        preavisRegle: etab?.preavisRegle ?? null,
      };
    });
    // Lien profond **absolu** vers l'éditeur de la semaine du foyer (le front vit
    // sous `/foyers/:foyerId/planning` : sans le préfixe foyer, la route était
    // introuvable). `?semaine` ouvre l'éditeur de la semaine concernée d'un tap.
    const lienApp = `${this.options.appUrl}/foyers/${foyerId}/planning?semaine=${semaineIso}`;

    const destinataires = await this.destinataires.destinatairesActifs(
      foyerId,
      TYPE_VALIDATION_HEBDO,
    );

    const issue =
      destinataires.length === 0
        ? await this.envoyerRepli(foyerId, semaineIso, enfants, lienApp)
        : await this.envoyerParParent(
            foyerId,
            semaineIso,
            enfants,
            lienApp,
            destinataires,
          );

    // Volet in-app (PR6) : indépendant de l'e-mail, créé **après** l'envoi abouti (pas
    // au retry). Une entrée d'inbox est créée pour chaque parent dont le canal IN_APP
    // est actif, sans dupliquer l'action « Valider » (journal informationnel).
    await this.creerNotificationsInApp(
      foyerId,
      contratsFoyer.map((c) => c.enfant),
      semaineIso,
    );

    await this.envoiRecap.marquerAbouti(foyerId, semaineIso, issue);
  }

  /**
   * **Repli** (aucun parent joignable) : un seul mail vers `NOTIF_EMAIL_PARENT` — ce
   * n'est pas un parent réel, donc ni jeton ni en-tête de désabonnement — avec warning
   * de dépréciation. Renvoie l'issue (`ENVOYE`/`DRY_RUN`) pour la transition du slot.
   */
  private async envoyerRepli(
    foyerId: string,
    semaineIso: string,
    enfants: readonly RecapMardiEnfant[],
    lienApp: string,
  ): Promise<IssueEnvoiRecap> {
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
    const statut = resultat.dryRun ? 'DRY_RUN' : 'ENVOYE';
    this.logger.log(
      `Récap mardi foyer ${foyerId} (${String(enfants.length)} enfant(s), repli) — ${statut}, semaine ${semaineIso}`,
    );
    return {
      statut,
      messageId: resultat.messageId,
      destinataires: [this.options.emailParent],
    };
  }

  /**
   * **Un mail par destinataire** (RFC 8058, PR5) : chaque parent actif reçoit son mail,
   * avec en-tête `List-Unsubscribe` propre (jeton one-shot ; dégradation propre si la
   * frappe échoue — le mail part sans en-tête). Le slot est `ENVOYE` dès qu'un transport
   * réel a répondu (au moins un `dryRun=false`), `DRY_RUN` si tous les envois ont été
   * neutralisés. `message_id` = celui du premier envoi réel.
   */
  private async envoyerParParent(
    foyerId: string,
    semaineIso: string,
    enfants: readonly RecapMardiEnfant[],
    lienApp: string,
    destinataires: readonly DestinataireActif[],
  ): Promise<IssueEnvoiRecap> {
    const emails: string[] = [];
    let messageId: string | null = null;
    let auMoinsUnReel = false;
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
      emails.push(dest.email);
      if (!resultat.dryRun) {
        auMoinsUnReel = true;
        messageId = messageId ?? resultat.messageId;
      }
      this.logger.log(
        `Récap mardi ${resultat.dryRun ? '(dry-run) ' : ''}foyer ${foyerId} → ${dest.email} (${String(enfants.length)} enfant(s)${token ? '' : ', sans désabonnement'}) — semaine ${semaineIso}`,
      );
    }
    return {
      statut: auMoinsUnReel ? 'ENVOYE' : 'DRY_RUN',
      messageId,
      destinataires: emails,
    };
  }

  /**
   * Crée une entrée d'**inbox in-app** (PR6, §5.6) pour chaque parent du foyer dont le
   * canal `IN_APP` est actif pour `VALIDATION_HEBDO` (défaut §5.1 : actif). Le message
   * est **informationnel** — il annonce que le planning de la semaine est à valider,
   * sans porter l'action « Valider » (celle-ci reste dans l'encart `A_VALIDER`). Une
   * frappe qui échoue est journalisée sans interrompre l'envoi e-mail (dégradation
   * propre : l'in-app est un complément, pas un bloqueur du récap).
   */
  private async creerNotificationsInApp(
    foyerId: string,
    noms: readonly string[],
    semaineIso: string,
  ): Promise<void> {
    const parents = await this.destinataires.destinatairesInApp(
      foyerId,
      TYPE_VALIDATION_HEBDO,
    );
    if (parents.length === 0) {
      return;
    }
    const { sujet, corps, lien } = messageValidationHebdo({
      foyerId,
      noms,
      semaineIso,
    });
    for (const parentId of parents) {
      try {
        await this.inbox.creer({
          parentId,
          type: TYPE_VALIDATION_HEBDO,
          sujet,
          corps,
          lien,
        });
      } catch (erreur) {
        this.logger.warn(
          `Inbox in-app non créée pour le parent ${parentId} (foyer ${foyerId}, semaine ${semaineIso}) : ${(erreur as Error).message}`,
        );
      }
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
