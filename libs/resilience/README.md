# resilience

Briques de **résilience** partagées (circuit breaker, retry borné,
`fetchAvecTimeout`) factorisées depuis `api-gateway` et `svc-tarification`
(DEC-08). Lib d'infrastructure (`type:infrastructure`, `context:shared`) :
aucune dépendance métier, seulement `@nestjs/common` (type `Logger`).

Deux variantes d'exécution sont exposées et **doivent rester disponibles** :

- `executerResilient` : **propage** la dernière erreur (utilisé par la gateway) ;
- `executerOuRepli` : **dégradation propre**, journalise et renvoie un repli
  (utilisé par les clients de repli synchrone de la tarification).

## Building

Run `nx build resilience` to build the library.

## Running unit tests

Run `nx test resilience` to execute the unit tests via [Vitest](https://vitest.dev/).
