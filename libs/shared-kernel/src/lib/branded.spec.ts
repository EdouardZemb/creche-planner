import { describe, expect, expectTypeOf, it } from 'vitest';
import { brander, type Brand } from './branded.js';

type FoyerId = Brand<string, 'FoyerId'>;
type EnfantId = Brand<string, 'EnfantId'>;

const asFoyerId = brander<string, 'FoyerId'>();

describe('Brand / brander', () => {
  it('ne modifie pas la valeur à l’exécution (étiquette effacée)', () => {
    const brut = '11111111-1111-4111-8111-111111111111';
    expect(asFoyerId(brut)).toBe(brut);
  });

  it('produit un type assignable vers le primitif sous-jacent', () => {
    const id = asFoyerId('abc');
    const enClair: string = id; // un FoyerId reste un string
    expect(enClair).toBe('abc');
  });

  it('distingue nominalement deux identités de même forme (niveau type)', () => {
    expectTypeOf(asFoyerId('x')).toEqualTypeOf<FoyerId>();
    expectTypeOf<FoyerId>().not.toEqualTypeOf<EnfantId>();
    // Un string brut n'est pas un FoyerId :
    expectTypeOf<string>().not.toEqualTypeOf<FoyerId>();
  });
});
