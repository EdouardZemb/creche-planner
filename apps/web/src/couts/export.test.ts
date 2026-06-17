import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  coutMoisVersCsv,
  coutAnnuelVersCsv,
  nomFichierCoutMois,
  nomFichierCoutAnnuel,
  telechargerCsv,
} from './export';
import type { CoutMoisVue, CoutAnnuelVue } from '../types/bff';

const coutMois: CoutMoisVue = {
  foyerId: 'foyer-1',
  mois: '2026-06',
  simule: false,
  totalCentimes: 35000,
  prestations: [
    {
      enfant: 'Emma',
      mode: 'CRECHE_PSU',
      totalCentimes: 35000,
      lignes: [
        { libelle: 'Mensualité crèche', sens: 'debit', montantCentimes: 40000 },
        { libelle: 'Aide CAF', sens: 'credit', montantCentimes: 5000 },
      ],
    },
  ],
  lignes: [{ libelle: 'Total net', sens: 'debit', montantCentimes: 35000 }],
};

const coutAnnuelSimule: CoutAnnuelVue = {
  foyerId: 'foyer-1',
  annee: 2026,
  simule: true,
  totalCentimes: 62000,
  mois: [
    {
      foyerId: 'foyer-1',
      mois: '2026-01',
      simule: true,
      totalCentimes: 30000,
      prestations: [],
      lignes: [],
    },
    {
      foyerId: 'foyer-1',
      mois: '2026-02',
      simule: true,
      totalCentimes: 32000,
      prestations: [],
      lignes: [],
    },
  ],
};

const coutAnnuelReel: CoutAnnuelVue = {
  ...coutAnnuelSimule,
  simule: false,
  totalCentimes: 70000,
  mois: [
    { ...coutAnnuelSimule.mois[0]!, simule: false, totalCentimes: 35000 },
    { ...coutAnnuelSimule.mois[1]!, simule: false, totalCentimes: 35000 },
  ],
};

describe('coutMoisVersCsv', () => {
  it('produit un en-tête FR et les lignes de prestation', () => {
    const csv = coutMoisVersCsv(coutMois);
    expect(csv).toContain('Enfant;Mode;Libellé;Sens;Montant');
    expect(csv).toContain('Emma;CRECHE_PSU;Mensualité crèche;Débit;-');
    expect(csv).toContain('Aide CAF;Crédit;+');
  });

  it('affiche les montants en euros et le total du mois', () => {
    const csv = coutMoisVersCsv(coutMois);
    // 40000 centimes = 400,00 € ; le débit est préfixé par "-".
    expect(csv).toContain('400,00');
    // Total du mois = 35000 centimes = 350,00 €.
    expect(csv).toContain('Total du mois');
    expect(csv).toContain('350,00');
  });

  it('utilise le point-virgule comme séparateur et CRLF entre les lignes', () => {
    const csv = coutMoisVersCsv(coutMois);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')[3]).toBe('Enfant;Mode;Libellé;Sens;Montant');
  });
});

describe('coutAnnuelVersCsv', () => {
  it('en mode réel : deux colonnes Mois / Total', () => {
    const csv = coutAnnuelVersCsv(coutAnnuelReel, null);
    expect(csv).toContain('Mois;Total');
    expect(csv).toContain('Total annuel');
    expect(csv).not.toContain('Delta');
  });

  it('en mode simulation : colonnes simulé / réel / delta', () => {
    const csv = coutAnnuelVersCsv(coutAnnuelSimule, coutAnnuelReel);
    expect(csv).toContain('Mois;Total simulé;Total réel;Delta');
    // janvier : simulé 300 € - réel 350 € = -50 €
    expect(csv).toContain('-50,00');
  });
});

describe('nomFichier*', () => {
  it('mensuel : suffixe -simulation si simulé', () => {
    expect(nomFichierCoutMois(coutMois)).toBe('cout-2026-06.csv');
    expect(nomFichierCoutMois({ ...coutMois, simule: true })).toBe(
      'cout-2026-06-simulation.csv',
    );
  });

  it('annuel : suffixe -simulation si simulé', () => {
    expect(nomFichierCoutAnnuel(coutAnnuelReel)).toBe('couts-2026.csv');
    expect(nomFichierCoutAnnuel(coutAnnuelSimule)).toBe(
      'couts-2026-simulation.csv',
    );
  });
});

describe('telechargerCsv', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crée un lien de téléchargement et le clique', () => {
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    URL.createObjectURL = createUrl as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeUrl as typeof URL.revokeObjectURL;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    telechargerCsv('test.csv', 'a;b');

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
  });
});
