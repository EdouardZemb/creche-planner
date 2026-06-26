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

  it('expose exactement les 12 routes attendues', () => {
    const paths = Object.keys(gatewayOpenApiDocument.paths).sort();
    expect(paths).toEqual(
      [
        '/api/health',
        '/api/openapi.json',
        '/api/v1/foyers',
        '/api/v1/foyers/{id}',
        '/api/v1/foyers/{id}/parents',
        '/api/v1/foyers/{id}/parents/{parentId}',
        '/api/v1/contrats',
        '/api/v1/contrats/{id}/plannings/{mois}',
        '/api/v1/couts',
        '/api/v1/couts/annuel',
        '/api/v1/etablissements',
        '/api/v1/etablissements/{cle}',
      ].sort(),
    );
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
    expect(schemas.ContratVue).toBeDefined();
    expect(schemas.Ligne).toBeDefined();
    expect(schemas.CoutMoisVue).toBeDefined();
    expect(schemas.CoutAnnuelVue).toBeDefined();
    expect(schemas.EtablissementVue).toBeDefined();
    expect(schemas.PreavisRegle).toBeDefined();
  });

  it('expose le serveur local de la gateway', () => {
    expect(gatewayOpenApiDocument.servers).toEqual([
      { url: 'http://localhost:3000' },
    ]);
  });
});
