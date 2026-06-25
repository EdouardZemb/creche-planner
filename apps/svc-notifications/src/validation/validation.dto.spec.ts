import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { SemaineIsoPipe } from './validation.dto.js';

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
