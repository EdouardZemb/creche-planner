# OpenAPI (REST synchrone)

Emplacement d'accueil des spécifications **OpenAPI** des API REST exposées par
la gateway et les services (`/v1`).

À ce stade (Phases 1→4), les contrats REST sont vérifiés en **consumer-driven** via
**Pact** (voir `pacts/` : api-gateway → svc-foyer, → svc-referentiel) plutôt que par
des `*.openapi.yaml` figés. Les specs OpenAPI versionnées seront déposées ici quand
la gateway/BFF publiera son API (Phase 7).
