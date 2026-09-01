import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type {
  SessionUaVue,
  SuiviUaVue,
  TarificationClient,
} from '../clients/tarification.client.js';
import { UnitesAssociativesController } from './unites-associatives.controller.js';

const FOYER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ENGAGEMENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const SUIVI: SuiviUaVue = {
  foyerId: FOYER,
  aujourdhui: '2026-10-01',
  engagement: {
    id: ENGAGEMENT,
    foyerId: FOYER,
    debut: '2026-06-01',
    fin: '2027-05-31',
    quotaHeures: 20,
    valeurUaCentimes: 3125,
    cautionCentimes: 62500,
  },
  compteurs: {
    quotaHeures: 20,
    heuresRealisees: 6,
    heuresReservees: 3,
    heuresAConfirmer: 0,
    heuresRestantes: 11,
    quotaAtteint: false,
    joursAvantEcheance: 242,
    coutSiArret: { montantCentimes: 43750, hypothese: 'SI_TU_TARRETES_LA' },
    coutSiReservationsRealisees: {
      montantCentimes: 34375,
      hypothese: 'SI_TU_REALISES_TES_RESERVATIONS',
    },
    alerteEcheance: false,
  },
  sessions: [],
  seuilAlerteJours: 56,
};

const SESSION_VUE: SessionUaVue = {
  id: SESSION,
  engagementId: ENGAGEMENT,
  date: '2026-10-17',
  dureeHeures: 2,
  type: 'MENAGE',
  realisePar: 'Camille',
  etablissementId: null,
  etat: 'PREVUE',
  aConfirmer: false,
};

function controleur(
  client: Partial<TarificationClient>,
): UnitesAssociativesController {
  return new UnitesAssociativesController(client as TarificationClient);
}

describe('UnitesAssociativesController · lecture', () => {
  it('relaie le suivi du foyer tel quel — aucun recalcul côté passerelle', async () => {
    const suivi = vi.fn().mockResolvedValue(SUIVI);
    const vue = await controleur({
      suiviUnitesAssociatives: suivi,
    }).suivi(FOYER);

    expect(suivi).toHaveBeenCalledWith(FOYER);
    // Le BFF ne refait aucun des trois compteurs : un second calcul serait une
    // seconde vérité, et c'est celle du domaine qui fait foi.
    expect(vue).toBe(SUIVI);
  });

  // Refus SYNCHRONE, avant tout appel aval : passé dans `relayer`, un paramètre
  // manquant deviendrait un 502 « erreur du service amont » — une faute de saisie
  // du client déguisée en panne de la passerelle.
  it('exige le paramètre « foyer », et le refuse avant tout appel aval', () => {
    expect(() => controleur({}).suivi(undefined)).toThrow(BadRequestException);
  });
});

describe('UnitesAssociativesController · déclaration de l’engagement', () => {
  it('valide la forme et relaie la saisie', async () => {
    const declarer = vi.fn().mockResolvedValue(SUIVI.engagement);
    await controleur({ declarerEngagementUa: declarer }).declarer(FOYER, {
      debut: '2026-06-01',
      fin: '2027-05-31',
      quotaHeures: 20,
      valeurUaCentimes: 3125,
      cautionCentimes: 62500,
    });

    expect(declarer).toHaveBeenCalledWith(FOYER, {
      debut: '2026-06-01',
      fin: '2027-05-31',
      quotaHeures: 20,
      valeurUaCentimes: 3125,
      cautionCentimes: 62500,
    });
  });

  it('refuse une date qui n’est pas une date ISO', () => {
    const declarer = vi.fn();
    expect(() =>
      controleur({ declarerEngagementUa: declarer }).declarer(FOYER, {
        debut: 'juin',
        fin: '2027-05-31',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
      }),
    ).toThrow(BadRequestException);
    expect(declarer).not.toHaveBeenCalled();
  });

  it('refuse un quota négatif', () => {
    expect(() =>
      controleur({ declarerEngagementUa: vi.fn() }).declarer(FOYER, {
        debut: '2026-06-01',
        fin: '2027-05-31',
        quotaHeures: -1,
        valeurUaCentimes: 3125,
      }),
    ).toThrow(BadRequestException);
  });

  it('relaie un 409 de chevauchement de période (US-40-01 CA2)', async () => {
    const declarer = vi.fn().mockRejectedValue(new Error('HTTP 409'));
    await expect(
      controleur({ declarerEngagementUa: declarer }).declarer(FOYER, {
        debut: '2026-06-01',
        fin: '2027-05-31',
        quotaHeures: 20,
        valeurUaCentimes: 3125,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('UnitesAssociativesController · sessions', () => {
  it('note un créneau et relaie la session créée', async () => {
    const ajouter = vi.fn().mockResolvedValue(SESSION_VUE);
    const vue = await controleur({ ajouterSessionUa: ajouter }).ajouterSession(
      FOYER,
      {
        engagementId: ENGAGEMENT,
        date: '2026-10-17',
        dureeHeures: 2,
        type: 'MENAGE',
        realisePar: 'Camille',
      },
    );

    expect(ajouter).toHaveBeenCalledWith(FOYER, expect.any(Object));
    // Une session naît PREVUE : Martha n'a rien réservé, et n'a rien réalisé.
    expect(vue.etat).toBe('PREVUE');
  });

  it('refuse une durée nulle ou négative', () => {
    expect(() =>
      controleur({ ajouterSessionUa: vi.fn() }).ajouterSession(FOYER, {
        engagementId: ENGAGEMENT,
        date: '2026-10-17',
        dureeHeures: 0,
        type: 'MENAGE',
      }),
    ).toThrow(BadRequestException);
  });

  it('accepte un corps réduit au seul état (« c’est fait »)', async () => {
    const modifier = vi
      .fn()
      .mockResolvedValue({ ...SESSION_VUE, etat: 'REALISEE' });
    const vue = await controleur({
      modifierSessionUa: modifier,
    }).modifierSession(SESSION, FOYER, { etat: 'REALISEE' });

    expect(modifier).toHaveBeenCalledWith(FOYER, SESSION, {
      etat: 'REALISEE',
    });
    expect(vue.etat).toBe('REALISEE');
  });

  it('refuse un état hors du catalogue', () => {
    expect(() =>
      controleur({ modifierSessionUa: vi.fn() }).modifierSession(
        SESSION,
        FOYER,
        { etat: 'PEUT_ETRE' },
      ),
    ).toThrow(BadRequestException);
  });

  it('supprime une session et ne rend aucun corps', async () => {
    const supprimer = vi.fn().mockResolvedValue(undefined);
    await expect(
      controleur({ supprimerSessionUa: supprimer }).supprimerSession(
        SESSION,
        FOYER,
      ),
    ).resolves.toBeUndefined();
    expect(supprimer).toHaveBeenCalledWith(FOYER, SESSION);
  });

  it('relaie le 404 d’une session inconnue pour ce foyer', async () => {
    const supprimer = vi.fn().mockRejectedValue(new Error('HTTP 404'));
    await expect(
      controleur({ supprimerSessionUa: supprimer }).supprimerSession(
        SESSION,
        FOYER,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
