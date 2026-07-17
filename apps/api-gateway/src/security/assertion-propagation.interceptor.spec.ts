import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import { AssertionPropagationInterceptor } from './assertion-propagation.interceptor.js';
import { contexteAssertionCourant } from './contexte-assertion.js';
import type { RequeteIdentifiable } from './identite.js';

function fakeContext(req: RequeteIdentifiable): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/**
 * Handler qui **capture** le contexte ALS vu au moment de son exécution : c'est ce
 * que liraient les clients HTTP appelés depuis le handler.
 */
function handlerCapture(): {
  handler: CallHandler;
  lu: () => ReturnType<typeof contexteAssertionCourant>;
} {
  let capture: ReturnType<typeof contexteAssertionCourant>;
  const handler: CallHandler = {
    handle: () => {
      capture = contexteAssertionCourant();
      return of('ok');
    },
  };
  return { handler, lu: () => capture };
}

describe('AssertionPropagationInterceptor', () => {
  const interceptor = new AssertionPropagationInterceptor();

  it('sans identité → n’ouvre aucun contexte (les clients retomberont sur machine)', async () => {
    const { handler, lu } = handlerCapture();
    const req: RequeteIdentifiable = { headers: {} };
    await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    expect(lu()).toBeUndefined();
  });

  it('avec identité + foyers + admin → ouvre le contexte parent pour le handler', async () => {
    const { handler, lu } = handlerCapture();
    const req: RequeteIdentifiable = {
      headers: {},
      identite: { email: 'parent@test.fr' },
      foyersAutorises: ['f-1', 'f-2'],
      estAdmin: true,
    };
    await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    expect(lu()).toEqual({
      email: 'parent@test.fr',
      foyers: ['f-1', 'f-2'],
      admin: true,
    });
  });

  it('identité sans foyers résolus (route non scopée) → contexte sans foyers', async () => {
    const { handler, lu } = handlerCapture();
    const req: RequeteIdentifiable = {
      headers: {},
      identite: { email: 'parent@test.fr' },
    };
    await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    expect(lu()).toEqual({
      email: 'parent@test.fr',
      foyers: undefined,
      admin: undefined,
    });
  });

  it('le contexte est refermé après la requête (pas de fuite entre requêtes)', async () => {
    const { handler } = handlerCapture();
    const req: RequeteIdentifiable = {
      headers: {},
      identite: { email: 'parent@test.fr' },
    };
    await firstValueFrom(interceptor.intercept(fakeContext(req), handler));
    expect(contexteAssertionCourant()).toBeUndefined();
  });
});
