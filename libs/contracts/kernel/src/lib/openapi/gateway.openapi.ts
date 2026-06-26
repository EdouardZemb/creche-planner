// Spécification OpenAPI 3.1 de l'API Gateway (BFF) — Phase 7 (doc 03 §9bis).
//
// Document écrit à la main (pas de @nestjs/swagger) : objet littéral typé,
// exporté tel quel pour être servi par la route GET /api/openapi.json.
// Les schémas réutilisables (FoyerVue, EnfantVue, ContratVue, Ligne,
// CoutMoisVue, CoutAnnuelVue) vivent sous components.schemas et sont
// référencés via $ref. Le schéma de sécurité « tokenApi » (bearer) est
// appliqué globalement, sauf sur les routes publiques (security: []).

export const gatewayOpenApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Crèche Planner — API Gateway (BFF)',
    version: '1.0.0',
    description:
      'API orientée écran agrégeant Foyer, Planification et Tarification.',
  },
  servers: [{ url: 'http://localhost:3000' }],
  security: [{ tokenApi: [] }],
  components: {
    securitySchemes: {
      tokenApi: {
        type: 'http',
        scheme: 'bearer',
        description: 'Jeton porteur (bearer) requis sur les routes protégées.',
      },
    },
    schemas: {
      FoyerVue: {
        type: 'object',
        description: 'Vue projetée d’un foyer (montants en centimes et euros).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          ressourcesMensuellesCentimes: { type: 'integer' },
          ressourcesMensuellesEuros: { type: 'number' },
          rfrCentimes: { type: 'integer' },
          rfrEuros: { type: 'number' },
          nbEnfantsACharge: { type: 'integer' },
          nbParts: { type: 'number' },
          tranche: { type: 'integer', minimum: 1, maximum: 3 },
        },
        required: [
          'id',
          'ressourcesMensuellesCentimes',
          'ressourcesMensuellesEuros',
          'rfrCentimes',
          'rfrEuros',
          'nbEnfantsACharge',
          'nbParts',
          'tranche',
        ],
      },
      EnfantVue: {
        type: 'object',
        description: 'Vue projetée d’un enfant rattaché à un foyer.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          foyerId: { type: 'string', format: 'uuid' },
          prenom: { type: 'string' },
          dateNaissance: { type: 'string', format: 'date' },
        },
        required: ['id', 'foyerId', 'prenom', 'dateNaissance'],
      },
      ParentVue: {
        type: 'object',
        description:
          'Vue projetée d’un parent rattaché à un foyer (destinataire des ' +
          'notifications ; e-mail = PII). `prenom`/`nom` sont une identité ' +
          'douce optionnelle (nullable).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          foyerId: { type: 'string', format: 'uuid' },
          prenom: { type: ['string', 'null'] },
          nom: { type: ['string', 'null'] },
          email: { type: 'string', format: 'email' },
          principal: { type: 'boolean' },
          ordre: { type: 'integer' },
          actif: { type: 'boolean' },
        },
        required: [
          'id',
          'foyerId',
          'prenom',
          'nom',
          'email',
          'principal',
          'ordre',
          'actif',
        ],
      },
      MoiVue: {
        type: 'object',
        description:
          'Identité courante du client (Cloudflare Access B1) et ses droits, ' +
          'résolus côté serveur : e-mail vérifié (ou null hors identité), statut ' +
          'admin (permissif si le gating ADMIN_EMAILS est inactif), et ids des ' +
          'foyers autorisés (parent actif). Sert à gater l’écran de création et à ' +
          'borner la sélection de foyer.',
        properties: {
          email: { type: ['string', 'null'], format: 'email' },
          admin: { type: 'boolean' },
          foyers: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
          },
        },
        required: ['email', 'admin', 'foyers'],
      },
      ContratVue: {
        type: 'object',
        description: 'Vue projetée d’un contrat de garde.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          foyerId: { type: 'string', format: 'uuid' },
          enfant: { type: 'string' },
          mode: { type: 'string' },
          valideDu: { type: 'string', format: 'date' },
          valideAu: { type: ['string', 'null'], format: 'date' },
        },
        required: ['id', 'foyerId', 'enfant', 'mode', 'valideDu', 'valideAu'],
      },
      PreavisRegle: {
        description:
          'Règle de préavis d’un établissement (union discriminée par `type`).',
        oneOf: [
          {
            type: 'object',
            description:
              'Préavis exprimé en jours ouvrés (ex. 2 jours, crèche).',
            properties: {
              type: { type: 'string', enum: ['JOURS_OUVRES'] },
              valeur: { type: 'integer', minimum: 0, maximum: 30 },
            },
            required: ['type', 'valeur'],
          },
          {
            type: 'object',
            description:
              'Préavis exprimé en jour + heure butoir (ex. jeudi 12:00, ABCM).',
            properties: {
              type: { type: 'string', enum: ['JOUR_HEURE'] },
              jour: {
                type: 'string',
                enum: [
                  'LUNDI',
                  'MARDI',
                  'MERCREDI',
                  'JEUDI',
                  'VENDREDI',
                  'SAMEDI',
                  'DIMANCHE',
                ],
              },
              heure: { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
            },
            required: ['type', 'jour', 'heure'],
          },
        ],
      },
      EtablissementVue: {
        type: 'object',
        description:
          'Établissement destinataire d’un mail de service (annuaire notifications).',
        properties: {
          cle: { type: 'string', enum: ['CRECHE_HIRONDELLES', 'ABCM'] },
          libelle: { type: 'string' },
          emailService: { type: 'string', format: 'email' },
          preavisRegle: { $ref: '#/components/schemas/PreavisRegle' },
          actif: { type: 'boolean' },
        },
        required: ['cle', 'libelle', 'emailService', 'preavisRegle', 'actif'],
      },
      Ligne: {
        type: 'object',
        description: 'Ligne de coût (débit ou crédit) en centimes.',
        properties: {
          libelle: { type: 'string' },
          sens: { type: 'string', enum: ['debit', 'credit'] },
          montantCentimes: { type: 'integer' },
        },
        required: ['libelle', 'sens', 'montantCentimes'],
      },
      CoutMoisVue: {
        type: 'object',
        description: 'Coût consolidé d’un foyer sur un mois.',
        properties: {
          foyerId: { type: 'string', format: 'uuid' },
          mois: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          simule: { type: 'boolean' },
          totalCentimes: { type: 'integer' },
          prestations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                enfant: { type: 'string' },
                mode: { type: 'string' },
                totalCentimes: { type: 'integer' },
                lignes: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Ligne' },
                },
              },
              required: ['enfant', 'mode', 'totalCentimes', 'lignes'],
            },
          },
          lignes: {
            type: 'array',
            items: { $ref: '#/components/schemas/Ligne' },
          },
        },
        required: [
          'foyerId',
          'mois',
          'simule',
          'totalCentimes',
          'prestations',
          'lignes',
        ],
      },
      CoutAnnuelVue: {
        type: 'object',
        description:
          'Coût consolidé d’un foyer sur une année (transition crèche → école).',
        properties: {
          foyerId: { type: 'string', format: 'uuid' },
          annee: { type: 'integer' },
          simule: { type: 'boolean' },
          totalCentimes: { type: 'integer' },
          mois: {
            type: 'array',
            items: { $ref: '#/components/schemas/CoutMoisVue' },
          },
        },
        required: ['foyerId', 'annee', 'simule', 'totalCentimes', 'mois'],
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Liveness/readiness de la gateway',
        security: [],
        responses: {
          '200': {
            description: 'La gateway est vivante.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { status: { type: 'string' } },
                  required: ['status'],
                },
              },
            },
          },
        },
      },
    },
    '/api/openapi.json': {
      get: {
        summary: 'Spécification OpenAPI de la gateway',
        security: [],
        responses: {
          '200': {
            description: 'Le document OpenAPI de la gateway.',
            content: {
              'application/json': {
                schema: { type: 'object' },
              },
            },
          },
        },
      },
    },
    '/api/v1/foyers': {
      get: {
        summary: 'Lister les foyers existants',
        description:
          'Découverte du foyer déjà configuré (accueil sans foyer mémorisé ' +
          'côté client). Liste triée par date de création croissante.',
        responses: {
          '200': {
            description: 'Foyers existants (liste vide si aucun).',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/FoyerVue' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Créer un foyer et ses enfants (orchestration)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ressourcesMensuelles: { type: 'number' },
                  rfr: { type: 'number' },
                  nbEnfantsACharge: { type: 'integer' },
                  nbParts: { type: 'number' },
                  enfants: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        prenom: { type: 'string' },
                        dateNaissance: { type: 'string', format: 'date' },
                      },
                      required: ['prenom', 'dateNaissance'],
                    },
                  },
                  parents: {
                    type: 'array',
                    description:
                      'Parents rattachés à la création (optionnel ; défaut []).',
                    items: {
                      type: 'object',
                      properties: {
                        email: { type: 'string', format: 'email' },
                        prenom: { type: 'string' },
                        nom: { type: 'string' },
                        principal: { type: 'boolean' },
                        ordre: { type: 'integer', minimum: 0 },
                      },
                      required: ['email'],
                    },
                  },
                },
                required: [
                  'ressourcesMensuelles',
                  'rfr',
                  'nbEnfantsACharge',
                  'nbParts',
                  'enfants',
                ],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Foyer créé avec ses enfants.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    foyer: { $ref: '#/components/schemas/FoyerVue' },
                    enfants: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/EnfantVue' },
                    },
                    parents: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ParentVue' },
                    },
                  },
                  required: ['foyer', 'enfants', 'parents'],
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/foyers/{id}': {
      get: {
        summary: 'Lire un foyer et ses enfants',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Foyer et ses enfants.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    foyer: { $ref: '#/components/schemas/FoyerVue' },
                    enfants: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/EnfantVue' },
                    },
                    parents: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/ParentVue' },
                    },
                  },
                  required: ['foyer', 'enfants', 'parents'],
                },
              },
            },
          },
          '404': { description: 'Foyer inconnu.' },
        },
      },
    },
    '/api/v1/foyers/{id}/parents': {
      get: {
        summary: 'Lister les parents actifs d’un foyer',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Parents actifs du foyer (liste vide si aucun).',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ParentVue' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Rattacher un parent au foyer',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Parent à rattacher. `email` requis ; `prenom`/`nom` ' +
                  'identité douce optionnelle ; `principal`/`ordre` ont un ' +
                  'défaut côté service.',
                properties: {
                  email: { type: 'string', format: 'email' },
                  prenom: { type: 'string' },
                  nom: { type: 'string' },
                  principal: { type: 'boolean' },
                  ordre: { type: 'integer', minimum: 0 },
                },
                required: ['email'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Parent rattaché.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ParentVue' },
              },
            },
          },
          '409': { description: 'Adresse e-mail déjà utilisée.' },
        },
      },
    },
    '/api/v1/foyers/{id}/parents/{parentId}': {
      put: {
        summary: 'Éditer un parent (champs fournis uniquement)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'parentId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Champs éditables d’un parent (tous optionnels). ' +
                  '`prenom`/`nom` acceptent null pour effacer l’identité ' +
                  'douce ; `actif` réactive un parent retiré.',
                properties: {
                  email: { type: 'string', format: 'email' },
                  prenom: { type: ['string', 'null'] },
                  nom: { type: ['string', 'null'] },
                  principal: { type: 'boolean' },
                  ordre: { type: 'integer', minimum: 0 },
                  actif: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Parent mis à jour.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ParentVue' },
              },
            },
          },
          '404': { description: 'Parent inconnu.' },
          '409': { description: 'Adresse e-mail déjà utilisée.' },
        },
      },
      delete: {
        summary: 'Retirer un parent (soft-delete)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'parentId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': { description: 'Parent retiré (pas de contenu).' },
          '404': { description: 'Parent inconnu.' },
        },
      },
    },
    '/api/v1/moi': {
      get: {
        summary: 'Identité courante et droits (admin, foyers autorisés)',
        description:
          'Renvoie l’identité Cloudflare Access du client (e-mail vérifié ou ' +
          'null), son statut admin et l’ensemble des foyers dont il est parent ' +
          'actif. Le front s’en sert pour gater l’écran de création (admin) et ' +
          'borner la sélection de foyer (0/1/N).',
        responses: {
          '200': {
            description: 'Identité courante et droits.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MoiVue' },
              },
            },
          },
        },
      },
    },
    '/api/v1/contrats': {
      get: {
        summary: 'Lister les contrats d’un foyer',
        parameters: [
          {
            name: 'foyer',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Contrats du foyer.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ContratVue' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Créer un contrat de garde (crèche PSU ou ABCM)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Contrat de garde. Les champs spécifiques au mode (PSU/ABCM) ' +
                  'sont laissés ouverts via additionalProperties.',
                additionalProperties: true,
                properties: {
                  mode: {
                    type: 'string',
                    enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
                  },
                  foyerId: { type: 'string', format: 'uuid' },
                  enfant: { type: 'string' },
                  valideDu: { type: 'string', format: 'date' },
                  valideAu: { type: ['string', 'null'], format: 'date' },
                },
                required: ['mode', 'foyerId', 'enfant', 'valideDu', 'valideAu'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Contrat créé.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ContratVue' },
              },
            },
          },
        },
      },
    },
    '/api/v1/contrats/{id}/plannings/{mois}': {
      put: {
        summary: 'Écrire le planning mensuel (réel ou simulé)',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'mois',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          },
          {
            name: 'simule',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Planning mensuel. Structure laissée ouverte via ' +
                  'additionalProperties ; champs usuels : complementMinutes, ' +
                  'absences, pai, joursAlsh.',
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          '204': { description: 'Planning enregistré (pas de contenu).' },
        },
      },
    },
    '/api/v1/couts': {
      get: {
        summary: 'Coût consolidé du mois',
        parameters: [
          {
            name: 'foyer',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'mois',
            in: 'query',
            required: true,
            schema: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          },
          {
            name: 'simule',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
          },
        ],
        responses: {
          '200': {
            description: 'Coût consolidé du mois.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CoutMoisVue' },
              },
            },
          },
        },
      },
    },
    '/api/v1/couts/annuel': {
      get: {
        summary: 'Coût consolidé de l’année (transition crèche → école)',
        parameters: [
          {
            name: 'foyer',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'annee',
            in: 'query',
            required: true,
            schema: { type: 'integer' },
          },
          {
            name: 'simule',
            in: 'query',
            required: false,
            schema: { type: 'boolean' },
          },
        ],
        responses: {
          '200': {
            description: 'Coût consolidé de l’année.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CoutAnnuelVue' },
              },
            },
          },
        },
      },
    },
    '/api/v1/etablissements': {
      get: {
        summary: 'Lister les établissements destinataires',
        description:
          'Annuaire des établissements (crèche / ABCM) destinataires des ' +
          'mails de service, avec leur règle de préavis.',
        responses: {
          '200': {
            description: 'Établissements destinataires.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/EtablissementVue' },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/etablissements/{cle}': {
      put: {
        summary: 'Mettre à jour un établissement destinataire (upsert par clé)',
        parameters: [
          {
            name: 'cle',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['CRECHE_HIRONDELLES', 'ABCM'] },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Champs éditables de l’établissement : adresse du service et ' +
                  'règle de préavis (libellé/actif optionnels).',
                properties: {
                  emailService: { type: 'string', format: 'email' },
                  preavisRegle: { $ref: '#/components/schemas/PreavisRegle' },
                  libelle: { type: 'string' },
                  actif: { type: 'boolean' },
                },
                required: ['emailService', 'preavisRegle'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Établissement mis à jour.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EtablissementVue' },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type GatewayOpenApiDocument = typeof gatewayOpenApiDocument;
