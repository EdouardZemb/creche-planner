import type {
  ExceptionAbcm,
  InscriptionsJour,
  JourAlshHebdo,
  SemaineAbcm,
} from '../types/bff';
import { jourSemaineDeIso } from '../utils/dates';
import { alshEffectif } from '../notifications/besoinsSemaine';

/** Mode ABCM d'un contrat — les trois que sert `CalendrierAbcm`. */
export type ModeAbcm = 'CANTINE' | 'PERISCOLAIRE' | 'ALSH';

/** État explicite d'une journée ALSH saisie pour une date précise. */
export interface EtatAlsh {
  date: string;
  type: 'COMPLETE' | 'DEMI';
  repas: boolean;
}

/** Inscriptions EFFECTIVES d'un jour (matin/soir/cantine), exception appliquée. */
export interface Effectif {
  cantine: boolean;
  matin: boolean;
  soir: boolean;
}

/**
 * Tout ce dont dépend la lecture d'un jour ABCM : la récurrence du contrat et
 * les deux couches de saisie du mois. Regroupé en UN objet parce que les six
 * dérivations ci-dessous s'appellent entre elles — les passer une par une
 * multipliait les `useCallback` et leurs listes de dépendances dans le
 * composant, sans rien apporter.
 */
export interface ContexteAbcm {
  readonly semaine: SemaineAbcm;
  readonly exceptions: readonly ExceptionAbcm[];
  readonly joursAlsh: readonly EtatAlsh[];
}

/** Inscriptions RÉCURRENTES du jour de semaine correspondant à cette date. */
export function inscriptionsTemplate(
  ctx: ContexteAbcm,
  iso: string,
): InscriptionsJour {
  return ctx.semaine[jourSemaineDeIso(iso)] ?? {};
}

/** Ajustement ponctuel saisi pour cette date, s'il y en a un. */
export function exceptionDe(
  ctx: ContexteAbcm,
  iso: string,
): ExceptionAbcm | undefined {
  return ctx.exceptions.find((e) => e.date === iso);
}

/** Inscriptions effectives : l'exception du jour prime sur la récurrence. */
export function effectifJour(ctx: ContexteAbcm, iso: string): Effectif {
  const t = inscriptionsTemplate(ctx, iso);
  const e = exceptionDe(ctx, iso);
  return {
    cantine: e?.cantine ?? t.cantine ?? false,
    matin: e?.periMatin ?? t.periMatin ?? false,
    soir: e?.periSoir ?? t.periSoir ?? false,
  };
}

/** Journée ALSH saisie EXPLICITEMENT pour cette date, à la forme récurrente. */
export function alshExplicite(
  ctx: ContexteAbcm,
  iso: string,
): JourAlshHebdo | undefined {
  const j = ctx.joursAlsh.find((x) => x.date === iso);
  return j ? { type: j.type, repas: j.repas } : undefined;
}

/**
 * Journée ALSH EFFECTIVE (explicite > exception > récurrence), `null` si le
 * jour n'est pas réservé — même sémantique que `dashboard/jourFoyer.ts`.
 */
export function alshEffectifDe(
  ctx: ContexteAbcm,
  iso: string,
): JourAlshHebdo | null {
  return alshEffectif(
    iso,
    alshExplicite(ctx, iso),
    exceptionDe(ctx, iso),
    ctx.semaine,
  );
}

/** Récurrence ALSH brute de ce jour de semaine (ni exception, ni explicite). */
export function alshRecurrent(
  ctx: ContexteAbcm,
  iso: string,
): JourAlshHebdo | undefined {
  return inscriptionsTemplate(ctx, iso).alsh;
}

/** Vrai si la prestation du mode est active ce jour, selon ces inscriptions. */
export function prestationActive(
  mode: ModeAbcm,
  inscriptions: Pick<InscriptionsJour, 'cantine' | 'periMatin' | 'periSoir'>,
): boolean {
  return mode === 'CANTINE'
    ? (inscriptions.cantine ?? false)
    : (inscriptions.periMatin ?? false) || (inscriptions.periSoir ?? false);
}

/** Idem pour un effectif déjà résolu (mêmes champs, autres noms). */
export function effectifActif(mode: ModeAbcm, eff: Effectif): boolean {
  return mode === 'CANTINE' ? eff.cantine : eff.matin || eff.soir;
}

/**
 * Exception à STOCKER pour une date, ou `null` si le choix redevient conforme
 * à la récurrence — auquel cas l'ajustement doit disparaître plutôt que d'être
 * mémorisé à l'identique du contrat.
 */
export function exceptionPourDate(
  ctx: ContexteAbcm,
  mode: ModeAbcm,
  iso: string,
  choix: Effectif,
): ExceptionAbcm | null {
  const t = inscriptionsTemplate(ctx, iso);
  const exc: ExceptionAbcm = { date: iso };
  let differe = false;
  if (mode === 'CANTINE') {
    if (choix.cantine !== (t.cantine ?? false)) {
      exc.cantine = choix.cantine;
      differe = true;
    }
  } else {
    if (choix.matin !== (t.periMatin ?? false)) {
      exc.periMatin = choix.matin;
      differe = true;
    }
    if (choix.soir !== (t.periSoir ?? false)) {
      exc.periSoir = choix.soir;
      differe = true;
    }
  }
  return differe ? exc : null;
}
