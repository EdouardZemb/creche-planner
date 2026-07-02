import '@testing-library/jest-dom';
import { beforeEach } from 'vitest';

// Le cache de useAsync est module-level (partagé entre montages) : purgé avant
// chaque test pour qu'une valeur mise en cache par un test ne soit pas servie
// au suivant (dont les mocks API diffèrent). Import DYNAMIQUE obligatoire : un
// import statique ici chargerait `api/client` (via utils/erreurs) AVANT les
// `vi.mock` des fichiers de test, figeant la classe ApiError réelle dans le
// graphe de modules et cassant les `instanceof` face aux ApiError mockées.
beforeEach(async () => {
  const { viderCacheAsync } = await import('./hooks/useAsync');
  viderCacheAsync();
});
