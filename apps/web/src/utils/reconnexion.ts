// Sortie de l'état « session Access expirée » (PWA). Le service worker
// (Workbox, navigateFallback) sert la coquille depuis le cache pour TOUTE
// navigation : un simple reload ne passe jamais par le réseau et ne déclenche
// donc pas la redirection de connexion Cloudflare Access. On désenregistre
// d'abord le SW — une page déjà contrôlée le reste, mais la navigation
// suivante (le reload) part alors réellement sur le réseau, où l'edge
// Cloudflare redirige vers la page de connexion puis revient sur l'app, qui
// réenregistre son SW au chargement. En dev/LAN (pas d'Access, voire pas de
// SW), cela dégénère en un rechargement ordinaire.

type ConteneurSW = Pick<ServiceWorkerContainer, 'getRegistrations'>;

export async function seReconnecter(
  sw: ConteneurSW | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.serviceWorker,
  recharger: () => void = () => window.location.reload(),
): Promise<void> {
  if (sw) {
    try {
      const enregistrements = await sw.getRegistrations();
      await Promise.all(enregistrements.map((r) => r.unregister()));
    } catch {
      // Désenregistrement impossible (SW indisponible…) : on recharge quand
      // même — au pire le comportement actuel, au mieux le réseau répond.
    }
  }
  recharger();
}
