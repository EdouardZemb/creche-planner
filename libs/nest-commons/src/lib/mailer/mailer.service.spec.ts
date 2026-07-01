import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MailerService } from './mailer.service.js';
import type { OptionsMailer } from './mailer.options.js';

/**
 * Le transport nodemailer est entièrement mocké : on vérifie la **logique de
 * garde** (dry-run, allowlist) et le passage des paramètres au transport, sans
 * jamais ouvrir de socket SMTP.
 *
 * `vi.hoisted` expose `sendMail`/`createTransport` au factory `vi.mock` (hissé
 * au-dessus des imports). Le service importe le **nommé** `createTransport`
 * (`import { createTransport } from 'nodemailer'`) → le mock l'expose en nommé.
 */
const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMail = vi.fn(() =>
    Promise.resolve({ messageId: '<msg-123@test>' }),
  );
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});

vi.mock('nodemailer', () => ({ createTransport }));

function options(partiel: Partial<OptionsMailer> = {}): OptionsMailer {
  return {
    host: 'smtp.test',
    port: 587,
    user: 'expediteur@test',
    passwordProvider: () => 'secret',
    from: 'Crèche Planner <expediteur@test>',
    dryRun: false,
    allowlist: [],
    ...partiel,
  };
}

const MESSAGE = {
  to: 'parent@test',
  subject: 'Valider la semaine 2026-W27',
  html: '<p>bonjour</p>',
  text: 'bonjour',
};

describe('MailerService', () => {
  beforeEach(() => {
    sendMail.mockClear();
    createTransport.mockClear();
  });

  it('dry-run : ne sollicite jamais le transport et retourne dryRun=true', async () => {
    const service = new MailerService(options({ dryRun: true }));

    const resultat = await service.envoyer(MESSAGE);

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(resultat).toEqual({ messageId: null, dryRun: true });
  });

  it('destinataire hors allowlist : bloque l’envoi (dryRun=true)', async () => {
    const service = new MailerService(
      options({ dryRun: false, allowlist: ['autorise@test'] }),
    );

    const resultat = await service.envoyer({ ...MESSAGE, to: 'inconnu@test' });

    expect(sendMail).not.toHaveBeenCalled();
    expect(resultat).toEqual({ messageId: null, dryRun: true });
  });

  // Non-régression AN-14 : l'allowlist se vérifie PAR destinataire, jamais sur le
  // champ `to` entier (un foyer à ≥ 2 parents était bloqué en bloc).
  it('AN-14 — foyer avec 2 parents autorisés : les deux adresses reçoivent', async () => {
    const service = new MailerService(
      options({
        dryRun: false,
        allowlist: ['parent1@test', 'parent2@test'],
      }),
    );

    const resultat = await service.envoyer({
      ...MESSAGE,
      to: 'parent1@test, parent2@test',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent1@test, parent2@test' }),
    );
    expect(resultat).toEqual({ messageId: '<msg-123@test>', dryRun: false });
  });

  it('AN-14 — adresse hors allowlist filtrée sans bloquer les autres (jamais vers une vraie crèche)', async () => {
    const service = new MailerService(
      options({ dryRun: false, allowlist: ['parent1@test'] }),
    );

    // L'adresse réelle de la crèche ne figure pas dans l'allowlist : elle doit
    // être neutralisée même si elle voyage avec une adresse autorisée.
    const resultat = await service.envoyer({
      ...MESSAGE,
      to: 'parent1@test, jaudrey@cscpapin.asso.fr',
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    // `to` émis strictement égal à la seule adresse autorisée : l'adresse de la
    // crèche réelle n'apparaît nulle part dans le message parti au transport.
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent1@test' }),
    );
    expect(resultat).toEqual({ messageId: '<msg-123@test>', dryRun: false });
  });

  it('AN-14 — aucun destinataire retenu : envoi entier neutralisé (dryRun=true)', async () => {
    const service = new MailerService(
      options({ dryRun: false, allowlist: ['parent1@test'] }),
    );

    const resultat = await service.envoyer({
      ...MESSAGE,
      to: 'inconnu@test, jaudrey@cscpapin.asso.fr',
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(resultat).toEqual({ messageId: null, dryRun: true });
  });

  it('envoi nominal : appelle le transport une fois et remonte le messageId', async () => {
    const service = new MailerService(
      options({ dryRun: false, allowlist: ['parent@test'] }),
    );

    const resultat = await service.envoyer(MESSAGE);

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Crèche Planner <expediteur@test>',
      to: 'parent@test',
      subject: 'Valider la semaine 2026-W27',
      html: '<p>bonjour</p>',
      text: 'bonjour',
    });
    expect(resultat).toEqual({ messageId: '<msg-123@test>', dryRun: false });
  });

  it('transmet les en-têtes additionnels (List-Unsubscribe RFC 8058) au transport', async () => {
    const service = new MailerService(
      options({ dryRun: false, allowlist: ['parent@test'] }),
    );
    const headers = {
      'List-Unsubscribe':
        '<https://app/desabonnement?token=abc>, <mailto:unsub@test>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };

    await service.envoyer({ ...MESSAGE, headers });

    expect(sendMail).toHaveBeenCalledWith({
      from: 'Crèche Planner <expediteur@test>',
      to: 'parent@test',
      subject: 'Valider la semaine 2026-W27',
      html: '<p>bonjour</p>',
      text: 'bonjour',
      headers,
    });
  });

  it('sans en-têtes : n’ajoute pas de clé `headers` au message (envois existants inchangés)', async () => {
    const service = new MailerService(
      options({ dryRun: false, allowlist: ['parent@test'] }),
    );

    await service.envoyer(MESSAGE);

    // Aucun `headers` ne doit apparaître dans le message émis (les envois
    // existants — et leurs assertions `toHaveBeenCalledWith` — restent inchangés).
    expect(sendMail).toHaveBeenCalledWith(
      expect.not.objectContaining({ headers: expect.anything() }),
    );
  });
});
