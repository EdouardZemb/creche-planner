import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SemaineIsoPipe, ZodValidationPipe } from './validation.dto.js';

describe('SemaineIsoPipe', () => {
  const pipe = new SemaineIsoPipe();

  it.each([['2026-W01'], ['2026-W27'], ['2025-W53']])(
    'accepte une semaine ISO bien formée (%s)',
    (valeur) => {
      expect(pipe.transform(valeur)).toBe(valeur);
    },
  );

  it.each([['2026-W00'], ['2026-W54'], ['2026-27'], ['2026W27'], ['']])(
    'rejette une semaine ISO invalide (%s) en 400',
    (valeur) => {
      expect(() => pipe.transform(valeur)).toThrow(BadRequestException);
    },
  );
});

describe('ZodValidationPipe', () => {
  const schema = z.object({ email: z.email() });

  it('renvoie la valeur parsée si valide', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(pipe.transform({ email: 'service@example.org' })).toEqual({
      email: 'service@example.org',
    });
  });

  it('lève une 400 au format [{champ,message}] si invalide', () => {
    const pipe = new ZodValidationPipe(schema);
    expect(() => pipe.transform({ email: 'x' })).toThrow(BadRequestException);
  });
});
