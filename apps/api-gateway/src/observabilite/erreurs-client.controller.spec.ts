import { BadRequestException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gatewayOpenApiDocument } from '@creche-planner/contracts-kernel';
import { ErreursClientController } from './erreurs-client.controller.js';

/** Espionne la ligne journalisée par le contrôleur (`Logger.error`). */
function espionJournal() {
  return vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
}

const SIGNALEMENT = {
  origine: 'route',
  message: 'Cannot read properties of undefined',
  route: '/foyers/abc/planning',
};

describe('ErreursClientController (POST /api/v1/erreurs-client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('journalise le plantage sous l’ancre de recherche « PLANTAGE CLIENT »', () => {
    const journal = espionJournal();
    new ErreursClientController().signaler(SIGNALEMENT);

    const [ligne] = journal.mock.calls[0] ?? [];
    expect(String(ligne)).toBe(
      'PLANTAGE CLIENT origine=route route=/foyers/abc/planning ' +
        'message=Cannot read properties of undefined',
    );
  });

  it('passe la pile en second argument (trace Nest), sans la fondre dans le message', () => {
    const journal = espionJournal();
    new ErreursClientController().signaler({
      ...SIGNALEMENT,
      pile: 'Error: boum\n    at Composant (index.js:1:1)',
    });

    const [ligne, pile] = journal.mock.calls[0] ?? [];
    expect(String(ligne)).not.toContain('at Composant');
    expect(String(pile)).toContain('at Composant');
  });

  it('neutralise les sauts de ligne d’un message forgé (injection de journal)', () => {
    const journal = espionJournal();
    new ErreursClientController().signaler({
      ...SIGNALEMENT,
      message: 'innocent\nPLANTAGE CLIENT origine=route message=forgé',
    });

    const [ligne] = journal.mock.calls[0] ?? [];
    // Une seule entrée possible : la ligne journalisée ne contient AUCUN saut de
    // ligne, donc un message forgé ne peut pas en fabriquer une seconde.
    expect(String(ligne)).not.toMatch(/[\n\r]/);
    expect(String(ligne)).toContain('innocent PLANTAGE CLIENT');
  });

  it('n’ajoute `composant` que s’il est fourni', () => {
    const journal = espionJournal();
    const controleur = new ErreursClientController();

    controleur.signaler(SIGNALEMENT);
    expect(String(journal.mock.calls[0]?.[0])).not.toContain('composant=');

    controleur.signaler({ ...SIGNALEMENT, composant: 'at PlanningPage' });
    expect(String(journal.mock.calls[1]?.[0])).toContain(
      'composant=at PlanningPage',
    );
  });

  it('accepte TOUTES les origines déclarées par le contrat — et rien d’autre', () => {
    espionJournal();
    const controleur = new ErreursClientController();
    const origines =
      gatewayOpenApiDocument.components.schemas.ErreurClient.properties.origine
        .enum;

    // Les origines viennent du document OpenAPI (dérivation, pas recopie) : ce
    // test échouerait si le contrat en ajoutait une que la gateway refuserait.
    for (const origine of origines) {
      expect(() => {
        controleur.signaler({ ...SIGNALEMENT, origine });
      }).not.toThrow();
    }

    expect(() => {
      controleur.signaler({ ...SIGNALEMENT, origine: 'inventée' });
    }).toThrow(BadRequestException);
  });

  it('refuse un corps hors bornes (la gateway ne fait pas confiance au client)', () => {
    espionJournal();
    const controleur = new ErreursClientController();

    expect(() => {
      controleur.signaler({ ...SIGNALEMENT, message: 'm'.repeat(501) });
    }).toThrow(BadRequestException);
    expect(() => {
      controleur.signaler({ ...SIGNALEMENT, message: '' });
    }).toThrow(BadRequestException);
    expect(() => {
      controleur.signaler({ origine: 'route', message: 'x' });
    }).toThrow(BadRequestException);
    expect(() => {
      controleur.signaler({ ...SIGNALEMENT, pile: 'p'.repeat(4001) });
    }).toThrow(BadRequestException);
  });
});
