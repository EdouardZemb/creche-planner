import type { ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MontantNegatifError } from '@creche-planner/shared-kernel';
import { DomainExceptionFilter } from './domain-exception.filter.js';

/**
 * Traduction `DomainError` → HTTP 400, enregistrée globalement par les six
 * services. C'est le contrat que le front lit pour distinguer une saisie
 * invalide d'une panne : le `error` DOIT porter le nom de la classe d'erreur
 * (`new.target.name`, cf. `shared-kernel`), pas un libellé générique.
 */

function hote(): {
  host: ArgumentsHost;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('DomainExceptionFilter', () => {
  it('répond 400 en portant le nom de l’erreur de domaine et son message', () => {
    const { host, status, json } = hote();

    new DomainExceptionFilter().catch(
      new MontantNegatifError('montant négatif interdit'),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'MontantNegatifError',
      message: 'montant négatif interdit',
    });
  });
});
