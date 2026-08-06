import { describe, expect, it } from 'vitest';
import { gatewayOpenApiDocument } from '../../index.js';

describe('gateway.openapi (BFF Phase 7)', () => {
  it('déclare OpenAPI 3.1.0', () => {
    expect(gatewayOpenApiDocument.openapi).toBe('3.1.0');
  });

  it('porte le titre de l’API Gateway', () => {
    expect(gatewayOpenApiDocument.info.title).toContain('API Gateway');
    expect(gatewayOpenApiDocument.info.version).toBe('1.0.0');
  });

  // ⚠️ Portée de cet oracle : il fige la liste attendue pour la rendre VISIBLE en
  // revue (tout ajout de route doit se voir dans le diff). Il ne prouve PAS que le
  // document couvre le service réel — les deux côtés y sont écrits à la main. Cette
  // preuve-là est faite par `apps/api-gateway/src/openapi/openapi.couverture.spec.ts`
  // (lot D6), qui confronte le document au graphe de modules Nest et exige l'égalité
  // dans les deux sens. C'est lui qui a montré que 12 opérations servies — dont les
  // 6 routes `/notifications/*` — n'étaient documentées nulle part.
  it('expose exactement les 38 routes attendues', () => {
    const paths = Object.keys(gatewayOpenApiDocument.paths).sort();
    expect(paths).toEqual(
      [
        '/api/health',
        '/api/health/live',
        '/api/referentiel/health',
        '/api/openapi.json',
        '/api/v1/foyers',
        '/api/v1/foyers/{id}',
        '/api/v1/foyers/{id}/versions',
        '/api/v1/foyers/{id}/enfants',
        '/api/v1/foyers/{id}/enfants/{enfantId}',
        '/api/v1/foyers/{id}/parents',
        '/api/v1/foyers/{id}/parents/{parentId}',
        '/api/v1/foyers/{foyerId}/etablissements',
        '/api/v1/foyers/{foyerId}/etablissements/{id}',
        '/api/v1/moi',
        '/api/v1/moi/profil',
        '/api/v1/moi/preferences',
        '/api/v1/moi/notifications',
        '/api/v1/moi/notifications/{id}/lu',
        '/api/v1/desabonnement',
        '/api/v1/erreurs-client',
        '/api/v1/notifications/a-valider',
        '/api/v1/notifications/envois/etablissement',
        '/api/v1/notifications/semaine/{foyerId}/{semaineIso}/besoins',
        '/api/v1/notifications/semaine/{foyerId}/{semaineIso}/envois',
        '/api/v1/notifications/semaine/{foyerId}/{semaineIso}/etablissements/{etablissementId}/brouillon',
        '/api/v1/notifications/validations/{contratId}/{semaineIso}',
        '/api/v1/contrats',
        '/api/v1/contrats/{id}',
        '/api/v1/contrats/{id}/versions',
        '/api/v1/contrats/{id}/versions/{versionId}',
        '/api/v1/contrats/{id}/versions/{versionId}/impact',
        '/api/v1/contrats/{id}/plannings/{mois}',
        '/api/v1/contrats/{id}/plannings/semaine/{semaineIso}',
        '/api/v1/couts',
        '/api/v1/couts/annuel',
        '/api/v1/referentiel/grilles',
        '/api/v1/referentiel/baremes/psu',
        '/api/v1/referentiel/baremes/tranches',
      ].sort(),
    );
  });

  it('expose la publication de grille (GET/POST /referentiel/grilles) + 409 chevauchement', () => {
    const route = gatewayOpenApiDocument.paths['/api/v1/referentiel/grilles'];
    expect(
      route.get.responses['200'].content['application/json'].schema,
    ).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/GrilleAbcmVue' },
    });
    expect(
      route.post.requestBody.content['application/json'].schema.required,
    ).toEqual(['valideDu', 'tranches']);
    expect(route.post.responses['201']).toBeDefined();
    expect(route.post.responses['409'].description).toMatch(/chevauche/i);
  });

  it('expose le profil du parent connecté + ses préférences (GET /moi/profil, PUT /moi/preferences)', () => {
    const profil = gatewayOpenApiDocument.paths['/api/v1/moi/profil'].get;
    expect(profil).toBeDefined();
    expect(profil.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/MonProfilVue',
    });
    expect(profil.responses['401']).toBeDefined();
    expect(profil.responses['404']).toBeDefined();

    const maj = gatewayOpenApiDocument.paths['/api/v1/moi/preferences'].put;
    expect(maj).toBeDefined();
    expect(maj.requestBody.content['application/json'].schema.required).toEqual(
      ['preferences'],
    );
    expect(maj.responses['200'].content['application/json'].schema).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/PreferenceVue' },
    });
    // Invariant service (≥ 1 canal actif) : le refus 400 est documenté.
    expect(maj.responses['400']).toBeDefined();
  });

  it('expose l’inbox in-app (GET /moi/notifications, POST /moi/notifications/{id}/lu)', () => {
    const inbox = gatewayOpenApiDocument.paths['/api/v1/moi/notifications'].get;
    expect(inbox).toBeDefined();
    expect(inbox.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/InboxVue',
    });
    expect(inbox.responses['401']).toBeDefined();
    expect(inbox.responses['404']).toBeDefined();

    const lu =
      gatewayOpenApiDocument.paths['/api/v1/moi/notifications/{id}/lu'].post;
    expect(lu).toBeDefined();
    expect(lu.responses['200'].content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/NotificationInApp',
    });
    expect(lu.responses['404']).toBeDefined();
  });

  it('documente le 409 create-once sur la création de foyer (POST /foyers)', () => {
    const operation = gatewayOpenApiDocument.paths['/api/v1/foyers'].post;
    expect(operation).toBeDefined();
    expect(operation.responses['201']).toBeDefined();
    expect(operation.responses['409']).toBeDefined();
    expect(operation.responses['409'].description).toMatch(/déjà un foyer/i);
  });

  it('expose l’ajout d’un enfant (POST /foyers/{id}/enfants)', () => {
    const operation =
      gatewayOpenApiDocument.paths['/api/v1/foyers/{id}/enfants'].post;
    expect(operation).toBeDefined();
    expect(
      operation.responses['201'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/EnfantVue' });
    const corps =
      operation.requestBody.content['application/json'].schema.required;
    expect(corps).toEqual(['prenom', 'dateNaissance']);
  });

  it('expose l’édition et la suppression d’un enfant (PUT/DELETE /foyers/{id}/enfants/{enfantId})', () => {
    const route =
      gatewayOpenApiDocument.paths['/api/v1/foyers/{id}/enfants/{enfantId}'];
    expect(route.put).toBeDefined();
    expect(
      route.put.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/EnfantVue' });
    expect(
      route.put.requestBody.content['application/json'].schema.required,
    ).toEqual(['prenom', 'dateNaissance']);
    expect(route.delete).toBeDefined();
    expect(route.delete.responses['204']).toBeDefined();
  });

  it('expose l’édition des scalaires d’un foyer (PUT /foyers/{id})', () => {
    const operation = gatewayOpenApiDocument.paths['/api/v1/foyers/{id}'].put;
    expect(operation).toBeDefined();
    expect(
      operation.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/FoyerVue' });
    const corps =
      operation.requestBody.content['application/json'].schema.required;
    expect(corps).toEqual([
      'ressourcesMensuelles',
      'rfr',
      'nbEnfantsACharge',
      'nbParts',
    ]);
  });

  it('expose la validation hebdomadaire (/notifications/*)', () => {
    const aValider =
      gatewayOpenApiDocument.paths['/api/v1/notifications/a-valider'].get;
    expect(aValider.parameters[0].name).toBe('foyer');
    expect(aValider.parameters[0].required).toBe(true);
    expect(
      aValider.responses['200'].content['application/json'].schema,
    ).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/NotificationAValiderVue' },
    });

    const valider =
      gatewayOpenApiDocument.paths[
        '/api/v1/notifications/validations/{contratId}/{semaineIso}'
      ].post;
    expect(valider.responses['200'].content['application/json'].schema).toEqual(
      {
        $ref: '#/components/schemas/ValidationResultat',
      },
    );

    // Invariant du DTO gateway : `sujet`/`corps` vont ensemble (400 sinon).
    const envoi =
      gatewayOpenApiDocument.paths['/api/v1/notifications/envois/etablissement']
        .post;
    expect(
      envoi.requestBody.content['application/json'].schema.required,
    ).toEqual(['foyerId', 'semaineIso', 'etablissementId']);
    expect(envoi.responses['400']).toBeDefined();
  });

  it('distingue readiness (/api/health) et liveness (/api/health/live)', () => {
    // Contrainte A6/A7 : compose et blackbox sondent la LIVENESS (aucune
    // dépendance) — sinon un amont dégradé provoque des restarts en cascade.
    // Depuis B3, `/api/health` porte la readiness des 5 amonts, donc un 503.
    expect(
      Object.keys(gatewayOpenApiDocument.paths['/api/health'].get.responses),
    ).toEqual(['200', '503']);
    expect(
      Object.keys(
        gatewayOpenApiDocument.paths['/api/health/live'].get.responses,
      ),
    ).toEqual(['200']);
  });

  it('marque les routes publiques avec security: []', () => {
    expect(gatewayOpenApiDocument.paths['/api/health'].get.security).toEqual(
      [],
    );
    expect(
      gatewayOpenApiDocument.paths['/api/health/live'].get.security,
    ).toEqual([]);
    expect(
      gatewayOpenApiDocument.paths['/api/referentiel/health'].get.security,
    ).toEqual([]);
    expect(
      gatewayOpenApiDocument.paths['/api/openapi.json'].get.security,
    ).toEqual([]);
  });

  it('applique le schéma de sécurité tokenApi globalement', () => {
    expect(gatewayOpenApiDocument.security).toEqual([{ tokenApi: [] }]);
    const scheme = gatewayOpenApiDocument.components.securitySchemes.tokenApi;
    expect(scheme.type).toBe('http');
    expect(scheme.scheme).toBe('bearer');
  });

  it('fournit les schémas réutilisables sous components.schemas', () => {
    const schemas = gatewayOpenApiDocument.components.schemas;
    expect(schemas.FoyerVue).toBeDefined();
    expect(schemas.EnfantVue).toBeDefined();
    expect(schemas.ParentVue).toBeDefined();
    expect(schemas.MoiVue).toBeDefined();
    expect(schemas.MonProfilVue).toBeDefined();
    expect(schemas.PreferenceVue).toBeDefined();
    expect(schemas.NotificationInApp).toBeDefined();
    expect(schemas.InboxVue).toBeDefined();
    expect(schemas.ContratVue).toBeDefined();
    expect(schemas.Ligne).toBeDefined();
    expect(schemas.CoutMoisVue).toBeDefined();
    expect(schemas.CoutAnnuelVue).toBeDefined();
    expect(schemas.EtablissementFoyerVue).toBeDefined();
    expect(schemas.CreerEtablissementCorps).toBeDefined();
    expect(schemas.PreavisRegle).toBeDefined();
    expect(schemas.GrilleAbcmVue).toBeDefined();
    expect(schemas.HealthCheckResult).toBeDefined();
    expect(schemas.NotificationAValiderVue).toBeDefined();
    expect(schemas.ValidationResultat).toBeDefined();
    expect(schemas.SemaineBesoinsVue).toBeDefined();
    expect(schemas.BrouillonEtablissementVue).toBeDefined();
    expect(schemas.EnvoiEtablissementResultat).toBeDefined();
    expect(schemas.SuiviEnvoisVue).toBeDefined();
  });

  it('expose le serveur local de la gateway', () => {
    expect(gatewayOpenApiDocument.servers).toEqual([
      { url: 'http://localhost:3000' },
    ]);
  });
});
