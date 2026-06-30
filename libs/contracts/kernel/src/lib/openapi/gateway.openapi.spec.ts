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

  it('expose exactement les 14 routes attendues', () => {
    const paths = Object.keys(gatewayOpenApiDocument.paths).sort();
    expect(paths).toEqual(
      [
        '/api/health',
        '/api/openapi.json',
        '/api/v1/foyers',
        '/api/v1/foyers/{id}',
        '/api/v1/foyers/{id}/enfants',
        '/api/v1/foyers/{id}/parents',
        '/api/v1/foyers/{id}/parents/{parentId}',
        '/api/v1/foyers/{foyerId}/etablissements',
        '/api/v1/foyers/{foyerId}/etablissements/{id}',
        '/api/v1/moi',
        '/api/v1/contrats',
        '/api/v1/contrats/{id}/plannings/{mois}',
        '/api/v1/couts',
        '/api/v1/couts/annuel',
      ].sort(),
    );
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

  it('marque les routes publiques avec security: []', () => {
    expect(gatewayOpenApiDocument.paths['/api/health'].get.security).toEqual(
      [],
    );
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
    expect(schemas.ContratVue).toBeDefined();
    expect(schemas.Ligne).toBeDefined();
    expect(schemas.CoutMoisVue).toBeDefined();
    expect(schemas.CoutAnnuelVue).toBeDefined();
    expect(schemas.EtablissementFoyerVue).toBeDefined();
    expect(schemas.CreerEtablissementCorps).toBeDefined();
    expect(schemas.PreavisRegle).toBeDefined();
  });

  it('expose le serveur local de la gateway', () => {
    expect(gatewayOpenApiDocument.servers).toEqual([
      { url: 'http://localhost:3000' },
    ]);
  });
});
