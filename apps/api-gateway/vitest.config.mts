import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/api-gateway',
  test: {
    name: 'api-gateway',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Fichiers SÉRIALISÉS en CI (parallélisme conservé en local). Les specs
    // pact (`src/contract/*.pact.spec.ts`) démarrent un mock server natif
    // (pact-core/tokio) par `executeTest` ; sur le runner GitHub 2 cœurs,
    // plusieurs forks vitest + leurs mock servers saturent le CPU et ouvrent
    // une course interne à pact-core : la requête est reçue ET matchée par le
    // mock server (logs hyper_server), la réponse 200 conforme revient au
    // test, mais `mockServerMismatches()` — interrogé juste après le callback
    // — répond « request expected but not received » (run 30480333256,
    // tentatives 1 et 2, sur un spec différent à chaque fois). Un seul fork
    // actif ⇒ le worker tokio n'est plus affamé ⇒ la fenêtre se referme.
    // Filet complémentaire : `retry: 1` sur les describes des specs pact.
    fileParallelism: !process.env['CI'],
    reporters: process.env['CI']
      ? [
          'default',
          ['junit', { outputFile: './test-output/vitest/junit.xml' }] as [
            'junit',
            { outputFile: string },
          ],
        ]
      : ['default'],
    coverage: {
      // Couverture mesurée + seuils RATCHET (niveau constaté arrondi à l'entier
      // inférieur, jamais abaissé — doc 03 §6). Le 100 % ne vise que les libs
      // domaine ; ici on empêche toute régression silencieuse (AQ-06).
      enabled: true,
      provider: 'v8' as const,
      reportsDirectory: './test-output/vitest/coverage',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      // `include` explicite : depuis Vitest 3, seuls les fichiers listés ici
      // sont rapportés même s'ils ne sont jamais chargés par un test.
      include: ['src/**/*.ts'],
      // Bootstrap process (main/tracing) : exécutés au boot du conteneur,
      // couverts par smoke-stack, non testables unitairement.
      // `app.module.ts` = racine de composition DI (pur câblage NestJS,
      // couvert par smoke-stack/e2e), non testable unitairement — même
      // catégorie que main.ts/tracing.ts (fondations lot 3).
      exclude: [
        'src/main.ts',
        'src/tracing.ts',
        'src/app.module.ts',
        '**/*.spec.ts',
      ],
      // Ratchet relevé au lot 3 « fondations » (marge ~2 pts sous le plancher
      // atteint : stmts 59,7 / br 66,9 / fn 49,0 / lines 59,3 après ajout des
      // tests d'assertion propagée — `entetesAval`, interceptor, config — et
      // exclusion d'app.module de la couverture).
      // Ratchet relevé au lot 6 « fondations » (couverture des clients BFF
      // jusqu'ici à 0 % de fonctions couvertes : `planification.client.ts`,
      // `tarification.client.ts`, `notifications.client.ts` — succès, erreur
      // HTTP, timeout via `executerResilient`, assertion d'identité) — mesuré
      // 67,55 / 71,34 / 54,71 / 67,40, marge ~2 pts.
      // Ratchet relevé au lot 4 « SFD 30 » (routes versionnement BFF + client :
      // specs contrats.controller + client versions) — mesuré
      // 71,9 / 72,8 / 61,2 / 71,8, marge ~2 pts.
      // Lot D8 : le seuil n'avait plus été remonté depuis, alors que D1
      // (migration vers `libs/resilience`) puis C7 (route `erreurs-client` +
      // ses specs) ont fait monter le mesuré à 83,90 / 81,07 / 65,67 / 84,42.
      // Un seuil 15 pts sous le mesuré n'est pas neutre : il AUTORISE la
      // régression jusqu'à ce plancher, et le second filet
      // (`coverage-compare.mjs`) ne bloque qu'une baisse > 0,5 pt ENTRE DEUX
      // RUNS — une érosion lente passait entre les deux. Seuil reposé au
      // mesuré arrondi vers le bas (pas de marge : la mesure est déterministe,
      // et c'est la marge qui avait laissé le retard s'installer).
      thresholds: {
        statements: 83,
        branches: 81,
        functions: 65,
        lines: 84,
      },
    },
  },
}));
