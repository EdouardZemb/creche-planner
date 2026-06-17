export interface SpinnerProps {
  /** Texte annoncé aux lecteurs d'écran (défaut « Chargement… »). */
  label?: string;
}

/** Indicateur de chargement accessible (`role="status"` + `aria-live`). */
export function Spinner({ label = 'Chargement…' }: SpinnerProps) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span className="spinner-roue" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
