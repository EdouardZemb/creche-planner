import { describe, it, expect } from 'vitest';
import type { PlageHoraire } from '../types/bff';
import { classerAbsence } from './etatJourGarde';

// Plage de garde de référence : 09:00 → 16:30 (forme produite par
// `plageContratJour` dans `CalendrierCreche`).
const CONTRAT = { arrivee: '09:00', depart: '16:30' };

/** Construit un `PlageHoraire` à partir de deux libellés `HH:MM`. */
function plage(debut: string, fin: string): PlageHoraire {
  const [dh, dm] = debut.split(':').map(Number);
  const [fh, fm] = fin.split(':').map(Number);
  return {
    debutHeures: dh,
    debutMinutes: dm,
    finHeures: fh,
    finMinutes: fm,
  };
}

describe('classerAbsence', () => {
  it('classe une journée complète (égalité exacte) comme « Absent »', () => {
    expect(classerAbsence(plage('09:00', '16:30'), CONTRAT)).toEqual({
      statut: 'absent',
      libelle: 'Absent',
      presence: null,
    });
  });

  it('classe une journée complète (débordement) comme « Absent »', () => {
    expect(classerAbsence(plage('08:00', '17:00'), CONTRAT)).toEqual({
      statut: 'absent',
      libelle: 'Absent',
      presence: null,
    });
  });

  it('classe une absence en fin de journée comme « Départ avancé »', () => {
    expect(classerAbsence(plage('15:00', '16:30'), CONTRAT)).toEqual({
      statut: 'ajuste',
      libelle: 'Départ avancé',
      presence: '09:00–15:00',
    });
  });

  it('classe une absence en début de journée comme « Arrivée retardée »', () => {
    expect(classerAbsence(plage('09:00', '10:30'), CONTRAT)).toEqual({
      statut: 'ajuste',
      libelle: 'Arrivée retardée',
      presence: '10:30–16:30',
    });
  });

  it('classe une fenêtre intérieure comme « Ajusté » sans présence', () => {
    expect(classerAbsence(plage('11:00', '13:00'), CONTRAT)).toEqual({
      statut: 'ajuste',
      libelle: 'Ajusté',
      presence: null,
    });
  });

  it('traite une plage de contrat absente comme « Ajusté » sans présence', () => {
    expect(classerAbsence(plage('09:00', '16:30'), null)).toEqual({
      statut: 'ajuste',
      libelle: 'Ajusté',
      presence: null,
    });
  });
});
