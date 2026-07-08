import { describe, it, expect } from 'vitest';
import type { PlageHoraire } from '../types/bff';
import { classerAbsence, classerAjustement } from './etatJourGarde';

// Plage de garde de référence : 09:00 → 16:30 (forme produite par
// `plageContratJour` dans `CalendrierCreche`).
const CONTRAT = { arrivee: '09:00', depart: '16:30' };

/** Construit un `PlageHoraire` à partir de deux libellés `HH:MM`. */
function plage(debut: string, fin: string): PlageHoraire {
  const d = debut.split(':').map(Number);
  const f = fin.split(':').map(Number);
  return {
    debutHeures: d[0] ?? 0,
    debutMinutes: d[1] ?? 0,
    finHeures: f[0] ?? 0,
    finMinutes: f[1] ?? 0,
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

describe('classerAjustement', () => {
  // Plage de garde de référence : 09:00 → 16:30.
  const CONTRAT = { arrivee: '09:00', depart: '16:30' };

  it('classe une arrivée plus tôt comme « Arrivée avancée » (présence réelle)', () => {
    expect(classerAjustement(plage('08:00', '16:30'), CONTRAT)).toEqual({
      libelle: 'Arrivée avancée',
      presence: '08:00–16:30',
    });
  });

  it('classe une arrivée plus tard comme « Arrivée retardée »', () => {
    expect(classerAjustement(plage('10:00', '16:30'), CONTRAT)).toEqual({
      libelle: 'Arrivée retardée',
      presence: '10:00–16:30',
    });
  });

  it('classe un départ plus tôt comme « Départ avancé »', () => {
    expect(classerAjustement(plage('09:00', '15:00'), CONTRAT)).toEqual({
      libelle: 'Départ avancé',
      presence: '09:00–15:00',
    });
  });

  it('classe un départ plus tard comme « Départ retardé »', () => {
    expect(classerAjustement(plage('09:00', '18:00'), CONTRAT)).toEqual({
      libelle: 'Départ retardé',
      presence: '09:00–18:00',
    });
  });

  it('classe deux bornes décalées comme « Horaires ajustés »', () => {
    expect(classerAjustement(plage('08:00', '18:00'), CONTRAT)).toEqual({
      libelle: 'Horaires ajustés',
      presence: '08:00–18:00',
    });
  });

  it('restitue la présence réelle même sans plage de contrat', () => {
    expect(classerAjustement(plage('08:00', '16:30'), null)).toEqual({
      libelle: 'Horaires ajustés',
      presence: '08:00–16:30',
    });
  });
});
