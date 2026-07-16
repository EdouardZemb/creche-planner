/**
 * Convertit un **texte brut** (édité par le parent avant l'envoi au service) en un
 * fragment HTML **sûr** pour le corps de l'e-mail. Fonction **pure** (aucune I/O) :
 *
 * 1. échappe les caractères dangereux (`& < > " '`) pour qu'aucune balise ou entité
 *    fournie par le client ne soit interprétée par le client mail — pas d'injection ;
 * 2. convertit les retours à la ligne (`\r\n`, `\r`, `\n`) en `<br />` afin que la mise
 *    en forme visuelle du parent soit préservée ;
 * 3. enveloppe le tout dans un conteneur HTML **minimal** (`<div>`).
 *
 * On **n'accepte jamais** de HTML libre du client : le corps édité est traité comme du
 * texte, échappé ici, puis figé/envoyé. C'est ce fragment (et non le texte brut) qui
 * part réellement et qui est journalisé dans `envoi_etablissement.corps`.
 */
export function echapperEnHtml(texte: string): string {
  const echappe = texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const avecSauts = echappe
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '<br />\n');
  return `<div>${avecSauts}</div>`;
}
