import { Link } from 'react-router-dom';

/**
 * Pied de page : accès **permanent** aux informations sur les données
 * (`/mentions`), depuis n'importe quel écran.
 *
 * Son emplacement n'est pas un choix esthétique — deux contraintes vérifiées du
 * dépôt le déterminent :
 *
 * 1. **Pas dans la `<nav>` de l'en-tête.** Tout son contenu y est conditionnel
 *    (`id`, `moi.loading`, `moi.email`, `peutCreerFoyer`) : tant que `/moi` n'a
 *    pas répondu, la nav est littéralement VIDE — un lien posé là disparaîtrait
 *    à chaque chargement de page, donc ne serait pas permanent.
 * 2. **Pas en frère de `<main>`.** Sous 768 px, `.nav-onglets` est une barre
 *    FIXE en bas de l'écran, et c'est `main#contenu` qui porte le
 *    `padding-bottom` qui la compense (`styles.css`). Un pied posé après
 *    `</main>` passerait donc SOUS la barre à 375 px.
 *
 * D'où : rendu **dans** `<main id="contenu">`, en dernier enfant — il hérite de
 * la compensation existante, sans la dupliquer. Il est en revanche placé HORS de
 * la frontière d'erreur de route : une page qui plante laisse le lien joignable.
 *
 * Note a11y : un `<footer>` descendant de `<main>` ne prend PAS le rôle
 * `contentinfo` (HTML-AAM) — aucun landmark de second niveau n'est créé, et le
 * repère `main` reste unique.
 */
export function PiedPage() {
  return (
    <footer className="pied-page">
      <Link to="/mentions">Informations sur vos données</Link>
    </footer>
  );
}
