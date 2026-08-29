import { describe, expect, it } from 'vitest';
import {
  contratParDefaut,
  couvreLeMois,
  etatContrat,
  libelleEtatContrat,
  moisUtile,
  resoudreContratAffiche,
} from './etatContrat';
import type { ContratLocal } from '../types/bff';

/** Les deux contrats crèche successifs du cas réel (production, 2026-08-29). */
const ANCIEN = { valideDu: '2026-01-01', valideAu: '2026-07-24' };
const RENTREE = { valideDu: '2026-09-01', valideAu: '2027-07-23' };
const SANS_TERME = { valideDu: '2026-01-01', valideAu: null };

/** Contrat complet minimal, pour les fonctions qui en attendent un. */
function contrat(
  id: string,
  periode: { valideDu: string; valideAu: string | null },
  mode = 'CRECHE_PSU',
): ContratLocal {
  return {
    id,
    foyerId: 'foyer-1',
    enfant: 'Lisa',
    enfantId: 'enfant-lisa',
    mode,
    ...periode,
  } as ContratLocal;
}

describe('etatContrat', () => {
  it('classe les deux contrats du cas réel, vus depuis le mois d’août', () => {
    expect(etatContrat(ANCIEN, '2026-08')).toBe('echu');
    expect(etatContrat(RENTREE, '2026-08')).toBe('a-venir');
  });

  it('le même contrat n’est « échu » que RELATIVEMENT au mois regardé', () => {
    expect(etatContrat(ANCIEN, '2026-05')).toBe('en-cours');
    expect(etatContrat(ANCIEN, '2026-07')).toBe('en-cours'); // il finit le 24
    expect(etatContrat(ANCIEN, '2026-08')).toBe('echu');
  });

  it('un contrat sans terme n’est jamais échu', () => {
    expect(etatContrat(SANS_TERME, '2099-12')).toBe('en-cours');
  });

  it('couvre le mois de son dernier jour, et pas le suivant', () => {
    expect(couvreLeMois(ANCIEN, '2026-07')).toBe(true);
    expect(couvreLeMois(ANCIEN, '2026-08')).toBe(false);
    expect(couvreLeMois(RENTREE, '2026-08')).toBe(false);
    expect(couvreLeMois(RENTREE, '2026-09')).toBe(true);
  });
});

describe('libelleEtatContrat', () => {
  it('dit ce qui DISTINGUE deux contrats du même mode', () => {
    expect(libelleEtatContrat(ANCIEN, '2026-08')).toBe('terminé le 24/07/2026');
    expect(libelleEtatContrat(RENTREE, '2026-08')).toBe(
      'à partir du 01/09/2026',
    );
  });

  it('nomme la fin pour un contrat en cours qui en a une', () => {
    expect(libelleEtatContrat(ANCIEN, '2026-05')).toBe('jusqu’au 24/07/2026');
  });

  it('nomme le début pour un contrat en cours sans terme', () => {
    expect(libelleEtatContrat(SANS_TERME, '2026-05')).toBe(
      'depuis le 01/01/2026',
    );
  });
});

describe('moisUtile', () => {
  it('renvoie vers le mois où il y a effectivement à saisir', () => {
    expect(moisUtile(ANCIEN, '2026-08')).toBe('2026-07');
    expect(moisUtile(RENTREE, '2026-08')).toBe('2026-09');
  });

  it('rend null quand le contrat couvre déjà le mois affiché', () => {
    expect(moisUtile(ANCIEN, '2026-05')).toBeNull();
  });
});

describe('contratParDefaut', () => {
  const ancien = contrat('c-ancien', ANCIEN);
  const rentree = contrat('c-rentree', RENTREE);

  it('en août, ouvre le contrat de la RENTRÉE, pas celui qui s’est achevé', () => {
    // L'ancien repli `contrats[0]` ouvrait l'écran sur un contrat clos en juillet.
    expect(contratParDefaut([ancien, rentree], '2026-08')?.id).toBe(
      'c-rentree',
    );
  });

  it('privilégie un contrat valide pour le mois quand il en existe un', () => {
    expect(contratParDefaut([ancien, rentree], '2026-05')?.id).toBe('c-ancien');
    expect(contratParDefaut([ancien, rentree], '2026-10')?.id).toBe(
      'c-rentree',
    );
  });

  it('à défaut, retombe sur le dernier contrat terminé', () => {
    const vieux = contrat('c-vieux', {
      valideDu: '2025-01-01',
      valideAu: '2025-12-31',
    });
    expect(contratParDefaut([vieux, ancien], '2026-08')?.id).toBe('c-ancien');
  });

  it('rend null sur une liste vide', () => {
    expect(contratParDefaut([], '2026-08')).toBeNull();
  });
});

describe('resoudreContratAffiche', () => {
  const ancien = contrat('c-ancien', ANCIEN);
  const rentree = contrat('c-rentree', RENTREE);
  const liste = [ancien, rentree];

  it('`?contrat=` désigne un contrat PRÉCIS — ce que `?mode=` ne sait pas faire', () => {
    expect(resoudreContratAffiche(liste, '2026-08', 'c-ancien', null)?.id).toBe(
      'c-ancien',
    );
    expect(
      resoudreContratAffiche(liste, '2026-08', 'c-rentree', null)?.id,
    ).toBe('c-rentree');
  });

  it('`?mode=` reste accepté (liens profonds déjà émis), au premier du mode', () => {
    expect(
      resoudreContratAffiche(liste, '2026-08', null, 'CRECHE_PSU')?.id,
    ).toBe('c-ancien');
  });

  it('`?contrat=` l’emporte sur `?mode=`', () => {
    expect(
      resoudreContratAffiche(liste, '2026-08', 'c-rentree', 'CRECHE_PSU')?.id,
    ).toBe('c-rentree');
  });

  it('un `?contrat=` inconnu retombe sur le choix par défaut, sans planter', () => {
    expect(
      resoudreContratAffiche(liste, '2026-08', 'inexistant', null)?.id,
    ).toBe('c-rentree');
  });
});
