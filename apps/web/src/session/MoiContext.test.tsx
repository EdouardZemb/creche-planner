import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api/client', () => ({
  api: { moi: vi.fn() },
  // `useAsync` → `messageErreur` teste `e instanceof ApiError` sur le chemin
  // d'échec : la classe doit exister dans le mock du module.
  ApiError: class ApiError extends Error {
    status: number;
    corps: unknown;
    constructor(status: number, corps: unknown) {
      super(`HTTP ${status}`);
      this.name = 'ApiError';
      this.status = status;
      this.corps = corps;
    }
  },
}));

import { api } from '../api/client';
import { MoiProvider, useMoi } from './MoiContext';

const mockedApi = api as unknown as { moi: ReturnType<typeof vi.fn> };

/** Sonde rendant l'état exposé par `useMoi` sous forme lisible. */
function Sonde() {
  const moi = useMoi();
  return (
    <div data-testid="moi">
      {moi.loading
        ? 'loading'
        : `email=${moi.email ?? 'null'} admin=${moi.admin} foyers=${moi.foyers.join(',')}`}
    </div>
  );
}

describe('MoiContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('expose les valeurs résolues par /api/v1/moi', async () => {
    mockedApi.moi.mockResolvedValue({
      email: 'parent@test.fr',
      admin: false,
      foyers: ['f1', 'f2'],
    });
    render(
      <MoiProvider>
        <Sonde />
      </MoiProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('moi')).toHaveTextContent(
        'email=parent@test.fr admin=false foyers=f1,f2',
      );
    });
  });

  it('repli permissif/hérité si /api/v1/moi échoue (admin=true, email=null)', async () => {
    mockedApi.moi.mockRejectedValue(new Error('réseau'));
    render(
      <MoiProvider>
        <Sonde />
      </MoiProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('moi')).toHaveTextContent(
        'email=null admin=true foyers=',
      );
    });
  });

  it('hors MoiProvider : défaut permissif/hérité, sans appel réseau', () => {
    render(<Sonde />);
    expect(screen.getByTestId('moi')).toHaveTextContent(
      'email=null admin=true foyers=',
    );
    expect(mockedApi.moi).not.toHaveBeenCalled();
  });
});
