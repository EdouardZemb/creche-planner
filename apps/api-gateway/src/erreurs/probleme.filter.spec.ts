import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ArgumentsHost } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_TYPE_PROBLEME } from '@creche-planner/contracts-kernel';
import { FormatErreurNatif } from './format-erreur-natif.decorator.js';
import { ProblemeFilter } from './probleme.filter.js';

/**
 * Le filtre est la **seule** chose qui parle sur le fil quand une route échoue :
 * ces cas sont écrits à partir des corps réellement observés en amont
 * (`node -e` sur `HttpException.createBody`), pas d'une forme supposée. C'est
 * précisément la confusion qui a laissé `AN-21` vivre : six tests du front
 * fabriquaient un corps que la passerelle n'a jamais émis.
 */

interface Capture {
  statut: number;
  corps: unknown;
  entetes: Record<string, string>;
  termine: boolean;
}

/** Faux `ArgumentsHost` HTTP, avec la route (classe/handler) qu'on veut viser. */
function hote(
  capture: Capture,
  route: { classe?: unknown; handler?: unknown } = {},
  url = '/api/v1/foyers/f-1/parents',
  headersSent = false,
): ArgumentsHost {
  const reponse = {
    headersSent,
    setHeader: (nom: string, valeur: string): void => {
      capture.entetes[nom] = valeur;
    },
    end: (): void => {
      capture.termine = true;
    },
    status: (code: number) => ({
      json: (corps: unknown): void => {
        capture.statut = code;
        capture.corps = corps;
      },
    }),
  };
  return {
    getType: () => 'http',
    getHandler: () => route.handler,
    getClass: () => route.classe,
    switchToHttp: () => ({
      getResponse: () => reponse,
      getRequest: () => ({ originalUrl: url }),
    }),
  } as unknown as ArgumentsHost;
}

function capturer(): Capture {
  return { statut: 0, corps: undefined, entetes: {}, termine: false };
}

/** Espionne le journal privé du filtre (seul moyen d'observer ce geste). */
function espionnerJournal(filtre: ProblemeFilter) {
  return vi
    .spyOn(
      (filtre as unknown as { logger: { error: (...a: unknown[]) => void } })
        .logger,
      'error',
    )
    .mockImplementation(() => undefined);
}

describe('ProblemeFilter', () => {
  let filtre: ProblemeFilter;

  beforeEach(() => {
    filtre = new ProblemeFilter(new Reflector());
  });

  it('pose le type de média RFC 9457 et les membres normalisés', () => {
    const c = capturer();
    filtre.catch(
      new BadRequestException('paramètre « foyer » requis'),
      hote(c),
    );

    expect(c.entetes['Content-Type']).toBe(MEDIA_TYPE_PROBLEME);
    expect(c.statut).toBe(400);
    expect(c.corps).toEqual({
      type: 'about:blank',
      title: 'Requête invalide',
      status: 400,
      detail: 'paramètre « foyer » requis',
      instance: '/api/v1/foyers/f-1/parents',
    });
  });

  // Le corps réel d'un `BadRequestException([{ champ, message }])` est
  // `{ message: [...], error, statusCode }` : le tableau est ENVELOPPÉ par Nest.
  // C'est ce qui rendait `extraireErreurs` (front) définitivement muet.
  it('remonte les erreurs par champ de `valider()` dans le membre `erreurs`', () => {
    const c = capturer();
    filtre.catch(
      new BadRequestException([
        { champ: 'rfrCentimes', message: 'RFR invalide' },
        { champ: 'nbParts', message: 'nombre de parts invalide' },
      ]),
      hote(c),
    );

    expect(c.corps).toMatchObject({
      status: 400,
      erreurs: [
        { champ: 'rfrCentimes', message: 'RFR invalide' },
        { champ: 'nbParts', message: 'nombre de parts invalide' },
      ],
    });
  });

  it('préserve le code métier d’un 409 relayé, et en dérive type et titre', () => {
    const c = capturer();
    filtre.catch(
      new ConflictException({
        statusCode: 409,
        code: 'EMAIL_DEJA_UTILISE',
        message: 'adresse e-mail déjà utilisée dans ce foyer',
      }),
      hote(c),
    );

    expect(c.corps).toEqual({
      type: 'urn:probleme:creche-planner:email-deja-utilise',
      title: 'adresse e-mail déjà utilisée dans ce foyer',
      status: 409,
      detail: 'adresse e-mail déjà utilisée dans ce foyer',
      instance: '/api/v1/foyers/f-1/parents',
      code: 'EMAIL_DEJA_UTILISE',
    });
  });

  it('ignore un `code` amont inconnu du registre plutôt que de le publier', () => {
    const c = capturer();
    filtre.catch(
      new ConflictException({ statusCode: 409, code: 'INVENTE_AILLEURS' }),
      hote(c),
    );

    expect(c.corps).toMatchObject({ type: 'about:blank', title: 'Conflit' });
    expect(c.corps).not.toHaveProperty('code');
  });

  // Repli du relais BFF : `{ statut, message, detail }`. `detail` y porte la
  // cause brute (« HTTP 503 ») — elle reste au journal, pas sur le fil.
  it('sur panne amont, publie le message client et tait la cause brute', () => {
    const c = capturer();
    filtre.catch(
      new HttpException(
        {
          statut: 502,
          message: 'erreur du service amont',
          detail: 'HTTP 503',
        },
        HttpStatus.BAD_GATEWAY,
      ),
      hote(c),
    );

    expect(c.corps).toMatchObject({
      status: 502,
      title: 'Service amont indisponible',
      detail: 'erreur du service amont',
    });
    expect(JSON.stringify(c.corps)).not.toContain('HTTP 503');
  });

  it('une exception non HTTP devient un 500 sans rien divulguer', () => {
    const c = capturer();
    filtre.catch(
      new Error('connect ECONNREFUSED 10.0.0.4:5432 — role "planner"'),
      hote(c),
    );

    expect(c.statut).toBe(500);
    expect(c.corps).toMatchObject({
      type: 'about:blank',
      title: 'Erreur interne',
      status: 500,
      detail: 'le service a rencontré une erreur inattendue',
    });
    expect(JSON.stringify(c.corps)).not.toContain('ECONNREFUSED');
  });

  it('journalise une exception non HTTP — le gestionnaire par défaut le faisait', () => {
    const c = capturer();
    const journal = espionnerJournal(filtre);

    filtre.catch(new Error('boum'), hote(c));

    expect(journal).toHaveBeenCalledOnce();
    journal.mockRestore();
  });

  // `BaseExceptionFilter` ne journalise QUE les exceptions inconnues. Journaliser
  // tous les 5xx ferait cracher une pile à chaque sonde de readiness pendant
  // qu'un amont est tombé — un déluge pendant l'incident qu'il éclairerait.
  it('ne journalise pas une HttpException, même en 5xx', () => {
    const c = capturer();
    const journal = espionnerJournal(filtre);

    filtre.catch(
      new HttpException('erreur du service amont', HttpStatus.BAD_GATEWAY),
      hote(c),
    );

    expect(journal).not.toHaveBeenCalled();
    journal.mockRestore();
  });

  // `instance` désigne l'occurrence, pas la requête entière : recopier la query
  // réfléchirait le jeton de désabonnement — actionnable sans authentification —
  // dans un corps d'erreur que le navigateur affiche.
  it('n’expose jamais la chaîne de requête dans `instance`', () => {
    const c = capturer();
    filtre.catch(
      new BadRequestException('lien de désabonnement invalide ou expiré'),
      hote(c, {}, '/api/v1/desabonnement?token=eyJhbGciOi.secret.signature'),
    );

    expect(c.corps).toMatchObject({ instance: '/api/v1/desabonnement' });
    expect(JSON.stringify(c.corps)).not.toContain('secret');
  });

  // Écrire après coup lèverait `ERR_HTTP_HEADERS_SENT` DEPUIS le filtre
  // d'exceptions, d'où plus rien ne peut la rattraper.
  it('n’écrit rien si la réponse est déjà partie', () => {
    const c = capturer();
    filtre.catch(new Error('trop tard'), hote(c, {}, '/api/v1/foyers', true));

    expect(c.termine).toBe(true);
    expect(c.statut).toBe(0);
    expect(c.entetes['Content-Type']).toBeUndefined();
  });

  describe('exemption @FormatErreurNatif()', () => {
    // Décoré au niveau du CONTRÔLEUR, comme `HealthController` : le handler
    // n'est alors porteur d'aucune métadonnée, c'est la classe qui exempte.
    @FormatErreurNatif()
    class SanteControleur {
      // Propriété-flèche plutôt que méthode : `SanteControleur.prototype.sonde`
      // serait une méthode non liée (règle `unbound-method`), et une classe sans
      // aucun membre ferait monter la baseline du ratchet d'un warning.
      readonly sonde = (): void => undefined;
    }

    /** Handler de la route : il ne porte aucune métadonnée, la classe exempte. */
    const sonde = new SanteControleur().sonde;

    it('rend le rapport de santé tel quel, sans en-tête problem+json', () => {
      const c = capturer();
      const rapport = {
        status: 'error',
        info: {},
        error: { 'svc-foyer': { status: 'down' } },
        details: { 'svc-foyer': { status: 'down' } },
      };

      filtre.catch(
        new ServiceUnavailableException(rapport),
        hote(
          c,
          {
            classe: SanteControleur,
            handler: sonde,
          },
          '/api/health',
        ),
      );

      expect(c.statut).toBe(503);
      expect(c.corps).toEqual(rapport);
      expect(c.entetes['Content-Type']).toBeUndefined();
    });
  });

  it('traduit malgré tout hors d’une route résolue (404 du routeur)', () => {
    const c = capturer();
    filtre.catch(
      new HttpException('Cannot GET /api/v1/inconnu', HttpStatus.NOT_FOUND),
      hote(c, { classe: undefined, handler: undefined }, '/api/v1/inconnu'),
    );

    expect(c.corps).toMatchObject({
      status: 404,
      title: 'Ressource introuvable',
    });
  });
});
