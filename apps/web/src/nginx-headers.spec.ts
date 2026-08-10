import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Garde des en-têtes de sécurité (AM-43). Les en-têtes vivent en un seul
 * endroit — `nginx.conf` — et aucune porte ne les couvrait : une ligne perdue
 * dans une refonte du fichier serait restée invisible (motif MO-1). On
 * confronte donc le fichier réel, pas une recopie, et la **sonde négative est
 * rejouée à chaque run** : les cas mutés ci-dessous prouvent que la garde mord.
 *
 * Ne couvre PAS : la réponse effectivement servie (config surchargée au
 * déploiement, en-tête retiré par un proxy amont) — cela demande la pile
 * réelle.
 */

/** En-têtes exigés, avec le fragment de valeur qui porte la garantie. */
const EXIGES: readonly (readonly [entete: string, fragment: string])[] = [
  ['Strict-Transport-Security', 'max-age='],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=()'],
  ['Content-Security-Policy', "frame-ancestors 'none'"],
];

/**
 * Confronte une config nginx aux exigences ; renvoie les violations (vide =
 * conforme). Fonction pure pour que la sonde négative puisse la rejouer sur
 * des configs mutées sans toucher au fichier réel.
 */
export function violationsEnTetes(conf: string): string[] {
  const violations: string[] = [];
  for (const [entete, fragment] of EXIGES) {
    const ligne = conf
      .split('\n')
      .find((l) => l.trimStart().startsWith(`add_header ${entete} `));
    if (ligne === undefined) {
      violations.push(`${entete} : add_header absent`);
      continue;
    }
    if (!ligne.includes(fragment)) {
      violations.push(`${entete} : fragment « ${fragment} » absent`);
    }
    // `always` : l'en-tête doit suivre aussi les réponses d'erreur (4xx/5xx).
    if (!ligne.trimEnd().endsWith('always;')) {
      violations.push(`${entete} : \`always\` manquant`);
    }
  }
  const csp = conf
    .split('\n')
    .find((l) => l.includes('Content-Security-Policy'));
  const scriptSrc = /script-src ([^;]*)/.exec(csp ?? '')?.[1] ?? '';
  if (!scriptSrc.includes("'self'") || scriptSrc.includes('unsafe-inline')) {
    violations.push(
      "Content-Security-Policy : `script-src` doit être 'self' sans unsafe-inline",
    );
  }
  return violations;
}

const NGINX_CONF = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'nginx.conf'),
  'utf8',
);

describe('en-têtes de sécurité nginx (garde AM-43)', () => {
  it('le nginx.conf réel est conforme', () => {
    expect(violationsEnTetes(NGINX_CONF)).toEqual([]);
  });

  // Sonde négative rejouable : chaque mutation doit être vue par la garde.
  it.each(EXIGES.map(([entete]) => entete))(
    'sonde négative — la garde mord si %s disparaît',
    (entete) => {
      const mutee = NGINX_CONF.split('\n')
        .filter((l) => !l.includes(`add_header ${entete} `))
        .join('\n');
      expect(violationsEnTetes(mutee).some((v) => v.startsWith(entete))).toBe(
        true,
      );
    },
  );

  it('sonde négative — la garde mord si `always` est retiré', () => {
    const mutee = NGINX_CONF.replace(
      /add_header Strict-Transport-Security ([^;]*) always;/,
      'add_header Strict-Transport-Security $1;',
    );
    expect(violationsEnTetes(mutee)).not.toEqual([]);
  });

  it('sonde négative — la garde mord si `script-src` s’ouvre à unsafe-inline', () => {
    const mutee = NGINX_CONF.replace(
      "script-src 'self'",
      "script-src 'self' 'unsafe-inline'",
    );
    expect(violationsEnTetes(mutee)).not.toEqual([]);
  });
});
