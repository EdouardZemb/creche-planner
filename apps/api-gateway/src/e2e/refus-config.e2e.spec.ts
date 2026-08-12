import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Test **E2E de refus de démarrage** (`AM-44`, lot 5 des standards).
 *
 * Une spec unitaire de `loadConfig()` prouve que la fonction lève. Elle ne prouve
 * **pas** que le processus refuse de démarrer : entre les deux il y a l'ordre
 * d'évaluation des modules, un `void bootstrap()` dont la promesse rejetée
 * pourrait n'être qu'un avertissement, et un code de sortie que personne n'a
 * regardé. C'est la leçon `LE-39` du lot 4 : sept tests verts affirmaient un
 * format que la passerelle n'a jamais émis, chacun fabriquant son attendu de la
 * même main que son observé. Un test au moins doit traverser le **bundle réel**.
 *
 * On lance donc `dist/main.js` en sous-processus avec un environnement
 * volontairement invalide, et on vérifie **trois** choses qu'aucune spec
 * unitaire ne peut montrer : le processus **s'arrête**, son code de sortie est
 * **non nul** (sans quoi Docker considérerait le conteneur sain), et son
 * `stderr` **nomme la variable fautive** — c'est le seul canal disponible, le
 * logger pino n'existant pas encore à ce stade.
 *
 * Ignoré si le bundle n'a pas été buildé (`nx run api-gateway:build`) ; le target
 * `test` d'api-gateway dépend de son propre `build`, donc en CI il est présent.
 */

// nx lance vitest avec cwd = racine du projet (apps/api-gateway).
const BUNDLE = resolve(process.cwd(), 'dist/main.js');

interface Sortie {
  readonly code: number | null;
  readonly stderr: string;
}

/** Lance le bundle avec l'env donné et rend son code de sortie + stderr. */
async function demarrer(env: Record<string, string>): Promise<Sortie> {
  const proc = spawn(process.execPath, [BUNDLE], {
    // `env` REMPLACE l'environnement (pas de `...process.env`) : la machine de
    // CI ou du poste ne doit pas fournir accidentellement une variable qui
    // rendrait le cas de test valide. `PATH` reste inutile ici (on exécute déjà
    // `process.execPath`).
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

  it('s’arrête en code non nul et nomme PORT quand le port est illisible', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const { code, stderr } = await demarrer({ PORT: 'quatre-mille' });

    expect(code).not.toBe(0);
    expect(stderr).toContain('PORT');
    expect(stderr).toContain('api-gateway');
    // La valeur d'un champ mécanique est citée : c'est ce qui rend le refus
    // actionnable sans avoir à retrouver quel compose a posé quoi.
    expect(stderr).toContain('quatre-mille');
  }, 40000);

  it('nomme RATE_LIMIT_MAX plutôt que de désactiver le rate-limit', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const { code, stderr } = await demarrer({ RATE_LIMIT_MAX: 'beaucoup' });

    expect(code).not.toBe(0);
    expect(stderr).toContain('RATE_LIMIT_MAX');
  }, 40000);

  it('refuse une production dont les URL amont sont restées sur localhost', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const { code, stderr } = await demarrer({
      NODE_ENV: 'production',
      GATEWAY_AUTH_DISABLED: '1',
    });

    expect(code).not.toBe(0);
    expect(stderr).toContain('REFERENTIEL_URL');
    expect(stderr).toContain('NOTIFICATIONS_URL');
  }, 40000);

  it('refuse une production sans jeton ni échappatoire (AQ-01, sur le fil)', async (ctx) => {
    if (!bundlePresent) {
      return ctx.skip();
    }
    const { code, stderr } = await demarrer({
      NODE_ENV: 'production',
      REFERENTIEL_URL: 'http://svc-referentiel:3001',
      FOYER_URL: 'http://svc-foyer:3002',
      PLANIFICATION_URL: 'http://svc-planification:3004',
      TARIFICATION_URL: 'http://svc-tarification:3005',
      NOTIFICATIONS_URL: 'http://svc-notifications:3006',
    });

    expect(code).not.toBe(0);
    expect(stderr).toContain('GATEWAY_TOKEN requis en production');
  }, 40000);
});
