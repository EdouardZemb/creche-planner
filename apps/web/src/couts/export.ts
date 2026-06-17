// Export du récap de coût en CSV — sans dépendance npm. On génère le texte
// nous-mêmes (cf. décisions Phase 7 « faits main »), puis téléchargement via
// Blob + lien temporaire. L'export PDF se fait par window.print() sur une
// feuille de style @media print (voir styles.css) : pas de lib jsPDF.

import type { CoutMoisVue, CoutAnnuelVue } from '../types/bff';
import { centimesEnEuros, deltaEnEuros } from '../utils/money';
import { formaterMoisFr } from '../utils/dates';

const SEPARATEUR = ';'; // fr-FR : Excel attend le point-virgule (la virgule = décimale).

/** Échappe une valeur CSV (guillemets si elle contient séparateur, guillemet ou saut de ligne). */
function champCsv(valeur: string): string {
  if (
    valeur.includes(SEPARATEUR) ||
    valeur.includes('"') ||
    valeur.includes('\n') ||
    valeur.includes('\r')
  ) {
    return `"${valeur.replace(/"/g, '""')}"`;
  }
  return valeur;
}

/** Assemble des lignes (tableaux de cellules) en texte CSV. */
function assemblerCsv(lignes: string[][]): string {
  return lignes
    .map((cellules) => cellules.map(champCsv).join(SEPARATEUR))
    .join('\r\n');
}

/** Montant signé d'une ligne selon son sens (débit négatif, crédit positif). */
function montantSigne(sens: 'debit' | 'credit', centimes: number): string {
  return sens === 'debit'
    ? `-${centimesEnEuros(centimes)}`
    : `+${centimesEnEuros(centimes)}`;
}

/** CSV du coût d'un mois : une ligne par ligne de prestation + récapitulatif. */
export function coutMoisVersCsv(cout: CoutMoisVue): string {
  const lignes: string[][] = [];
  lignes.push(['Mois', formaterMoisFr(cout.mois)]);
  lignes.push(['Type', cout.simule ? 'Simulation' : 'Réel']);
  lignes.push([]);
  lignes.push(['Enfant', 'Mode', 'Libellé', 'Sens', 'Montant']);

  for (const p of cout.prestations) {
    for (const l of p.lignes) {
      lignes.push([
        p.enfant,
        p.mode,
        l.libelle,
        l.sens === 'debit' ? 'Débit' : 'Crédit',
        montantSigne(l.sens, l.montantCentimes),
      ]);
    }
    lignes.push([
      p.enfant,
      p.mode,
      'Sous-total',
      '',
      centimesEnEuros(p.totalCentimes),
    ]);
  }

  if (cout.lignes.length > 0) {
    lignes.push([]);
    lignes.push(['Récapitulatif', '', '', '', '']);
    for (const l of cout.lignes) {
      lignes.push([
        '',
        '',
        l.libelle,
        l.sens === 'debit' ? 'Débit' : 'Crédit',
        montantSigne(l.sens, l.montantCentimes),
      ]);
    }
  }

  lignes.push([]);
  lignes.push([
    'Total du mois',
    '',
    '',
    '',
    centimesEnEuros(cout.totalCentimes),
  ]);

  return assemblerCsv(lignes);
}

/** CSV du coût annuel : une ligne par mois (+ colonnes réel/delta si simulation). */
export function coutAnnuelVersCsv(
  simule: CoutAnnuelVue,
  reel: CoutAnnuelVue | null,
): string {
  const estSimule = simule.simule;
  const lignes: string[][] = [];
  lignes.push(['Année', String(simule.annee)]);
  lignes.push(['Type', estSimule ? 'Simulation' : 'Réel']);
  lignes.push([]);

  const entete = estSimule
    ? ['Mois', 'Total simulé', 'Total réel', 'Delta']
    : ['Mois', 'Total'];
  lignes.push(entete);

  for (const m of simule.mois) {
    if (estSimule) {
      const moisReel = reel?.mois.find((r) => r.mois === m.mois) ?? null;
      const totalReel = moisReel !== null ? moisReel.totalCentimes : null;
      const delta = totalReel !== null ? m.totalCentimes - totalReel : null;
      lignes.push([
        formaterMoisFr(m.mois),
        centimesEnEuros(m.totalCentimes),
        totalReel !== null ? centimesEnEuros(totalReel) : '—',
        delta !== null ? deltaEnEuros(delta) : '—',
      ]);
    } else {
      lignes.push([formaterMoisFr(m.mois), centimesEnEuros(m.totalCentimes)]);
    }
  }

  lignes.push([]);
  if (estSimule) {
    const totalReel = reel !== null ? reel.totalCentimes : null;
    const delta = totalReel !== null ? simule.totalCentimes - totalReel : null;
    lignes.push([
      'Total annuel',
      centimesEnEuros(simule.totalCentimes),
      totalReel !== null ? centimesEnEuros(totalReel) : '—',
      delta !== null ? deltaEnEuros(delta) : '—',
    ]);
  } else {
    lignes.push(['Total annuel', centimesEnEuros(simule.totalCentimes)]);
  }

  return assemblerCsv(lignes);
}

/** Nom de fichier d'export pour un coût mensuel. */
export function nomFichierCoutMois(cout: CoutMoisVue): string {
  const suffixe = cout.simule ? '-simulation' : '';
  return `cout-${cout.mois}${suffixe}.csv`;
}

/** Nom de fichier d'export pour un coût annuel. */
export function nomFichierCoutAnnuel(cout: CoutAnnuelVue): string {
  const suffixe = cout.simule ? '-simulation' : '';
  return `couts-${cout.annee}${suffixe}.csv`;
}

/**
 * Déclenche le téléchargement d'un CSV. Préfixe BOM UTF-8 pour qu'Excel
 * affiche correctement les accents. Sans effet si l'environnement n'a pas de
 * DOM (no-op défensif, ex. SSR).
 */
export function telechargerCsv(nomFichier: string, contenu: string): void {
  if (
    typeof document === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return;
  }
  const blob = new Blob(['﻿', contenu], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomFichier;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
