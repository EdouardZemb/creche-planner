import { describe, expect, it, vi } from 'vitest';
import { PortabiliteController } from './portabilite.controller.js';
import type {
  ExportPlanificationVue,
  PortabiliteService,
} from './portabilite.service.js';

const FOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const VUE: ExportPlanificationVue = {
  contrats: [],
  etablissements: [],
};

/**
 * Le double est tenu par la variable `exporter` plutôt que relu sur l'objet
 * service : lire `service.exporter` dans un `expect` déclencherait
 * `@typescript-eslint/unbound-method` (méthode détachée de son objet).
 */
function controleur(exporter = vi.fn().mockResolvedValue(VUE)) {
  const service = { exporter } as unknown as PortabiliteService;
  return { exporter, ctrl: new PortabiliteController(service) };
}

describe('PortabiliteController', () => {
  it('relaie l’export au service pour le foyer demandé', async () => {
    const { ctrl, exporter } = controleur();
    await expect(ctrl.exporter(FOYER)).resolves.toEqual(VUE);
    expect(exporter).toHaveBeenCalledWith(FOYER);
  });

  it('laisse remonter l’échec du service (pas d’export partiel silencieux)', async () => {
    const { ctrl } = controleur(
      vi.fn().mockRejectedValue(new Error('base indisponible')),
    );
    await expect(ctrl.exporter(FOYER)).rejects.toThrow('base indisponible');
  });
});
