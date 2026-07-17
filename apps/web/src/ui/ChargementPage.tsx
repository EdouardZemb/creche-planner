/**
 * État de chargement de **niveau écran** : une roue (décorative) surmontant un texte
 * visible, le tout dans un conteneur `role="status" aria-live="polite"` — l'attente
 * est donc annoncée **une** fois aux lecteurs d'écran. À utiliser quand « la page
 * charge » ; pour un petit bloc partiel dans une page déjà rendue, préférer un loader
 * inline.
 */
export function ChargementPage({ message }: { message: string }) {
  return (
    <div className="chargement-page" role="status" aria-live="polite">
      <span className="spinner-roue" aria-hidden="true" />
      <p className="muted">{message}</p>
    </div>
  );
}
