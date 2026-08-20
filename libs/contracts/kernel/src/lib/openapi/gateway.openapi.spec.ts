import { describe, expect, it } from 'vitest';
import { avecProblemes, gatewayOpenApiDocument } from '../../index.js';

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
  it('expose exactement les 48 routes attendues', () => {
    const paths = Object.keys(gatewayOpenApiDocument.paths).sort();
    expect(paths).toEqual(
      [
        '/api/health',
        '/api/health/live',
        '/api/referentiel/health',
        '/api/openapi.json',
        '/api/v1/foyers',
        '/api/v1/foyers/{id}',
        '/api/v1/foyers/{id}/export',
        '/api/v1/foyers/{id}/versions',
        '/api/v1/foyers/{id}/enfants',
        '/api/v1/foyers/{id}/enfants/{enfantId}',
        '/api/v1/foyers/{id}/parents',
        '/api/v1/foyers/{id}/parents/{parentId}',
        '/api/v1/foyers/{foyerId}/etablissements',
        '/api/v1/foyers/{foyerId}/etablissements/{id}',
        // Calendrier d'ouverture (SFD 31, lot 2). Six chemins, dix opérations :
        // la lecture résolue (contrat GELÉ, consommé sans pact par le plan 33)
        // et les trois couches en append-only — « supprimer » y est une clôture.
        '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier',
        '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/recurrences',
        '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/periodes',
        '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/periodes/{periodeId}',
        '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/exceptions',
        '/api/v1/foyers/{foyerId}/etablissements/{id}/calendrier/exceptions/{exceptionId}',
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
        '/api/v1/unites-associatives',
        '/api/v1/unites-associatives/sessions',
        '/api/v1/unites-associatives/sessions/{sessionId}',
        '/api/v1/referentiel/grilles',
        '/api/v1/referentiel/baremes/psu',
        '/api/v1/referentiel/baremes/tranches',
      ].sort(),
    );
  });

  // L'export de portabilité (lot 3) : la seule route dont la réponse rassemble
  // trois services. On fige ici les **noms de sections** — ce sont eux qui font le
  // contrat lisible par un humain qui ouvre le fichier, et un renommage silencieux
  // casserait tout export déjà téléchargé sans qu'aucun type ne s'en aperçoive
  // (les lignes, elles, sont volontairement libres).
  it('expose l’export de portabilité avec ses quatre sections nommées', () => {
    const route = gatewayOpenApiDocument.paths['/api/v1/foyers/{id}/export'];
    expect(
      route.get.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/ExportPortabiliteVue' });
    expect(route.get.responses['403']).toBeDefined();
    const schema =
      gatewayOpenApiDocument.components.schemas.ExportPortabiliteVue;
    expect(schema.required).toEqual([
      'versionFormat',
      'genereLe',
      'foyerId',
      'situationFoyer',
      'gardeEtPlanning',
      'communications',
      'engagementAssociatif',
    ]);
    expect(schema.properties.situationFoyer.required).toContain('parents');
    expect(schema.properties.gardeEtPlanning.required).toEqual([
      'contrats',
      'etablissements',
    ]);
    expect(schema.properties.communications.required).toContain(
      'envoisEtablissement',
    );
    // Section ajoutée par la SFD 40 — ajout ADDITIF : `versionFormat` ne bouge pas.
    expect(schema.properties.engagementAssociatif.required).toEqual([
      'foyerId',
      'engagements',
      'pisteAudit',
    ]);
  });

  // SFD 40 — le suivi des unités associatives. On fige ici ce qu'un écran ne doit
  // pas pouvoir confondre : les TROIS compteurs sont distincts, et un coût projeté
  // ne voyage jamais sans son hypothèse (RM-40-05).
  it('expose le suivi des unités associatives, compteurs distincts et hypothèse portée', () => {
    const route = gatewayOpenApiDocument.paths['/api/v1/unites-associatives'];
    expect(
      route.get.responses['200'].content['application/json'].schema,
    ).toEqual({ $ref: '#/components/schemas/SuiviUaVue' });
    expect(route.post.responses['409']).toBeDefined();
    const compteurs = gatewayOpenApiDocument.components.schemas.CompteursUaVue;
    expect(compteurs.required).toContain('heuresRealisees');
    expect(compteurs.required).toContain('heuresReservees');
    expect(compteurs.required).toContain('heuresRestantes');
    expect(compteurs.required).toContain('heuresAConfirmer');
    expect(
      gatewayOpenApiDocument.components.schemas.CoutProjeteUaVue.required,
    ).toEqual(['montantCentimes', 'hypothese']);
    const sessions =
      gatewayOpenApiDocument.paths[
        '/api/v1/unites-associatives/sessions/{sessionId}'
      ];
    expect(sessions.delete.responses['204']).toBeDefined();
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

  it('expose l’effacement d’un foyer (DELETE /foyers/{id})', () => {
    const operation =
      gatewayOpenApiDocument.paths['/api/v1/foyers/{id}'].delete;
    expect(operation).toBeDefined();
    expect(operation.responses['204']).toBeDefined();
    expect(operation.responses['404']).toBeDefined();
    // Le geste n'est pas rejouable et la propagation aval est asynchrone : le
    // document doit le dire, c'est ce que lit l'intégrateur avant d'appeler.
    expect(operation.description).toContain('foyer.FoyerSupprime.v1');
    expect(operation.description).toContain('asynchrone');
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
    expect(schemas.ExportPortabiliteVue).toBeDefined();
    expect(schemas.LigneExport).toBeDefined();
  });

  it('expose le serveur local de la gateway', () => {
    expect(gatewayOpenApiDocument.servers).toEqual([
      { url: 'http://localhost:3000' },
    ]);
  });
});

/**
 * `avecProblemes` est la seule chose qui attache un corps aux réponses d'erreur
 * du document : 50 réponses en dépendent, et aucune n'est écrite à la main. Les
 * cas ci-dessous sont ceux qui décident — le reste du document n'est qu'un très
 * grand exemple du premier.
 */
describe('avecProblemes (dérivation du corps d’erreur, RFC 9457)', () => {
  it('attache le problème à une réponse d’erreur qui n’en déclare aucun', () => {
    const derive = avecProblemes({
      paths: {
        '/x': { get: { responses: { '404': { description: 'nope' } } } },
      },
    });
    expect(derive.paths['/x'].get.responses['404']).toEqual({
      description: 'nope',
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/Probleme' },
        },
      },
    });
  });

  // C'est cette règle — et non une liste d'exceptions — qui exempte le 503 de
  // `/api/health`, dont le corps EST le rapport de santé.
  it('laisse intacte une réponse d’erreur qui porte déjà de la donnée', () => {
    const propre = {
      description: 'santé',
      content: { 'application/json': { schema: { $ref: '#/x' } } },
    };
    const derive = avecProblemes({
      paths: { '/health': { get: { responses: { '503': { ...propre } } } } },
    });
    expect(derive.paths['/health'].get.responses['503']).toEqual(propre);
  });

  it('ne touche pas les réponses de succès', () => {
    const derive = avecProblemes({
      paths: { '/x': { get: { responses: { '204': { description: 'ok' } } } } },
    });
    expect(derive.paths['/x'].get.responses['204']).toEqual({
      description: 'ok',
    });
  });

  // Un `parameters` au niveau du chemin (OpenAPI 3.1 l'autorise) n'est pas une
  // opération : le lire comme telle ferait planter la génération du document.
  it('tolère un membre de path item qui n’est pas une opération', () => {
    expect(() =>
      avecProblemes({
        paths: { '/x': { parameters: [{ name: 'id', in: 'path' }] } },
      }),
    ).not.toThrow();
  });

  it('ne modifie pas le document d’origine (copie, pas mutation)', () => {
    const origine = {
      paths: {
        '/x': { get: { responses: { '404': { description: 'nope' } } } },
      },
    };
    avecProblemes(origine);
    expect(origine.paths['/x'].get.responses['404']).toEqual({
      description: 'nope',
    });
  });
});
