import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Test **E2E de refus de démarrage** (`AM-44`, lot 5 des standards), volet
 * `svc-notifications`.
 *
 * Ce service porte la règle de production la plus **métier** du dépôt : les URL
 * de base insérées dans les liens d'e-mail doivent être `https` sur un nom de
 * domaine public, jamais l'IP LAN du serveur (certificat non fiable, injoignable
 * hors-LAN pour le parent). Un `z.url()` l'accepterait sans broncher — la
 * validation de forme du lot 5 ne remplace donc pas la règle, elle la porte. Ce
 * test le prouve sur le **bundle réel** (`LE-39` : un attendu écrit à côté de son
 * observé ne prouve rien du fil), et il prouve accessoirement que le refus arrive
 * **avant** le pool Postgres et le consommateur JetStream — l'environnement
 * ci-dessous ne contient aucune base joignable, et le processus rend la main en
 * quelques secondes.
 *
 * Ignoré si le bundle n'a pas été buildé ; le target `test` du service dépend de
 * son propre `build`, donc en CI il est présent.
 */

// nx lance vitest avec cwd = racine du projet (apps/svc-notifications).
const BUNDLE = resolve(process.cwd(), 'dist/main.js');

/** Amonts posés, comme en production : seuls les liens d'e-mail sont en cause. */
const AMONTS = {
  DATABASE_URL: 'postgres://u:p@postgres-notifications:5432/notifications',
  NATS_URL: 'nats://nats:4222',
  PLANIFICATION_URL: 'http://svc-planification:3004',
  FOYER_URL: 'http://svc-foyer:3002',
} as const;

interface Sortie {
  readonly code: number | null;
  readonly stderr: string;
}

/** Lance le bundle avec l'env donné et rend son code de sortie + stderr. */
async function demarrer(env: Record<string, string>): Promise<Sortie> {
  const proc = spawn(process.execPath, [BUNDLE], {
    // `env` REMPLACE l'environnement : aucune variable de la machine ne doit
    // rendre le cas de test valide par accident.
    env: { OTEL_SDK_DISABLED: 'true', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  proc.stderr?.on('data', (morceau) => {
    stderr += String(morceau);
  });
  return new Promise<Sortie>((resoudre, rejeter) => {
    const minuterie = setTimeout(() => {
      proc.kill('SIGKILL');
      rejeter(
        new Error(
          `le processus n'a pas rendu la main en 30 s : il a DÉMARRÉ malgré une configuration invalide.\nstderr : ${stderr}`,
        ),
      );
    }, 30000);
    proc.on('exit', (code) => {
      clearTimeout(minuterie);
      resoudre({ code, stderr });
    });
  });
}

describe('E2E · refus de démarrage sur configuration invalide (AM-44)', () => {
  const bundlePresent = existsSync(BUNDLE);

  it('refuse une IP LAN dans les liens d’e-mail en production', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const { code, stderr } = await demarrer({
      NODE_ENV: 'production',
      ...AMONTS,
      NOTIF_APP_URL: 'https://192.168.1.129',
      NOTIF_PUBLIC_API_URL: 'https://creche.testlens.dev',
    });

    expect(code).not.toBe(0);
    expect(stderr).toContain('NOTIF_APP_URL=https://192.168.1.129');
    expect(stderr).toContain('URL https à nom de domaine public');
  }, 40000);

  it('s’arrête en code non nul et nomme l’heure du scheduler si elle est impossible', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const { code, stderr } = await demarrer({ NOTIF_SCHEDULER_HEURE: '25' });

    expect(code).not.toBe(0);
    expect(stderr).toContain('NOTIF_SCHEDULER_HEURE');
    expect(stderr).toContain('svc-notifications');
  }, 40000);

  it('ne cite pas, sur le fil, le secret que porte la variable fautive', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    // `DATABASE_URL` est le champ qui **peut** échouer et dont la valeur porte un
    // mot de passe : c'est lui qui exerce vraiment la non-citation. (Une
    // assertion sur `SMTP_PASSWORD`, champ sans contrainte, serait vide de sens.)
    const { code, stderr } = await demarrer({
      DATABASE_URL: 'mysql://u:mot-de-passe-secret@db:3306/notifications',
    });

    expect(code).not.toBe(0);
    expect(stderr).toContain('DATABASE_URL');
    expect(stderr).not.toContain('mot-de-passe-secret');
  }, 40000);

  it('refuse un secret entouré d’espaces plutôt que de le rogner', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const { code, stderr } = await demarrer({
      ASSERTION_IDENTITE_SECRET: ' cle-hmac-partagee ',
    });

    expect(code).not.toBe(0);
    expect(stderr).toContain('ASSERTION_IDENTITE_SECRET');
    expect(stderr).toContain('espaces');
    expect(stderr).not.toContain('cle-hmac-partagee');
  }, 40000);
});
