import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, gte, isNull, lte, or } from 'drizzle-orm';
import { DRIZZLE, MailerService } from '@creche-planner/nest-commons';
import { MODES_CONTRAT } from '@creche-planner/contracts-planification';
import type { Database } from '../database/database.types.js';
import { contrat, type ContratRow } from '../database/schema.js';
import { ValidationService } from '../validation/validation.service.js';
import {
  EtablissementService,
  type EtablissementVue,
} from '../etablissement/etablissement.service.js';
import { cleEtablissementPourMode } from '../etablissement/etablissement.dto.js';
import {
  joursDeLaSemaine,
  semaineIsoDeDate,
} from '@creche-planner/shared-semaine';
import { recapMardi } from '../email/templates/recapMardi.js';
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
 * 1ʳᵉ écriture gagne, les ticks/réplicas suivants sont des no-op. **Seules** les
 * lignes nouvellement créées déclenchent l'envoi du mail récap au parent (Lot 2,
 * dry-run par défaut), de sorte qu'un second tick le même mardi n'envoie rien.
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
    private readonly etablissements: EtablissementService,
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
      const annuaire = await this.annuaireParCle();
      for (const c of contrats) {
        const cree = await this.validation.notifier({
          contratId: c.id,
          foyerId: c.foyerId,
          semaineIso,
        });
        if (cree) {
          await this.envoyerRecap(c, semaineIso, annuaire);
        }
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

  /** Annuaire des établissements indexé par clé (résolution du préavis du mail). */
  private async annuaireParCle(): Promise<Map<string, EtablissementVue>> {
    const liste = await this.etablissements.lister();
    return new Map(liste.map((e) => [e.cle, e]));
  }

  /** Compose et envoie le mail récap du mardi pour un contrat fraîchement notifié. */
  private async envoyerRecap(
    c: ContratRow,
    semaineIso: string,
    annuaire: Map<string, EtablissementVue>,
  ): Promise<void> {
    const etab = this.etablissementPourMode(c.mode, annuaire);
    const message = recapMardi({
      enfant: c.enfant,
      semaineIso,
      lienApp: `${this.options.appUrl}/planning?semaine=${semaineIso}`,
      etablissementLibelle: etab?.libelle ?? null,
      preavisRegle: etab?.preavisRegle ?? null,
    });
    const resultat = await this.mailer.envoyer({
      to: this.options.emailParent,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    this.logger.log(
      `Récap mardi ${resultat.dryRun ? '(dry-run) ' : ''}pour ${c.enfant} — semaine ${semaineIso}`,
    );
  }

  /** Résout l'établissement destinataire à partir du mode du contrat (sinon `undefined`). */
  private etablissementPourMode(
    mode: string,
    annuaire: Map<string, EtablissementVue>,
  ): EtablissementVue | undefined {
    const connu = MODES_CONTRAT.find((m) => m === mode);
    if (!connu) {
      return undefined;
    }
    return annuaire.get(cleEtablissementPourMode(connu));
  }
}
