import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type {
  FoyerClient,
  FoyerVue,
  ParentVue,
} from '../clients/foyer.client.js';
import { FoyersController } from './foyers.controller.js';

const FOYER: FoyerVue = {
  id: 'foyer-1',
  ressourcesMensuellesCentimes: 671692,
  ressourcesMensuellesEuros: 6716.92,
  rfrCentimes: 7270500,
  rfrEuros: 72705,
  nbEnfantsACharge: 2,
  nbParts: 3,
  tranche: 3,
};

const parent = (p: Partial<ParentVue> & Pick<ParentVue, 'id'>): ParentVue => ({
  foyerId: 'foyer-1',
  prenom: 'Alex',
  nom: 'Dupont',
  email: 'alex@example.test',
  principal: false,
  ordre: 0,
  actif: true,
  ...p,
});

describe('FoyersController · création orchestrée', () => {
  it('crée le foyer puis rattache enfants et parents dans l’ordre', async () => {
    const creerFoyer = vi.fn().mockResolvedValue(FOYER);
    const ajouterEnfant = vi
      .fn()
      .mockResolvedValue({ id: 'e1', foyerId: 'foyer-1' });
    const ajouterParent = vi
      .fn()
      .mockImplementation((_id: string, saisie: { email: string }) =>
        Promise.resolve(parent({ id: 'p1', email: saisie.email })),
      );
    const controller = new FoyersController({
      creerFoyer,
      ajouterEnfant,
      ajouterParent,
    } as unknown as FoyerClient);

    const vue = await controller.creer({
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
      enfants: [{ prenom: 'Mia', dateNaissance: '2024-12-08' }],
      parents: [{ email: 'alex@example.test', principal: true }],
    });

    expect(creerFoyer).toHaveBeenCalledOnce();
    expect(ajouterEnfant).toHaveBeenCalledWith('foyer-1', {
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    });
    expect(ajouterParent).toHaveBeenCalledWith('foyer-1', {
      email: 'alex@example.test',
      principal: true,
    });
    expect(vue.parents).toHaveLength(1);
    expect(vue.parents[0]?.email).toBe('alex@example.test');
  });

  it('accepte une création sans parents (défaut [])', async () => {
    const creerFoyer = vi.fn().mockResolvedValue(FOYER);
    const ajouterParent = vi.fn();
    const controller = new FoyersController({
      creerFoyer,
      ajouterEnfant: vi.fn(),
      ajouterParent,
    } as unknown as FoyerClient);

    const vue = await controller.creer({
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
    });

    expect(ajouterParent).not.toHaveBeenCalled();
    expect(vue.parents).toEqual([]);
  });

  it('refuse un parent à l’e-mail invalide (400, sans appel amont)', () => {
    const creerFoyer = vi.fn();
    const controller = new FoyersController({
      creerFoyer,
    } as unknown as FoyerClient);

    expect(() =>
      controller.creer({
        ressourcesMensuelles: 6716.92,
        rfr: 72705,
        nbEnfantsACharge: 2,
        nbParts: 3,
        parents: [{ email: 'pas-un-email' }],
      }),
    ).toThrow(BadRequestException);
    expect(creerFoyer).not.toHaveBeenCalled();
  });
});

describe('FoyersController · édition des scalaires', () => {
  it('valide puis relaie l’édition des scalaires', async () => {
    const mettreAJour = vi.fn().mockResolvedValue(FOYER);
    const controller = new FoyersController({
      mettreAJour,
    } as unknown as FoyerClient);

    const vue = await controller.mettreAJour('foyer-1', {
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
    });

    expect(mettreAJour).toHaveBeenCalledWith('foyer-1', {
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
    });
    expect(vue).toEqual(FOYER);
  });

  it('refuse un corps invalide (400, sans appel amont)', () => {
    const mettreAJour = vi.fn();
    const controller = new FoyersController({
      mettreAJour,
    } as unknown as FoyerClient);

    expect(() =>
      controller.mettreAJour('foyer-1', { ressourcesMensuelles: -1 }),
    ).toThrow(BadRequestException);
    expect(mettreAJour).not.toHaveBeenCalled();
  });

  it('propage une erreur amont en HttpException (relais)', async () => {
    const mettreAJour = vi.fn().mockRejectedValue(new Error('HTTP 404'));
    const controller = new FoyersController({
      mettreAJour,
    } as unknown as FoyerClient);

    await expect(
      controller.mettreAJour('foyer-1', {
        ressourcesMensuelles: 6716.92,
        rfr: 72705,
        nbEnfantsACharge: 2,
        nbParts: 3,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('FoyersController · ajout d’enfant', () => {
  it('valide puis relaie le rattachement d’un enfant', async () => {
    const ajouterEnfant = vi
      .fn()
      .mockResolvedValue({ id: 'e1', foyerId: 'foyer-1' });
    const controller = new FoyersController({
      ajouterEnfant,
    } as unknown as FoyerClient);

    await controller.ajouterEnfant('foyer-1', {
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    });

    expect(ajouterEnfant).toHaveBeenCalledWith('foyer-1', {
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    });
  });

  it('refuse un enfant sans prénom (400, sans appel amont)', () => {
    const ajouterEnfant = vi.fn();
    const controller = new FoyersController({
      ajouterEnfant,
    } as unknown as FoyerClient);

    expect(() =>
      controller.ajouterEnfant('foyer-1', { dateNaissance: '2024-12-08' }),
    ).toThrow(BadRequestException);
    expect(ajouterEnfant).not.toHaveBeenCalled();
  });
});

describe('FoyersController · lecture agrégée', () => {
  it('agrège foyer, enfants et parents', async () => {
    const controller = new FoyersController({
      foyer: vi.fn().mockResolvedValue(FOYER),
      enfants: vi.fn().mockResolvedValue([{ id: 'e1' }]),
      parents: vi.fn().mockResolvedValue([parent({ id: 'p1' })]),
    } as unknown as FoyerClient);

    const vue = await controller.lire('foyer-1');

    expect(vue.foyer).toEqual(FOYER);
    expect(vue.enfants).toHaveLength(1);
    expect(vue.parents).toHaveLength(1);
  });
});

describe('FoyersController · CRUD parents', () => {
  it('liste les parents', async () => {
    const parents = vi.fn().mockResolvedValue([parent({ id: 'p1' })]);
    const controller = new FoyersController({
      parents,
    } as unknown as FoyerClient);

    const vue = await controller.listerParents('foyer-1');

    expect(parents).toHaveBeenCalledWith('foyer-1');
    expect(vue).toHaveLength(1);
  });

  it('rattache un parent (valide puis relaie)', async () => {
    const ajouterParent = vi.fn().mockResolvedValue(parent({ id: 'p1' }));
    const controller = new FoyersController({
      ajouterParent,
    } as unknown as FoyerClient);

    await controller.ajouterParent('foyer-1', { email: 'alex@example.test' });

    expect(ajouterParent).toHaveBeenCalledWith('foyer-1', {
      email: 'alex@example.test',
    });
  });

  it('refuse l’ajout d’un e-mail invalide (400, sans appel amont)', () => {
    const ajouterParent = vi.fn();
    const controller = new FoyersController({
      ajouterParent,
    } as unknown as FoyerClient);

    expect(() =>
      controller.ajouterParent('foyer-1', { email: 'nope' }),
    ).toThrow(BadRequestException);
    expect(ajouterParent).not.toHaveBeenCalled();
  });

  it('édite un parent (champs fournis uniquement)', async () => {
    const modifierParent = vi
      .fn()
      .mockResolvedValue(parent({ id: 'p1', principal: true }));
    const controller = new FoyersController({
      modifierParent,
    } as unknown as FoyerClient);

    await controller.modifierParent('foyer-1', 'p1', { principal: true });

    expect(modifierParent).toHaveBeenCalledWith('foyer-1', 'p1', {
      principal: true,
    });
  });

  it('retire un parent', async () => {
    const retirerParent = vi.fn().mockResolvedValue(undefined);
    const controller = new FoyersController({
      retirerParent,
    } as unknown as FoyerClient);

    await controller.retirerParent('foyer-1', 'p1');

    expect(retirerParent).toHaveBeenCalledWith('foyer-1', 'p1');
  });

  it('propage une erreur amont en HttpException (relais)', async () => {
    const ajouterParent = vi.fn().mockRejectedValue(new Error('HTTP 409'));
    const controller = new FoyersController({
      ajouterParent,
    } as unknown as FoyerClient);

    await expect(
      controller.ajouterParent('foyer-1', { email: 'alex@example.test' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
