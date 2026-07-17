import type {
  BrouillonEtablissement,
  ContratBesoinsSemaine,
  CorpsEnvoiEtablissement,
  SemaineBesoins,
} from '../types/bff';
import type { EtatJour } from '../dashboard/jourFoyer';
import { lignesDuJour } from '../dashboard/jourFoyer';
import { dateLongueFr } from '../utils/dates';
import { libelleMode } from '../utils/libelles';

// Composition PURE (aucune dépendance React, testable en isolation) du brouillon
// « semaine complète » adressé au service : à la dernière étape d'envoi, le parent
// part de ce texte pré-rempli — objet + corps en français lisible, la semaine
// ENTIÈRE (7 jours) de chaque enfant concerné, jours modifiés marqués — qu'il peut
// réécrire avant l'envoi (L8 achemine son texte exact).
//
// L'horaire/présence effectif d'un jour (base ⊕ exceptions datées) est calculé par
// le MÊME helper que le tableau de bord et le calendrier (`lignesDuJour`, couche
// pure `dashboard/jourFoyer.ts`) : la fusion base/exceptions n'est pas réinventée
// ici, garantissant que le mail dit exactement ce que le parent voit à l'écran.

export interface BrouillonSemaineParams {
  /** Les 7 dates `YYYY-MM-DD` de la semaine, lundi → dimanche (`SemaineBesoins.jours`). */
  jours: readonly string[];
  /** Contrats actifs de la semaine (avec besoins datés + base), pour retrouver chaque enfant. */
  contrats: readonly ContratBesoinsSemaine[];
  /** Brouillon serveur de l'établissement : enfants concernés + jours modifiés (delta figé). */
  brouillon: BrouillonEtablissement;
}

/**
 * Jeton d'état effectif d'un jour (couche pure `jourFoyer`) → mots de parent.
 * Miroir volontaire du `LIBELLES_ETAT` du tableau de bord : un même vocabulaire
 * d'un écran à l'autre et jusqu'au mail (« Ajusté » jargon → « Horaires modifiés »).
 */
const LIBELLES_ETAT_JOUR: Readonly<Record<EtatJour, string>> = {
  garde: 'Gardé',
  absent: 'Absent',
  'depart-avance': 'Départ avancé',
  'depart-retarde': 'Départ retardé',
  'arrivee-avancee': 'Arrivée avancée',
  'arrivee-retardee': 'Arrivée retardée',
  ajuste: 'Horaires modifiés',
  'jour-ajoute': 'Jour ajouté',
  cantine: 'Cantine',
  peri: 'Périscolaire',
  alsh: 'Centre de loisirs (ALSH)',
};

/** Liste française lisible (« Léa », « Léa et Noé », « Léa, Noé et Tom »). Natif. */
const listeFr = new Intl.ListFormat('fr', {
  style: 'long',
  type: 'conjunction',
});

/** Détail effectif d'un jour pour un contrat : « Gardé · 08:00–17:00 » ou « Pas de garde ». */
function detailJour(vueContrat: SemaineBesoins, dateIso: string): string {
  // Une seule ligne au plus (la vue ne porte qu'un contrat) : présente ⇒ le
  // parent est concerné ce jour-là, absente ⇒ jour non gardé.
  const ligne = lignesDuJour(vueContrat, dateIso)[0];
  if (ligne === undefined) {
    return 'Pas de garde';
  }
  const etat = LIBELLES_ETAT_JOUR[ligne.etat];
  return ligne.horaire !== null ? `${etat} · ${ligne.horaire}` : etat;
}

/**
 * Compose l'objet + le corps (texte brut) du brouillon « semaine complète » d'un
 * établissement : salutation, intro datée, un bloc jour-par-jour (7 jours) par
 * enfant concerné avec la présence effective de chaque jour et un suffixe
 * « (modifié) » sur les jours issus du delta, puis une clôture polie.
 */
export function composerBrouillonSemaineComplete({
  jours,
  contrats,
  brouillon,
}: BrouillonSemaineParams): CorpsEnvoiEtablissement {
  const lundi = jours[0] ?? brouillon.semaineIso;
  const dimanche = jours[jours.length - 1] ?? lundi;

  // Prénoms dédoublonnés (un même enfant peut avoir deux contrats concernés).
  const prenoms = [...new Set(brouillon.enfants.map((e) => e.enfant))];
  const prenomsFr =
    prenoms.length > 0 ? listeFr.format(prenoms) : 'votre enfant';

  const sujet = `Planning de la semaine du ${dateLongueFr(lundi)} — ${prenomsFr}`;

  const contratParId = new Map(contrats.map((c) => [c.contratId, c]));

  const blocs = brouillon.enfants.map((enfant) => {
    const contrat = contratParId.get(enfant.contratId);
    if (contrat === undefined) {
      // Cas défensif : l'enfant concerné n'a pas de contrat dans la vue semaine.
      // On ne l'écarte pas en silence — on le nomme, sans inventer un planning.
      return `${enfant.enfant} :\n- Détail du planning indisponible.`;
    }
    const modifies = new Set(enfant.deltaModifs.jours.map((j) => j.date));
    const vueContrat: SemaineBesoins = {
      semaineIso: brouillon.semaineIso,
      jours: [...jours],
      etablissements: [],
      contrats: [contrat],
    };
    const lignes = jours.map((jour) => {
      const marque = modifies.has(jour) ? ' (modifié)' : '';
      return `- ${dateLongueFr(jour)} : ${detailJour(vueContrat, jour)}${marque}`;
    });
    return [
      `${enfant.enfant} — ${libelleMode(contrat.mode)} :`,
      ...lignes,
    ].join('\n');
  });

  const corps = [
    'Bonjour,',
    '',
    `Voici le planning complet de la semaine du ${dateLongueFr(lundi)} au ${dateLongueFr(dimanche)} pour ${prenomsFr}, à jour après nos derniers changements.`,
    '',
    blocs.join('\n\n'),
    '',
    'Je reste à votre disposition pour toute question.',
    'Bien cordialement,',
  ].join('\n');

  return { sujet, corps };
}
