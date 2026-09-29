// @ts-check
/**
 * Écriture SÛRE de données distantes dans du Markdown rendu par GitHub.
 *
 * Même doctrine que `veille-alertes.mjs` (voir son `assainir()`), avec deux
 * risques de plus, propres à une ISSUE — là où un résumé de run n'est lu que
 * par qui l'ouvre, une issue NOTIFIE :
 *
 *   - `@quelquun` y est une MENTION : un nom de paquet comme `@nx/js` écrit
 *     tel quel notifierait un compte GitHub `nx` à chaque mise à jour ;
 *   - `propriétaire/dépôt#12` y crée un RENVOI visible dans un dépôt tiers.
 *
 * Les valeurs concernées (noms de paquets, résumés d'avis, titres de PR, notes
 * de version) viennent de l'écosystème public : elles ne sont pas de notre
 * ressort, elles passent toutes par ici.
 */

const JOINT = '⁠'; // WORD JOINER : invisible, casse la mention et l'autolien

/**
 * Texte libre : contrôles retirés, Markdown/HTML échappé, mentions, renvois et
 * autoliens neutralisés, longueur bornée AVANT échappement (pour ne jamais
 * couper une séquence d'échappement en deux).
 *
 * @param {unknown} brut
 * @param {number} longueurMax
 */
export function assainir(brut, longueurMax = 200) {
  return (
    String(brut ?? '')
      .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim()
      .slice(0, longueurMax)
      .replace(/[\\`*_[\]()<>|#~!]/g, (c) => `\\${c}`)
      // Mentions et renvois sont résolus par GitHub sur le texte RENDU, après
      // que Markdown a consommé les barres obliques : `\@` et `\#` ne suffisent
      // pas, seul un caractère intercalé casse le motif.
      .replace(/@/g, `@${JOINT}`)
      .replace(/#/g, `#${JOINT}`)
      .replace(/:\/\//g, `:/${JOINT}/`)
      .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}${JOINT}.`)
  );
}

/**
 * Identifiant technique (nom de paquet, nom de contrôle) rendu en code : ni
 * mention, ni Markdown, ni lien à l'intérieur d'un code span. Les accents
 * graves sont retirés pour qu'il ne puisse pas refermer le span.
 *
 * @param {unknown} brut
 * @param {number} longueurMax
 */
export function code(brut, longueurMax = 120) {
  const propre = String(brut ?? '')
    .replace(/[\p{Cc}\p{Cf}`]+/gu, '')
    .trim()
    .slice(0, longueurMax);
  return propre === '' ? '`?`' : `\`${propre}\``;
}

/**
 * N'accepte qu'une URL GitHub https, sinon chaîne vide.
 * @param {unknown} brut
 */
export function lienGitHub(brut) {
  const url = String(brut ?? '');
  return /^https:\/\/github\.com\/[\w\-./#?=&%]*$/.test(url) ? url : '';
}

/**
 * `[libellé](url)` si l'URL est une URL GitHub, sinon le libellé seul.
 * Le libellé est de NOTRE fabrication (jamais une donnée distante brute).
 *
 * @param {string} libelle
 * @param {unknown} url
 */
export function lien(libelle, url) {
  const u = lienGitHub(url);
  return u ? `[${libelle}](${u})` : libelle;
}
