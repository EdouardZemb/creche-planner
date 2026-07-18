import { describe, it, expect } from 'vitest';
import type { PreavisRegle } from '../types/bff';
import { delaiPreavis } from './delaiPreavis';

// Semaine de référence : 2026-W28 = lundi 06/07 → dimanche 12/07/2026 (cf.
// `libelleSemaine` : « semaine du 6 au 12 juillet »). La date limite d'un préavis
// « jeudi » de cette semaine tombe donc le jeudi de la semaine PRÉCÉDENTE (02/07).
const W28 = '2026-W28';

// Règles construites via un contexte typé pour figer les littéraux de l'union.
const JEUDI_12H: PreavisRegle = {
  type: 'JOUR_HEURE',
  jour: 'JEUDI',
  heure: '12:00',
};

describe('delaiPreavis', () => {
  it("retourne null quand il n'y a aucune règle", () => {
    expect(delaiPreavis(null, W28)).toBeNull();
    expect(delaiPreavis(null, W28, '2026-07-01')).toBeNull();
  });

  describe('JOUR_HEURE', () => {
    it('cible le jour dans la semaine précédant le lundi cible', () => {
      expect(delaiPreavis(JEUDI_12H, W28)).toEqual({
        texte: 'À valider avant jeudi 12:00 (le 02/07)',
        dateLimite: '2026-07-02',
        depasse: false,
      });
    });

    it("gère le lundi (reculer d'une semaine entière)", () => {
      const regle: PreavisRegle = {
        type: 'JOUR_HEURE',
        jour: 'LUNDI',
        heure: '09:30',
      };
      expect(delaiPreavis(regle, W28)).toEqual({
        texte: 'À valider avant lundi 09:30 (le 29/06)',
        dateLimite: '2026-06-29',
        depasse: false,
      });
    });

    it('gère le dimanche (veille du lundi cible)', () => {
      const regle: PreavisRegle = {
        type: 'JOUR_HEURE',
        jour: 'DIMANCHE',
        heure: '18:00',
      };
      expect(delaiPreavis(regle, W28)).toEqual({
        texte: 'À valider avant dimanche 18:00 (le 05/07)',
        dateLimite: '2026-07-05',
        depasse: false,
      });
    });
  });

  describe('JOURS_OUVRES', () => {
    it('valeur 0 → le lundi cible, texte « début de la semaine »', () => {
      expect(delaiPreavis({ type: 'JOURS_OUVRES', valeur: 0 }, W28)).toEqual({
        texte: 'À valider avant le début de la semaine',
        dateLimite: '2026-07-06',
        depasse: false,
      });
    });

    it('valeur 1 → le vendredi ouvré précédant le lundi cible', () => {
      expect(delaiPreavis({ type: 'JOURS_OUVRES', valeur: 1 }, W28)).toEqual({
        texte:
          "À valider au moins 1 jour(s) ouvré(s) à l'avance (avant le 03/07)",
        dateLimite: '2026-07-03',
        depasse: false,
      });
    });

    it('valeur 2 → le jeudi ouvré (saute samedi/dimanche)', () => {
      expect(delaiPreavis({ type: 'JOURS_OUVRES', valeur: 2 }, W28)).toEqual({
        texte:
          "À valider au moins 2 jour(s) ouvré(s) à l'avance (avant le 02/07)",
        dateLimite: '2026-07-02',
        depasse: false,
      });
    });

    it('valeur 5 → le lundi ouvré précédent (une semaine ouvrée)', () => {
      expect(delaiPreavis({ type: 'JOURS_OUVRES', valeur: 5 }, W28)).toEqual({
        texte:
          "À valider au moins 5 jour(s) ouvré(s) à l'avance (avant le 29/06)",
        dateLimite: '2026-06-29',
        depasse: false,
      });
    });
  });

  describe('depasse', () => {
    it('est faux sans « aujourdhui »', () => {
      const r = delaiPreavis({ type: 'JOURS_OUVRES', valeur: 0 }, W28);
      expect(r?.depasse).toBe(false);
    });

    it('est vrai quand la date limite est strictement passée, et préfixe le texte', () => {
      const r = delaiPreavis(JEUDI_12H, W28, '2026-07-05'); // après le 02/07
      expect(r?.depasse).toBe(true);
      expect(r?.texte).toBe(
        'Délai peut-être dépassé — prévenez la crèche au plus vite. À valider avant jeudi 12:00 (le 02/07)',
      );
      expect(r?.dateLimite).toBe('2026-07-02');
    });

    it('est faux quand « aujourdhui » égale la date limite (borne stricte)', () => {
      const r = delaiPreavis(JEUDI_12H, W28, '2026-07-02');
      expect(r?.depasse).toBe(false);
      expect(r?.texte).toBe('À valider avant jeudi 12:00 (le 02/07)');
    });

    it('est faux quand « aujourdhui » précède la date limite', () => {
      const r = delaiPreavis(JEUDI_12H, W28, '2026-07-01');
      expect(r?.depasse).toBe(false);
    });
  });

  describe('passage de semaine (le lundi cible suit la semaine)', () => {
    it("décale la date limite d'une semaine entre W28 et W29", () => {
      expect(
        delaiPreavis({ type: 'JOURS_OUVRES', valeur: 0 }, '2026-W28')
          ?.dateLimite,
      ).toBe('2026-07-06');
      expect(
        delaiPreavis({ type: 'JOURS_OUVRES', valeur: 0 }, '2026-W29')
          ?.dateLimite,
      ).toBe('2026-07-13');
    });

    it("recule correctement par-dessus la frontière d'année (W02 → décembre)", () => {
      // 2026-W02 : lundi cible 05/01/2026 ; le lundi de la semaine précédente est le
      // 29/12/2025 (l'arithmétique de veille traverse le 1er janvier).
      const regle: PreavisRegle = {
        type: 'JOUR_HEURE',
        jour: 'LUNDI',
        heure: '08:00',
      };
      expect(delaiPreavis(regle, '2026-W02')?.dateLimite).toBe('2025-12-29');
    });
  });
});
