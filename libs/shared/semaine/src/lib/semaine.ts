/**
 * Mapping pur **semaine ISO ↔ mois / jours**. Le planning amont
 * (`svc-planification`) est stocké **par mois** (`planning_mois`, JSONB) ; la
 * validation hebdomadaire (`svc-notifications`) et l'édition hebdomadaire (BFF
 * gateway, `svc-planification`) raisonnent en **semaine ISO 8601** (`YYYY-Www`). Ce
 * module fait le pont — sans dépendance ni effet de bord, donc testable par
 * propriétés (`semaine.mbt.spec.ts`) : il convertit une semaine en ses 7 jours
 * calendaires (lundi→dimanche) et en l'ensemble des **mois** qu'elle recouvre (1,
 * ou **2** quand la semaine est à cheval sur deux mois — le cas qui justifie ce
 * module).
 *
 * Toute l'arithmétique se fait en **UTC** : on ne manipule que des dates
 * calendaires (`YYYY-MM-DD`), jamais d'instants — l'heure locale du serveur ne doit
 * pas décaler un jour. Le fuseau `Europe/Paris` du déclencheur du mardi (Lot 5) ne
 * concerne que le *choix* de la semaine, pas ce découpage calendaire.
 */

const SEMAINE_ISO = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

/** Composantes d'une semaine ISO (`2026-W27` → `{ annee: 2026, semaine: 27 }`). */
export interface SemaineIso {
  readonly annee: number;
  readonly semaine: number;
}

/** Parse une semaine ISO `YYYY-Www` (lève si la forme est invalide). */
export function parseSemaineIso(valeur: string): SemaineIso {
  const m = SEMAINE_ISO.exec(valeur);
  if (!m) {
    throw new Error(`semaine ISO invalide (attendu YYYY-Www) : ${valeur}`);
  }
  return { annee: Number(m[1]), semaine: Number(m[2]) };
}

/** Vrai si la chaîne est une semaine ISO `YYYY-Www` bien formée. */
export function estSemaineIso(valeur: string): boolean {
  return SEMAINE_ISO.test(valeur);
}

/** Indice de jour ISO (0 = lundi … 6 = dimanche) d'une date UTC. */
function jourIsoUtc(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/** Date UTC du **lundi** de la semaine ISO (annee, semaine). */
function lundiUtc(annee: number, semaine: number): Date {
  // Le 4 janvier appartient toujours à la semaine ISO 1 (définition ISO 8601).
  const jan4 = new Date(Date.UTC(annee, 0, 4));
  const lundiSemaine1 = new Date(jan4);
  lundiSemaine1.setUTCDate(jan4.getUTCDate() - jourIsoUtc(jan4));
  const lundi = new Date(lundiSemaine1);
  lundi.setUTCDate(lundiSemaine1.getUTCDate() + (semaine - 1) * 7);
  return lundi;
}

/** Formate une date UTC en `YYYY-MM-DD`. */
function formaterJour(d: Date): string {
  const annee = String(d.getUTCFullYear()).padStart(4, '0');
  const mois = String(d.getUTCMonth() + 1).padStart(2, '0');
  const jour = String(d.getUTCDate()).padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

/**
 * Les 7 jours calendaires (`YYYY-MM-DD`) d'une semaine ISO, **lundi → dimanche**.
 */
export function joursDeLaSemaine(semaineIso: string): string[] {
  const { annee, semaine } = parseSemaineIso(semaineIso);
  const lundi = lundiUtc(annee, semaine);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lundi);
    d.setUTCDate(lundi.getUTCDate() + i);
    return formaterJour(d);
  });
}

/**
 * Les mois `YYYY-MM` recouverts par la semaine, **triés et dédupliqués** (1 ou 2).
 * C'est l'ensemble des mois à relire côté `svc-planification` pour reconstituer la
 * semaine quand elle chevauche une frontière de mois.
 */
export function moisDeLaSemaine(semaineIso: string): string[] {
  const mois = new Set<string>();
  for (const jour of joursDeLaSemaine(semaineIso)) {
    mois.add(jour.slice(0, 7));
  }
  return [...mois].sort();
}

/**
 * Semaine ISO (`YYYY-Www`) **contenant** une date calendaire `YYYY-MM-DD`. L'année
 * ISO est celle du **jeudi** de la semaine (règle ISO 8601 : une semaine appartient
 * à l'année de son jeudi). Inverse de `joursDeLaSemaine`. Utile au déclencheur du
 * mardi (Lot 5) et aux tests de round-trip.
 */
export function semaineIsoDeDate(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`date invalide (attendu YYYY-MM-DD) : ${dateIso}`);
  }
  const jeudi = new Date(d);
  jeudi.setUTCDate(d.getUTCDate() - jourIsoUtc(d) + 3);
  const annee = jeudi.getUTCFullYear();
  const jan1 = new Date(Date.UTC(annee, 0, 1));
  const semaine =
    Math.floor((jeudi.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1;
  return `${String(annee)}-W${String(semaine).padStart(2, '0')}`;
}
