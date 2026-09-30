import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MailerService } from './mailer.service.js';
import type { OptionsMailer } from './mailer.options.js';

/**
 * Contrat avec le VRAI nodemailer — aucun `vi.mock`.
 *
 * `mailer.service.spec.ts` mocke `nodemailer` en entier : il garde la logique de
 * dry-run et d'allowlist, mais il passerait avec n'importe quelle version de la
 * bibliothèque, et même sans elle. Une montée majeure (9 → 10 : réécriture en
 * TypeScript, double build ESM/CJS, types embarqués) n'y serait donc jamais vue.
 *
 * Ici, le service parle SMTP à un serveur minimal ouvert sur 127.0.0.1 par le
 * test. Ce qu'on regarde est ce qui part SUR LE FIL : l'authentification, les
 * `RCPT TO` (l'allowlist doit tenir jusque dans l'enveloppe, pas seulement dans
 * l'en-tête `To`), les en-têtes de désabonnement RFC 8058, et le `messageId`
 * rendu à l'appelant. Aucun réseau extérieur, aucune adresse réelle.
 */

interface Session {
  auth: string[];
  mailFrom: string[];
  rcptTo: string[];
  donnees: string;
}

/** Réponse du serveur à la fin du DATA : `250` (accepté) ou un refus permanent. */
let reponseFinDonnees = '250 2.0.0 accepte';
let sessions: Session[] = [];
let serveur: Server;
let port = 0;

function servirSmtp(socket: Socket): void {
  const session: Session = { auth: [], mailFrom: [], rcptTo: [], donnees: '' };
  sessions.push(session);
  let tampon = '';
  let enDonnees = false;
  let attenteAuthLogin = 0;
  const ecrire = (ligne: string): void => {
    socket.write(`${ligne}\r\n`);
  };
  ecrire('220 smtp.factice.test ESMTP');
  socket.on('data', (morceau: Buffer) => {
    tampon += morceau.toString('utf8');
    let fin = tampon.indexOf('\r\n');
    while (fin !== -1) {
      const ligne = tampon.slice(0, fin);
      tampon = tampon.slice(fin + 2);
      fin = tampon.indexOf('\r\n');
      if (enDonnees) {
        if (ligne === '.') {
          enDonnees = false;
          ecrire(reponseFinDonnees);
        } else {
          session.donnees += `${ligne}\n`;
        }
        continue;
      }
      if (attenteAuthLogin > 0) {
        session.auth.push(Buffer.from(ligne, 'base64').toString('utf8'));
        attenteAuthLogin -= 1;
        ecrire(attenteAuthLogin > 0 ? '334 UGFzc3dvcmQ6' : '235 2.7.0 ok');
        continue;
      }
      const commande = ligne.toUpperCase();
      if (commande.startsWith('EHLO')) {
        ecrire('250-smtp.factice.test');
        ecrire('250-AUTH LOGIN');
        ecrire('250 8BITMIME');
      } else if (commande.startsWith('AUTH LOGIN')) {
        attenteAuthLogin = 2;
        ecrire('334 VXNlcm5hbWU6');
      } else if (commande.startsWith('MAIL FROM')) {
        session.mailFrom.push(ligne.slice(10));
        ecrire('250 2.1.0 ok');
      } else if (commande.startsWith('RCPT TO')) {
        session.rcptTo.push(ligne.slice(8));
        ecrire('250 2.1.5 ok');
      } else if (commande === 'DATA') {
        enDonnees = true;
        ecrire('354 fin par <CRLF>.<CRLF>');
      } else if (commande === 'QUIT') {
        ecrire('221 2.0.0 au revoir');
        socket.end();
      } else {
        ecrire('250 ok');
      }
    }
  });
}

function options(partiel: Partial<OptionsMailer> = {}): OptionsMailer {
  return {
    host: '127.0.0.1',
    port,
    user: 'expediteur@martha.test',
    passwordProvider: () => 'mot-de-passe-factice',
    from: 'Martha <expediteur@martha.test>',
    dryRun: false,
    allowlist: [],
    ...partiel,
  };
}

describe('MailerService — contrat SMTP avec le vrai nodemailer', () => {
  beforeEach(async () => {
    sessions = [];
    reponseFinDonnees = '250 2.0.0 accepte';
    serveur = createServer(servirSmtp);
    await new Promise<void>((resolve) => {
      serveur.listen(0, '127.0.0.1', resolve);
    });
    port = (serveur.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      serveur.close(() => {
        resolve();
      });
    });
  });

  it('authentifie, filtre l’enveloppe par l’allowlist, transmet les en-têtes et rend le Message-ID émis', async () => {
    const service = new MailerService(
      options({ allowlist: ['parent@famille.test'] }),
    );

    const resultat = await service.envoyer({
      to: 'parent@famille.test, secretariat@creche.example',
      subject: 'Valider la semaine 2026-W40',
      text: 'bonjour',
      headers: {
        'List-Unsubscribe': '<https://martha.example/desabonnement/jeton>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    expect(sessions).toHaveLength(1);
    const [session] = sessions;
    // AUTH LOGIN : identifiant puis mot de passe, lu paresseusement au 1er envoi.
    expect(session?.auth).toEqual([
      'expediteur@martha.test',
      'mot-de-passe-factice',
    ]);
    expect(session?.mailFrom).toEqual(['<expediteur@martha.test>']);
    // L'adresse hors allowlist n'est PAS dans l'enveloppe : elle ne reçoit rien.
    expect(session?.rcptTo).toEqual(['<parent@famille.test>']);
    expect(session?.donnees).not.toContain('secretariat@creche.example');
    expect(session?.donnees).toContain('Subject: Valider la semaine 2026-W40');
    expect(session?.donnees).toContain(
      'List-Unsubscribe: <https://martha.example/desabonnement/jeton>',
    );
    expect(session?.donnees).toContain(
      'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
    );
    // Le messageId rendu est celui de l'en-tête réellement émis.
    expect(resultat.dryRun).toBe(false);
    expect(resultat.messageId).toMatch(/^<.+@.+>$/);
    expect(session?.donnees).toContain(`Message-ID: ${resultat.messageId}`);
  });

  it('un refus permanent du serveur remonte à l’appelant (le scheduler retentera)', async () => {
    reponseFinDonnees = '554 5.7.1 refuse';
    const service = new MailerService(options());

    await expect(
      service.envoyer({
        to: 'parent@famille.test',
        subject: 'Refusé',
        text: 'x',
      }),
    ).rejects.toThrow(/554/);
  });
});
