// @ts-check
/**
 * VERDICT d'un run Stryker — module PUR. Il lit le rapport JSON (schéma
 * mutation-testing-elements) et ne se fie JAMAIS au score que Stryker affiche.
 *
 * Pourquoi : quand aucun mutant n'est jugeable, Stryker calcule un score `NaN`
 * et écrit « Final mutation score of NaN is greater than or equal to break
 * threshold » — un passage silencieux. Ici, trois issues sont distinctes :
 *
 *   - `rien-a-juger` : aucun mutant jugeable (lignes sans code mutable, ou tous
 *     ignorés par une dérogation écrite dans le code). PASSE, et le dit ;
 *   - `passe` / `echoue` : score des mutants jugés, comparé au seuil ;
 *   - `erreur` : rapport absent ou illisible. ÉCHOUE — un run qui n'a pas pu
 *     juger n'est jamais un vert.
 *
 * Mutants jugés = détectés (Killed, Timeout) + non détectés (Survived,
 * NoCoverage). CompileError, RuntimeError et Ignored n'entrent pas au score,
 * comme dans la formule de Stryker.
 */

const DETECTES = new Set(['Killed', 'Timeout']);
const NON_DETECTES = new Set(['Survived', 'NoCoverage']);

/**
 * @typedef {{ fichier: string, ligne: number, mutateur: string, remplacement: string, statut: string }} Survivant
 * @typedef {{
 *   etat: 'passe' | 'echoue' | 'rien-a-juger' | 'erreur',
 *   score: number | null,
 *   detectes: number,
 *   nonDetectes: number,
 *   ignores: number,
 *   total: number,
 *   survivants: Survivant[],
 *   detail: string,
 * }} Verdict
 */

/**
 * @param {string | null} rapportBrut contenu du `mutation.json`, ou `null` si absent
 * @param {number} seuil score minimal en %, lu dans la config (`thresholds.break`)
 * @returns {Verdict}
 */
export function juger(rapportBrut, seuil) {
  const vide = {
    score: null,
    detectes: 0,
    nonDetectes: 0,
    ignores: 0,
    total: 0,
    survivants: [],
  };
  if (rapportBrut === null) {
    return {
      etat: 'erreur',
      ...vide,
      detail: 'rapport de mutation absent : Stryker n’a pas pu juger',
    };
  }
  let rapport;
  try {
    rapport = JSON.parse(rapportBrut);
  } catch {
    return { etat: 'erreur', ...vide, detail: 'rapport de mutation illisible' };
  }
  if (!rapport || typeof rapport.files !== 'object' || rapport.files === null) {
    return {
      etat: 'erreur',
      ...vide,
      detail: 'rapport de mutation sans section `files`',
    };
  }
  if (!Number.isFinite(seuil) || seuil <= 0 || seuil > 100) {
    return {
      etat: 'erreur',
      ...vide,
      detail: `seuil invalide (${seuil}) : la config ne déclare pas de \`thresholds.break\` exploitable`,
    };
  }

  let detectes = 0;
  let nonDetectes = 0;
  let ignores = 0;
  let total = 0;
  /** @type {Survivant[]} */
  const survivants = [];
  for (const [fichier, contenu] of Object.entries(rapport.files)) {
    for (const m of /** @type {any} */ (contenu).mutants ?? []) {
      total += 1;
      if (DETECTES.has(m.status)) detectes += 1;
      else if (NON_DETECTES.has(m.status)) {
        nonDetectes += 1;
        survivants.push({
          fichier,
          ligne: Number(m.location?.start?.line ?? 0),
          mutateur: String(m.mutatorName ?? '?'),
          remplacement: String(m.replacement ?? ''),
          statut: String(m.status),
        });
      } else if (m.status === 'Ignored') ignores += 1;
    }
  }
  const juges = detectes + nonDetectes;
  if (juges === 0) {
    return {
      etat: 'rien-a-juger',
      score: null,
      detectes,
      nonDetectes,
      ignores,
      total,
      survivants,
      detail:
        total === 0
          ? 'aucun mutant sur les lignes concernées'
          : `${total} mutant(s), aucun jugeable (${ignores} ignoré(s) par dérogation)`,
    };
  }
  const score = (100 * detectes) / juges;
  return {
    etat: score >= seuil ? 'passe' : 'echoue',
    score,
    detectes,
    nonDetectes,
    ignores,
    total,
    survivants,
    detail: `${detectes}/${juges} mutants détectés — ${score.toFixed(2)} % (seuil ${seuil} %)`,
  };
}
