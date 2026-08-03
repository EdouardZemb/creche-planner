import type { EventInput } from '@fullcalendar/core';
import { libelleAlsh } from '../notifications/besoinsSemaine';
import { evenementJour } from './evenementJour';
import {
  alshEffectifDe,
  alshExplicite,
  alshRecurrent,
  effectifActif,
  effectifJour,
  inscriptionsTemplate,
  prestationActive,
  type ContexteAbcm,
  type ModeAbcm,
} from './inscriptionsAbcm';

/** Couleurs des pastilles : celle du mode, l'ajout ponctuel, le retrait. */
export interface CouleursAbcm {
  mode: string;
  ajout: string;
  retrait: string;
}

/**
 * Pastilles du mois pour un contrat ABCM.
 *
 * `jours` est déjà restreint à la période de validité du contrat par
 * l'appelant : la dérivation ne connaît pas le contrat, seulement ce qui est
 * inscrit.
 */
export function evenementsAbcm(
  ctx: ContexteAbcm,
  mode: ModeAbcm,
  jours: readonly string[],
  couleurs: CouleursAbcm,
): EventInput[] {
  const evts: EventInput[] = [];

  if (mode === 'ALSH') {
    for (const iso of jours) {
      const eff = alshEffectifDe(ctx, iso);
      const recurrent = alshRecurrent(ctx, iso);
      if (eff) {
        // Réservé effectivement : ajout ponctuel hors récurrence → vert, sinon
        // couleur du mode (récurrence, éventuellement ajustée explicitement).
        const ajoute = !recurrent && alshExplicite(ctx, iso) !== undefined;
        const titre = libelleAlsh(eff);
        evts.push(
          evenementJour(
            `${titre}-${iso}`,
            iso,
            ajoute ? couleurs.ajout : couleurs.mode,
            titre,
          ),
        );
      } else if (recurrent) {
        // Jour récurrent retiré ponctuellement (exception `alsh:false`) → rouge.
        evts.push(
          evenementJour(`Retiré-${iso}`, iso, couleurs.retrait, 'Retiré'),
        );
      }
    }
    return evts;
  }

  for (const iso of jours) {
    const t = inscriptionsTemplate(ctx, iso);
    const eff = effectifJour(ctx, iso);
    const tActif = prestationActive(mode, t);
    if (mode === 'CANTINE') {
      if (eff.cantine && !tActif) {
        evts.push(
          evenementJour(`Ajouté-${iso}`, iso, couleurs.ajout, 'Ajouté'),
        );
      } else if (eff.cantine && tActif) {
        evts.push(
          evenementJour(`Cantine-${iso}`, iso, couleurs.mode, 'Cantine'),
        );
      } else if (!eff.cantine && tActif) {
        evts.push(
          evenementJour(`Retiré-${iso}`, iso, couleurs.retrait, 'Retiré'),
        );
      }
      continue;
    }
    // PERISCOLAIRE : le titre nomme les demi-journées effectivement réservées ;
    // la couleur signale qu'elles diffèrent de la récurrence du contrat.
    const change =
      eff.matin !== (t.periMatin ?? false) ||
      eff.soir !== (t.periSoir ?? false);
    const titre =
      eff.matin && eff.soir ? 'Matin + soir' : eff.matin ? 'Matin' : 'Soir';
    if (eff.matin || eff.soir) {
      evts.push(
        evenementJour(
          `${titre}-${iso}`,
          iso,
          change ? couleurs.ajout : couleurs.mode,
          titre,
        ),
      );
    } else if (tActif) {
      evts.push(
        evenementJour(`Retiré-${iso}`, iso, couleurs.retrait, 'Retiré'),
      );
    }
  }
  return evts;
}

/**
 * Écart NET de jours vs le contrat sur la période affichée : jours rendus
 * actifs par une saisie du mois, moins jours du contrat neutralisés.
 */
export function ecartJoursAbcm(
  ctx: ContexteAbcm,
  mode: ModeAbcm,
  jours: readonly string[],
): number {
  let ajoutes = 0;
  let retires = 0;
  for (const iso of jours) {
    const contrat =
      mode === 'ALSH'
        ? alshRecurrent(ctx, iso) !== undefined
        : prestationActive(mode, inscriptionsTemplate(ctx, iso));
    const effectif =
      mode === 'ALSH'
        ? alshEffectifDe(ctx, iso) !== null
        : effectifActif(mode, effectifJour(ctx, iso));
    if (effectif && !contrat) ajoutes += 1;
    if (!effectif && contrat) retires += 1;
  }
  return ajoutes - retires;
}
