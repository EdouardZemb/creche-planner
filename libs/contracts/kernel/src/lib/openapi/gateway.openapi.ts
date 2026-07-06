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
      PreferenceVue: {
        type: 'object',
        description:
          'Préférence de notification effective d’un parent (type × canal) : ' +
          'défaut applicatif fusionné avec le choix explicite stocké. ' +
          '`consentementAt`/`desabonneAt` tracent l’opt-in/opt-out (RGPD ; null ' +
          'tant qu’aucun choix n’a été posé).',
        properties: {
          typeNotification: {
            type: 'string',
            enum: ['VALIDATION_HEBDO', 'RECAP_SERVICE'],
          },
          canal: { type: 'string', enum: ['EMAIL', 'IN_APP'] },
          actif: { type: 'boolean' },
          consentementAt: { type: ['string', 'null'], format: 'date-time' },
          desabonneAt: { type: ['string', 'null'], format: 'date-time' },
        },
        required: [
          'typeNotification',
          'canal',
          'actif',
          'consentementAt',
          'desabonneAt',
        ],
      },
      MonProfilVue: {
        type: 'object',
        description:
          'Vue « Mon profil » du parent connecté (A1) : sa ligne parent ciblée ' +
          'sur lui (résolue côté serveur depuis l’identité Cloudflare Access, ' +
          'jamais un parentId fourni par le client) et ses préférences de ' +
          'notification effectives. `foyerId`/`parentId` permettent au web de ' +
          'réutiliser les routes d’édition existantes sous @FoyerScope.',
        properties: {
          parentId: { type: 'string', format: 'uuid' },
          foyerId: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          prenom: { type: ['string', 'null'] },
          nom: { type: ['string', 'null'] },
          principal: { type: 'boolean' },
          preferences: {
            type: 'array',
            items: { $ref: '#/components/schemas/PreferenceVue' },
          },
        },
        required: [
          'parentId',
          'foyerId',
          'email',
          'prenom',
          'nom',
          'principal',
          'preferences',
        ],
      },
      NotificationInApp: {
        type: 'object',
        description:
          'Une notification de l’inbox in-app d’un parent (PR6, journal ' +
          'informationnel lu/non-lu). `luLe` null tant qu’elle n’est pas lue. ' +
          'C’est un journal : il n’expose pas d’action « Valider » (celle-ci reste ' +
          'portée par l’encart A_VALIDER).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { type: 'string' },
          sujet: { type: 'string' },
          corps: { type: 'string' },
          lien: {
            type: ['string', 'null'],
            description:
              'Lien profond in-app (chemin relatif `/foyers/:id/planning?semaine=…`) ' +
              'rendant la carte tapable jusqu’à l’éditeur concerné. `null` pour les ' +
              'entrées sans lien. Champ **optionnel** (compat ascendante).',
          },
          creeLe: { type: 'string', format: 'date-time' },
          luLe: { type: ['string', 'null'], format: 'date-time' },
        },
        required: ['id', 'type', 'sujet', 'corps', 'creeLe', 'luLe'],
      },
      InboxVue: {
        type: 'object',
        description:
          'Panneau de l’inbox in-app du parent connecté : ses notifications ' +
          'récentes (les plus récentes d’abord) et le compteur total de non-lus ' +
          '(cloche). `nonLus` n’est pas borné par la taille de `notifications`.',
        properties: {
          notifications: {
            type: 'array',
            items: { $ref: '#/components/schemas/NotificationInApp' },
          },
          nonLus: { type: 'integer', minimum: 0 },
        },
        required: ['notifications', 'nonLus'],
      },
      ContratVue: {
        type: 'object',
        description: 'Vue projetée d’un contrat de garde.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          foyerId: { type: 'string', format: 'uuid' },
          /**
           * Prénom de l'enfant, dénormalisation d'affichage rafraîchie par la
           * projection `foyer.EnfantModifie` — la référence est `enfantId`.
           */
          enfant: { type: 'string' },
          /**
           * Lien de référence vers l'enfant (agrégat svc-foyer) ; `null` pour un
           * contrat historique pas encore rapproché (back-fill en attente).
           */
          enfantId: { type: ['string', 'null'], format: 'uuid' },
          mode: { type: 'string' },
          /**
           * Établissement réel rattaché (lien explicite P2/P3) ; null/absent si
           * aucun. Porté par la liste des contrats — clé de routage du récap hebdo
           * et pré-sélection du sélecteur d’établissement à l’édition d’un contrat.
           */
          etablissementId: { type: ['string', 'null'], format: 'uuid' },
          valideDu: { type: 'string', format: 'date' },
          valideAu: { type: ['string', 'null'], format: 'date' },
        },
        required: [
          'id',
          'foyerId',
          'enfant',
          'enfantId',
          'mode',
          'valideDu',
          'valideAu',
        ],
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
      EtablissementFoyerVue: {
        type: 'object',
        description:
          'Établissement en entité libre, propre à un foyer (propriété de ' +
          'svc-planification, P2/P3). Identifié par un `id` libre (UUID), pas ' +
          'l’ancienne clé fermée. Tous les champs descriptifs sauf `nom` peuvent ' +
          'être null tant qu’ils ne sont pas renseignés.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          foyerId: { type: 'string', format: 'uuid' },
          nom: { type: 'string' },
          emailService: { type: ['string', 'null'], format: 'email' },
          preavisRegle: {
            anyOf: [
              { $ref: '#/components/schemas/PreavisRegle' },
              { type: 'null' },
            ],
          },
          types: {
            type: 'array',
            description:
              'Modes de garde proposés par l’établissement (informatif, ' +
              'multi-valeurs ; indépendant du `mode` d’un contrat).',
            items: {
              type: 'string',
              enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
            },
          },
          adresse: { type: ['string', 'null'] },
          telephone: { type: ['string', 'null'] },
          contact: { type: ['string', 'null'] },
          actif: { type: 'boolean' },
        },
        required: [
          'id',
          'foyerId',
          'nom',
          'emailService',
          'preavisRegle',
          'types',
          'adresse',
          'telephone',
          'contact',
          'actif',
        ],
      },
      CreerEtablissementCorps: {
        type: 'object',
        description:
          'Corps de création d’un établissement (entité libre par foyer). Seul ' +
          '`nom` est requis ; le reste est facultatif et peut être null. Sert ' +
          'aussi de `nouvelEtablissement` à la création d’un contrat (à la volée).',
        properties: {
          nom: { type: 'string', minLength: 1, maxLength: 200 },
          emailService: { type: ['string', 'null'], format: 'email' },
          preavisRegle: {
            anyOf: [
              { $ref: '#/components/schemas/PreavisRegle' },
              { type: 'null' },
            ],
          },
          types: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
            },
          },
          adresse: { type: ['string', 'null'] },
          telephone: { type: ['string', 'null'] },
          contact: { type: ['string', 'null'] },
          actif: { type: 'boolean' },
        },
        required: ['nom'],
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
        description:
          'Self-service de la première création (P5). Une identité non-admin ' +
          'qui possède déjà un foyer reçoit 409 (create-once) ; l’admin crée ' +
          'sans limite, une identité absente reste en mode hérité. Le créateur ' +
          'non-admin est rattaché comme parent du foyer.',
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
          '409': {
            description:
              'Création refusée : l’utilisateur (non-admin identifié) possède ' +
              'déjà un foyer. Orienter vers l’édition de son foyer.',
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
      put: {
        summary: 'Éditer les scalaires d’un foyer',
        description:
          'Met à jour les finances/RFR/parts/nb enfants à charge d’un foyer ' +
          'existant. Les enfants et parents se gèrent via leurs propres routes.',
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
                properties: {
                  ressourcesMensuelles: { type: 'number' },
                  rfr: { type: 'number' },
                  nbEnfantsACharge: { type: 'integer' },
                  nbParts: { type: 'number' },
                },
                required: [
                  'ressourcesMensuelles',
                  'rfr',
                  'nbEnfantsACharge',
                  'nbParts',
                ],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Foyer mis à jour.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/FoyerVue' },
              },
            },
          },
          '404': { description: 'Foyer inconnu.' },
        },
      },
    },
    '/api/v1/foyers/{id}/enfants': {
      post: {
        summary: 'Rattacher un enfant au foyer',
        description:
          'Ajoute un enfant à un foyer existant (prénom + date de ' +
          'naissance). L’édition et la suppression d’un enfant se font via ' +
          '/foyers/{id}/enfants/{enfantId}.',
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
                properties: {
                  prenom: { type: 'string' },
                  dateNaissance: { type: 'string', format: 'date' },
                },
                required: ['prenom', 'dateNaissance'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Enfant rattaché.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EnfantVue' },
              },
            },
          },
          '404': { description: 'Foyer inconnu.' },
        },
      },
    },
    '/api/v1/foyers/{id}/enfants/{enfantId}': {
      put: {
        summary: 'Éditer un enfant (prénom/date)',
        description:
          'Met à jour un enfant du foyer. Le renommage se propage aux ' +
          'contrats existants : svc-planification référence l’enfant par ' +
          '`enfantId` et rafraîchit son prénom dénormalisé à la réception de ' +
          '`foyer.EnfantModifie` (projection NATS).',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'enfantId',
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
                properties: {
                  prenom: { type: 'string' },
                  dateNaissance: { type: 'string', format: 'date' },
                },
                required: ['prenom', 'dateNaissance'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Enfant mis à jour.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EnfantVue' },
              },
            },
          },
          '404': { description: 'Enfant inconnu.' },
        },
      },
      delete: {
        summary: 'Retirer un enfant (hard delete)',
        description:
          'Supprime un enfant du foyer. Sans effet sur les contrats ' +
          'existants (leur `enfantId` pointe alors vers un enfant disparu ; ' +
          'leur suppression reste un geste explicite de l’utilisateur).',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'enfantId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': { description: 'Enfant retiré (pas de contenu).' },
          '404': { description: 'Enfant inconnu.' },
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
    '/api/v1/moi/profil': {
      get: {
        summary:
          'Mon profil (parent connecté) et mes préférences de notification',
        description:
          'Résout la ligne parent du client à partir de son e-mail vérifié ' +
          '(identité Cloudflare Access) et renvoie ses préférences de ' +
          'notification effectives. La résolution est côté serveur : le client ' +
          'ne fournit jamais de parentId (il ne voit que « son » profil).',
        responses: {
          '200': {
            description: 'Profil du parent connecté et ses préférences.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MonProfilVue' },
              },
            },
          },
          '401': { description: 'Aucune identité établie.' },
          '404': {
            description:
              'Aucun profil parent pour cette identité (aucun foyer, ou foyer ' +
              'sans la ligne parent correspondante).',
          },
        },
      },
    },
    '/api/v1/moi/preferences': {
      put: {
        summary: 'Mettre à jour mes préférences de notification',
        description:
          'Met à jour les préférences (type × canal) du parent connecté. ' +
          'Défense en profondeur : le parentId ciblé est résolu depuis ' +
          'l’identité (la ligne dont l’e-mail = moi.email), jamais fourni par ' +
          'le client — un parent ne modifie que SA ligne. Refus (400) si la ' +
          'combinaison coupe tous les canaux d’un type de service (invariant ' +
          '≥ 1 canal actif).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Liste non vide des choix explicites (type, canal, actif) à ' +
                  'matérialiser ; les combinaisons absentes retombent sur le ' +
                  'défaut applicatif.',
                properties: {
                  preferences: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: {
                        typeNotification: {
                          type: 'string',
                          enum: ['VALIDATION_HEBDO', 'RECAP_SERVICE'],
                        },
                        canal: {
                          type: 'string',
                          enum: ['EMAIL', 'IN_APP'],
                        },
                        actif: { type: 'boolean' },
                      },
                      required: ['typeNotification', 'canal', 'actif'],
                    },
                  },
                },
                required: ['preferences'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Préférences mises à jour (état effectif renvoyé).',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/PreferenceVue' },
                },
              },
            },
          },
          '400': {
            description:
              'Combinaison invalide (dernier canal d’un type de service coupé).',
          },
          '401': { description: 'Aucune identité établie.' },
          '404': { description: 'Aucun profil parent pour cette identité.' },
        },
      },
    },
    '/api/v1/moi/notifications': {
      get: {
        summary: 'Mon inbox in-app (notifications + compteur de non-lus)',
        description:
          'Inbox in-app du parent connecté (PR6, §5.6) : ses notifications ' +
          'récentes et le nombre de non-lus (cloche). Le parentId est résolu ' +
          'côté serveur depuis l’identité (le client ne voit que « ses » ' +
          'notifications). Journal informationnel : ne duplique pas l’action ' +
          '« Valider » (portée par /notifications/a-valider).',
        responses: {
          '200': {
            description: 'Inbox du parent connecté.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InboxVue' },
              },
            },
          },
          '401': { description: 'Aucune identité établie.' },
          '404': { description: 'Aucun profil parent pour cette identité.' },
        },
      },
    },
    '/api/v1/moi/notifications/{id}/lu': {
      post: {
        summary: 'Marquer une de mes notifications comme lue',
        description:
          'Accusé de lecture d’une notification du parent connecté (idempotent). ' +
          'Défense en profondeur : le parentId est résolu depuis l’identité et ' +
          'scope l’écriture — un parent ne marque que SA notification (404 si ' +
          'l’id est inconnu ou appartient à un autre parent).',
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
            description: 'Notification marquée comme lue (état renvoyé).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/NotificationInApp' },
              },
            },
          },
          '401': { description: 'Aucune identité établie.' },
          '404': {
            description:
              'Notification inconnue (ou appartenant à un autre parent), ou ' +
              'aucun profil parent pour cette identité.',
          },
        },
      },
    },
    '/api/v1/desabonnement': {
      post: {
        summary: 'Désabonnement one-click (RFC 8058)',
        description:
          'Endpoint PUBLIC (sans session) de désabonnement one-click. Ciblé par ' +
          'l’en-tête List-Unsubscribe des e-mails (POST direct du client de ' +
          'messagerie). Le seul paramètre est un jeton signé opaque (aucun e-mail ' +
          'ni identifiant ⇒ pas d’énumération) ; l’usage est one-shot. Toujours ' +
          'soumis à la limitation de débit.',
        security: [],
        parameters: [
          {
            name: 'token',
            in: 'query',
            required: true,
            description:
              'Jeton de désabonnement signé (lié à parent/type/canal).',
            schema: { type: 'string' },
          },
        ],
        responses: {
          '204': {
            description: 'Désabonnement enregistré (canal e-mail coupé).',
          },
          '400': {
            description:
              'Lien invalide, expiré ou déjà utilisé (message générique).',
          },
          '409': {
            description:
              'Dernier canal actif d’un type de service : ce canal ne peut être ' +
              'coupé (gérez vos préférences).',
          },
          '429': { description: 'Trop de requêtes (limitation de débit).' },
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
                  'sont laissés ouverts via additionalProperties. Le lien ' +
                  'établissement est OBLIGATOIRE depuis P5 (`etablissement_id` ' +
                  'NOT NULL) : fournir EXACTEMENT un de `etablissementId` ' +
                  '(existant) OU `nouvelEtablissement` (créé à la volée) — ni ' +
                  'zéro ni les deux (validation profonde svc-planification).',
                additionalProperties: true,
                properties: {
                  mode: {
                    type: 'string',
                    enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
                  },
                  foyerId: { type: 'string', format: 'uuid' },
                  enfant: { type: 'string' },
                  enfantId: { type: 'string', format: 'uuid' },
                  etablissementId: { type: 'string', format: 'uuid' },
                  nouvelEtablissement: {
                    $ref: '#/components/schemas/CreerEtablissementCorps',
                  },
                  valideDu: { type: 'string', format: 'date' },
                  valideAu: { type: ['string', 'null'], format: 'date' },
                },
                required: [
                  'mode',
                  'foyerId',
                  'enfant',
                  'enfantId',
                  'valideDu',
                  'valideAu',
                ],
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
    '/api/v1/foyers/{foyerId}/etablissements': {
      get: {
        summary: 'Lister les établissements d’un foyer (entité libre)',
        description:
          'Établissements configurables propres au foyer (P2/P3), source de ' +
          'vérité `svc-planification`.',
        parameters: [
          {
            name: 'foyerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Établissements du foyer (liste vide si aucun).',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/EtablissementFoyerVue',
                  },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Créer un établissement dans le foyer',
        parameters: [
          {
            name: 'foyerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreerEtablissementCorps' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Établissement créé.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EtablissementFoyerVue' },
              },
            },
          },
          '400': { description: 'Données invalides (ex. nom déjà utilisé).' },
        },
      },
    },
    '/api/v1/foyers/{foyerId}/etablissements/{id}': {
      put: {
        summary:
          'Modifier un établissement du foyer (champs fournis uniquement)',
        parameters: [
          {
            name: 'foyerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
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
                  'Champs éditables d’un établissement (tous optionnels ; ' +
                  'seuls les champs fournis changent, un champ null vide la ' +
                  'valeur). `nom` non vide s’il est fourni.',
                properties: {
                  nom: { type: 'string', minLength: 1, maxLength: 200 },
                  emailService: { type: ['string', 'null'], format: 'email' },
                  preavisRegle: {
                    anyOf: [
                      { $ref: '#/components/schemas/PreavisRegle' },
                      { type: 'null' },
                    ],
                  },
                  types: {
                    type: 'array',
                    items: {
                      type: 'string',
                      enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
                    },
                  },
                  adresse: { type: ['string', 'null'] },
                  telephone: { type: ['string', 'null'] },
                  contact: { type: ['string', 'null'] },
                  actif: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Établissement mis à jour.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EtablissementFoyerVue' },
              },
            },
          },
          '404': { description: 'Établissement inconnu.' },
        },
      },
      delete: {
        summary: 'Supprimer un établissement du foyer',
        description:
          'Suppression bloquée (409) tant qu’au moins un contrat y est rattaché.',
        parameters: [
          {
            name: 'foyerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': { description: 'Établissement supprimé (pas de contenu).' },
          '409': {
            description: 'Des contrats sont rattachés à l’établissement.',
          },
        },
      },
    },
  },
} as const;

export type GatewayOpenApiDocument = typeof gatewayOpenApiDocument;
