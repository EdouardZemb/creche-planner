import { Inject, Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { OPTIONS_MAILER, type OptionsMailer } from './mailer.options.js';

/**
 * Transport SMTP concret renvoyé par `createTransport({host,...})`. On dérive le
 * type via `ReturnType` plutôt que `Transporter` nu : ce dernier vaut
 * `Transporter<any>` dans `@types/nodemailer` (qui déclare `SentMessageInfo =
 * any`), ce qui re-propagerait des `any` jusqu'à `messageId`.
 */
type TransportMail = ReturnType<typeof createTransport>;

/** Message à émettre. `html` et `text` sont optionnels (au moins l'un fourni). */
export interface MessageMail {
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
   * Émet un message. Si `dryRun` est actif **ou** si le destinataire n'est pas
   * dans l'allowlist (quand celle-ci est renseignée), l'envoi est journalisé et
   * neutralisé : retour `{ messageId: null, dryRun: true }`, transport intact.
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
    if (!this.estAutorise(to)) {
      this.logger.warn(
        `Destinataire hors allowlist — envoi neutralisé vers ${to} (« ${subject} »)`,
      );
      return { messageId: null, dryRun: true };
    }

    const info = await this.obtenirTransport().sendMail({
      from: this.options.from,
      to,
      subject,
      html,
      text,
      // En-têtes additionnels seulement s'ils sont fournis, pour ne pas modifier
      // le message émis (et les assertions de test) des envois existants.
      ...(headers ? { headers } : {}),
    });
    return { messageId: info.messageId, dryRun: false };
  }

  /** Allowlist vide ⇒ aucun filtrage ; sinon le `to` doit y figurer. */
  private estAutorise(to: string): boolean {
    return (
      this.options.allowlist.length === 0 || this.options.allowlist.includes(to)
    );
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
