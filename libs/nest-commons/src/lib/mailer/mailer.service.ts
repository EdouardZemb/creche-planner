import { Inject, Injectable, Logger } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import { createTransport } from 'nodemailer';
import { OPTIONS_MAILER, type OptionsMailer } from './mailer.options.js';

/**
 * Compteur OTel des échecs d'envoi SMTP réels, exporté en Prometheus sous
 * `notifications_envoi_echecs_total` (le label `service.name` est ajouté par le
 * collector — en pratique `svc-notifications`, seul consommateur du mailer). Si
 * aucun `MeterProvider` n'est enregistré, l'API OTel est un no-op silencieux. Il
 * mesure les rejets du **transport** (`sendMail` lève) — distinct du compteur
 * `recap_hebdo_abandonne_total` du scheduler (rappel abandonné, fenêtre close) :
 * ici on compte chaque tentative SMTP qui échoue, y compris celles qui seront
 * retentées. Modèle d'émission : `apps/svc-tarification/src/fallback/planification.client.ts`.
 */
const meterMailer = metrics.getMeter('nest-commons.mailer');
const compteurEchecsEnvoi = meterMailer.createCounter(
  'notifications_envoi_echecs_total',
  {
    description:
      "Échecs d'envoi SMTP (le transport a levé) — arme l'alerte EnvoiEmailEchecs.",
  },
);

/**
 * Transport SMTP concret renvoyé par `createTransport({host,...})`. On dérive le
 * type via `ReturnType` plutôt que `Transporter` nu : ce dernier vaut
 * `Transporter<any>` dans `@types/nodemailer` (qui déclare `SentMessageInfo =
 * any`), ce qui re-propagerait des `any` jusqu'à `messageId`.
 */
type TransportMail = ReturnType<typeof createTransport>;

/** Message à émettre. `html` et `text` sont optionnels (au moins l'un fourni). */
export interface MessageMail {
  /** Destinataire(s) : une adresse, ou plusieurs séparées par des virgules. */
  to: string;
  subject: string;
  html?: string;
  text?: string;
  /**
   * En-têtes SMTP additionnels (nom → valeur), transmis tels quels au transport.
   * Sert notamment aux en-têtes de désabonnement RFC 8058 (`List-Unsubscribe`,
   * `List-Unsubscribe-Post`). N'affecte pas les garde-fous `dryRun`/`allowlist`.
   */
  headers?: Readonly<Record<string, string>>;
}

/**
 * Résultat d'un envoi. `dryRun=true` signale qu'**aucun** transport SMTP n'a été
 * sollicité (mode bac à sable ou destinataire hors allowlist) ; `messageId` est
 * alors `null`.
 */
export interface ResultatEnvoi {
  messageId: string | null;
  dryRun: boolean;
}

/**
 * Partition des destinataires du champ `to` (adresses séparées par des
 * virgules) selon l'allowlist : `autorises` partiront, `filtres` sont
 * neutralisés. Allowlist vide ⇒ aucun filtrage (tout le monde est autorisé).
 *
 * Chaque adresse est vérifiée **individuellement** (AN-14) : comparer le `to`
 * entier bloquerait tout envoi dès qu'un foyer compte ≥ 2 parents, et une
 * adresse non autorisée (ex. une vraie crèche) ne doit jamais passer au motif
 * qu'elle voyage avec une adresse autorisée.
 */
export function partitionnerParAllowlist(
  to: string,
  allowlist: readonly string[],
): { autorises: readonly string[]; filtres: readonly string[] } {
  const tous = to
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (allowlist.length === 0) {
    return { autorises: tous, filtres: [] };
  }
  return {
    autorises: tous.filter((d) => allowlist.includes(d)),
    filtres: tous.filter((d) => !allowlist.includes(d)),
  };
}

/**
 * Service e-mail applicatif : enveloppe `nodemailer.createTransport`. L'effet de
 * bord sortant est protégé par deux garde-fous — `dryRun` et `allowlist` — qui
 * court-circuitent le transport sans jamais ouvrir de connexion SMTP.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transport?: TransportMail;

  constructor(
    @Inject(OPTIONS_MAILER) private readonly options: OptionsMailer,
  ) {}

  /**
   * Émet un message. Si `dryRun` est actif, l'envoi est journalisé et neutralisé :
   * retour `{ messageId: null, dryRun: true }`, transport intact. Quand l'allowlist
   * est renseignée, chaque destinataire du `to` est vérifié **individuellement**
   * (AN-14) : les adresses hors liste sont neutralisées (journalisées) sans bloquer
   * les autres ; si plus aucun destinataire ne subsiste, l'envoi entier est
   * neutralisé comme un dry-run.
   */
  async envoyer({
    to,
    subject,
    html,
    text,
    headers,
  }: MessageMail): Promise<ResultatEnvoi> {
    if (this.options.dryRun) {
      this.logger.log(`Dry-run — envoi neutralisé vers ${to} (« ${subject} »)`);
      return { messageId: null, dryRun: true };
    }
    const { autorises, filtres } = partitionnerParAllowlist(
      to,
      this.options.allowlist,
    );
    if (filtres.length > 0) {
      this.logger.warn(
        `Destinataire(s) hors allowlist — neutralisé(s) : ${filtres.join(', ')} (« ${subject} »)`,
      );
    }
    if (autorises.length === 0) {
      return { messageId: null, dryRun: true };
    }

    try {
      const info = await this.obtenirTransport().sendMail({
        from: this.options.from,
        to: autorises.join(', '),
        subject,
        html,
        text,
        // En-têtes additionnels seulement s'ils sont fournis, pour ne pas modifier
        // le message émis (et les assertions de test) des envois existants.
        ...(headers ? { headers } : {}),
      });
      return { messageId: info.messageId, dryRun: false };
    } catch (erreur) {
      // Échec du transport SMTP : on compte l'incident (arme `EnvoiEmailEchecs`) puis
      // on relaie l'erreur à l'appelant — le scheduler transitionne le slot en `ECHEC`
      // et retentera, le comportement fonctionnel reste strictement inchangé.
      compteurEchecsEnvoi.add(1);
      throw erreur;
    }
  }

  /** Transport créé paresseusement : le mot de passe n'est lu qu'au 1ᵉʳ envoi réel. */
  private obtenirTransport(): TransportMail {
    this.transport ??= createTransport({
      host: this.options.host,
      port: this.options.port,
      auth: { user: this.options.user, pass: this.options.passwordProvider() },
    });
    return this.transport;
  }
}
