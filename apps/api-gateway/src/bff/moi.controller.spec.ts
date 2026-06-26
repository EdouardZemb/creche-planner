import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FoyerClient } from '../clients/foyer.client.js';
import { type RequeteIdentifiable } from '../security/identite.js';
import { MoiController } from './moi.controller.js';

function fakeFoyers(
  foyersParEmail: (email: string) => Promise<string[]>,
): FoyerClient {
  return { foyersParEmail: vi.fn(foyersParEmail) } as unknown as FoyerClient;
}

function req(identite?: { email: string }): RequeteIdentifiable {
  return { headers: {}, ...(identite ? { identite } : {}) };
}

describe('MoiController (/api/v1/moi, PR6)', () => {
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ADMIN_EMAILS'];
  });

  afterEach(() => {
    process.env = envInitial;
    vi.restoreAllMocks();
  });

  it('sans identité : email null, foyers vides, pas d’appel svc-foyer', async () => {
    const foyers = fakeFoyers(async () => ['f-1']);
    const moi = await new MoiController(foyers).lire(req());
    expect(moi.email).toBeNull();
    expect(moi.foyers).toEqual([]);
    expect(foyers.foyersParEmail).not.toHaveBeenCalled();
  });

  it('gating inactif (allowlist vide) : admin permissif=true même sans identité', async () => {
    const moi = await new MoiController(fakeFoyers(async () => [])).lire(req());
    expect(moi.admin).toBe(true);
  });

  it('gating actif + identité admin : admin=true et foyers résolus', async () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const foyers = fakeFoyers(async () => ['f-1', 'f-2']);
    const moi = await new MoiController(foyers).lire(
      req({ email: 'admin@example.test' }),
    );
    expect(moi).toEqual({
      email: 'admin@example.test',
      admin: true,
      foyers: ['f-1', 'f-2'],
    });
    expect(foyers.foyersParEmail).toHaveBeenCalledWith('admin@example.test');
  });

  it('gating actif + identité non-admin : admin=false, foyers bornés', async () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const foyers = fakeFoyers(async () => ['f-9']);
    const moi = await new MoiController(foyers).lire(
      req({ email: 'parent@example.test' }),
    );
    expect(moi.admin).toBe(false);
    expect(moi.foyers).toEqual(['f-9']);
  });

  it('résolution svc-foyer en échec : foyers vides, ne lève pas', async () => {
    const foyers = fakeFoyers(async () => {
      throw new Error('svc-foyer indisponible');
    });
    const moi = await new MoiController(foyers).lire(
      req({ email: 'parent@example.test' }),
    );
    expect(moi.email).toBe('parent@example.test');
    expect(moi.foyers).toEqual([]);
  });
});
