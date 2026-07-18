/**
 * Ligne discrète « {texte} · Recharger » (chantier Confiance, lot B2) : ce
 * qu'un bloc SECONDAIRE du dashboard affiche quand son chargement a échoué, à
 * la place de l'ancienne disparition silencieuse. Calquée sur le motif de
 * `planning/BarreStatutCalendrier` (libellé `muted` + bouton `btn secondaire`
 * dans un conteneur flex).
 *
 * `role="status"` (et NON `role="alert"`) : l'a11y du dashboard réserve les
 * alertes à la journée principale ; un bloc secondaire indisponible ne doit pas
 * interrompre le lecteur d'écran.
 */
export function LigneIndisponible({
  texte,
  onRecharger,
}: {
  texte: string;
  onRecharger: () => void;
}) {
  return (
    <div role="status" className="ligne-indisponible">
      <span className="muted">{texte}</span>
      <button type="button" className="btn secondaire" onClick={onRecharger}>
        Recharger
      </button>
    </div>
  );
}
