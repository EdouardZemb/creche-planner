// Spécification OpenAPI 3.1 de l'API Gateway (BFF) — Phase 7 (doc 03 §9bis).
//
// Document écrit à la main (pas de @nestjs/swagger) : objet littéral typé,
// exporté tel quel pour être servi par la route GET /api/openapi.json.
// Les schémas réutilisables (FoyerVue, EnfantVue, ContratVue, Ligne,
// CoutMoisVue, CoutAnnuelVue) vivent sous components.schemas et sont
// référencés via $ref. Le schéma de sécurité « tokenApi » (bearer) est
// appliqué globalement, sauf sur les routes publiques (security: []).

const documentEcrit = {
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
      FoyerVersionVue: {
        type: 'object',
        description:
          'Une version de ressources d’un foyer à date d’effet (SFD 30, DV-03).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          dateEffet: { type: 'string', format: 'date' },
          ressourcesMensuellesCentimes: { type: 'integer' },
          ressourcesMensuellesEuros: { type: 'number' },
          rfrCentimes: { type: 'integer' },
          rfrEuros: { type: 'number' },
          nbEnfantsACharge: { type: 'integer' },
          nbParts: { type: 'number' },
          tranche: { type: 'integer', minimum: 1, maximum: 3 },
          saisiLe: { type: 'string', format: 'date-time' },
          motif: { type: ['string', 'null'] },
        },
        required: [
          'id',
          'dateEffet',
          'ressourcesMensuellesCentimes',
          'ressourcesMensuellesEuros',
          'rfrCentimes',
          'rfrEuros',
          'nbEnfantsACharge',
          'nbParts',
          'tranche',
          'saisiLe',
          'motif',
        ],
      },
      LigneExport: {
        type: 'object',
        description:
          'Une ligne d’export : un enregistrement tel qu’il vit dans la table ' +
          'du service qui le détient. Les colonnes ne sont volontairement pas ' +
          'décrites ici — les figer ferait une troisième copie du schéma, après ' +
          'la table et l’interface du service, sans que rien ne garde les trois ' +
          'alignées. La garantie contractuelle porte sur la présence des ' +
          'sections, pas sur la forme des lignes.',
        additionalProperties: true,
      },
      ExportPortabiliteVue: {
        type: 'object',
        description:
          'Document d’export des données personnelles d’un foyer. Les sections ' +
          'portent le nom de ce qu’elles contiennent pour la personne, pas ' +
          'celui du service qui les détient.',
        properties: {
          versionFormat: {
            type: 'integer',
            description:
              'Version du format du document (pas de l’application). ' +
              'N’augmente que si une section est renommée ou retirée.',
          },
          genereLe: { type: 'string', format: 'date-time' },
          foyerId: { type: 'string', format: 'uuid' },
          situationFoyer: {
            type: 'object',
            description:
              'Situation et ressources du foyer, enfants, parents (retirés ' +
              'compris), préférences de notification effectives et traces de ' +
              'désabonnement.',
            properties: {
              situationCourante: { $ref: '#/components/schemas/LigneExport' },
              versionsRessources: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              correctionsRessources: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              enfants: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              parents: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              preferencesNotification: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              jetonsDesabonnement: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
            },
            required: [
              'situationCourante',
              'versionsRessources',
              'correctionsRessources',
              'enfants',
              'parents',
              'preferencesNotification',
              'jetonsDesabonnement',
            ],
          },
          gardeEtPlanning: {
            type: 'object',
            description:
              'Contrats d’accueil et tout ce qui leur est rattaché (avenants, ' +
              'corrections, plannings mensuels), et établissements déclarés.',
            properties: {
              contrats: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              etablissements: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
            },
            required: ['contrats', 'etablissements'],
          },
          communications: {
            type: 'object',
            description:
              'Semaines soumises à validation, preuves de ce qui a réellement ' +
              'été envoyé (au foyer, à chaque parent, à l’établissement) et ' +
              'boîte de réception in-app.',
            properties: {
              validationsHebdo: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              envoisRecapFoyer: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              envoisRecapParent: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              envoisEtablissement: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
              messagesInApp: {
                type: 'array',
                items: { $ref: '#/components/schemas/LigneExport' },
              },
            },
            required: [
              'validationsHebdo',
              'envoisRecapFoyer',
              'envoisRecapParent',
              'envoisEtablissement',
              'messagesInApp',
            ],
          },
        },
        required: [
          'versionFormat',
          'genereLe',
          'foyerId',
          'situationFoyer',
          'gardeEtPlanning',
          'communications',
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
          /**
           * Première année d'inscription de l'enfant à l'association ABCM
           * (frais de 1ʳᵉ inscription, doc 02 §4.4 — chantier Coûts lot 4a).
           * Champ additif OPTIONNEL (rétro-compat) ; absent ⇒ `false`.
           * Toujours `false` pour un contrat CRECHE_PSU.
           */
          premiereInscription: { type: 'boolean' },
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
      ContratVersionVue: {
        type: 'object',
        description:
          'Version datée d’un contrat de garde (SFD 30, versionnement à date ' +
          'd’effet) : paramètres versionnés + période dérivée (`du`/`au`, `au` ' +
          'null si ouverte) + traçabilité. Les paramètres mode-spécifiques ' +
          '(`semaineType`/`semaineAbcm`) sont relayés tels quels.',
        additionalProperties: true,
        properties: {
          id: { type: 'string', format: 'uuid' },
          contratId: { type: 'string', format: 'uuid' },
          mode: { type: 'string' },
          dateEffet: { type: 'string', format: 'date' },
          du: { type: 'string', format: 'date' },
          au: { type: ['string', 'null'], format: 'date' },
          heuresAnnuellesContractualisees: { type: ['number', 'null'] },
          nbMensualites: { type: ['integer', 'null'] },
          saisiLe: { type: 'string', format: 'date-time' },
          motif: { type: ['string', 'null'] },
        },
        required: [
          'id',
          'contratId',
          'mode',
          'dateEffet',
          'du',
          'au',
          'saisiLe',
        ],
      },
      ImpactVersionVue: {
        type: 'object',
        description:
          'Aperçu d’impact d’une version : les mois (YYYY-MM) qui seraient ' +
          'recalculés par une correction, du plus ancien au plus récent, et — ' +
          'parmi eux — ceux déjà communiqués à un établissement (récap envoyé), ' +
          'pour l’avertissement « déjà envoyé » (US-30-05).',
        properties: {
          versionId: { type: 'string', format: 'uuid' },
          moisCouverts: {
            type: 'array',
            items: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          },
          moisCommuniques: {
            type: 'array',
            description:
              'Sous-ensemble de `moisCouverts` dont le récap a déjà été envoyé ' +
              'à un établissement (croisé avec le suivi des envois). Vide si ' +
              'aucun, ou si le suivi est momentanément indisponible.',
            items: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
          },
        },
        required: ['versionId', 'moisCouverts', 'moisCommuniques'],
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
                grilleValideDu: {
                  type: 'string',
                  format: 'date',
                  description:
                    'Date d’effet (YYYY-MM-DD) du tarif résolu pour ce mois ' +
                    '(grille ABCM ou barème PSU) — « Calculé avec » (US-30-04). ' +
                    'Optionnel (absent si non résolu, ex. frais fixes).',
                },
                contratValideDu: {
                  type: 'string',
                  format: 'date',
                  description:
                    'Date de début (YYYY-MM-DD) du contrat ayant servi au ' +
                    'calcul — « contrat du … » (US-30-04). Optionnel.',
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
      GrilleAbcmVue: {
        type: 'object',
        description:
          'Ligne de grille ABCM publiée pour une tranche, versionnée par ' +
          'période (SFD 30, US-30-02). Montants en CENTIMES entiers (fidèles à ' +
          '`Money`). `valideAu` null = période ouverte ; `cantinePartGardeCentimes` ' +
          'null quand la part « garde » n’est pas connue (surtout hors T3).',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tranche: { type: 'integer', minimum: 1, maximum: 3 },
          valideDu: { type: 'string', format: 'date' },
          valideAu: { type: ['string', 'null'], format: 'date' },
          cantineTotalCentimes: { type: 'integer' },
          cantinePartGardeCentimes: { type: ['integer', 'null'] },
          periMatinCentimes: { type: 'integer' },
          periSoirCentimes: { type: 'integer' },
          alshJourneeCompleteCentimes: { type: 'integer' },
          alshDemiJourneeCentimes: { type: 'integer' },
          alshRepasCentimes: { type: 'integer' },
        },
        required: [
          'id',
          'tranche',
          'valideDu',
          'valideAu',
          'cantineTotalCentimes',
          'cantinePartGardeCentimes',
          'periMatinCentimes',
          'periSoirCentimes',
          'alshJourneeCompleteCentimes',
          'alshDemiJourneeCentimes',
          'alshRepasCentimes',
        ],
      },
      HealthCheckResult: {
        type: 'object',
        description:
          'Résultat de sonde `@nestjs/terminus` : `status` global + un objet ' +
          'par indicateur. `info` (indicateurs `up`) et `error` (indicateurs ' +
          '`down`) sont des vues partielles de `details`, qui les contient tous ' +
          '— d’où le nom de l’amont fautif dans le corps d’un 503 (lot B3).',
        properties: {
          status: { type: 'string', enum: ['ok', 'error', 'shutting_down'] },
          info: { type: 'object', additionalProperties: true },
          error: { type: 'object', additionalProperties: true },
          details: { type: 'object', additionalProperties: true },
        },
        required: ['status', 'details'],
      },
      Probleme: {
        type: 'object',
        description:
          'Corps d’erreur unique de la passerelle — RFC 9457 « Problem Details ' +
          'for HTTP APIs », servi en `application/problem+json`. `type`, ' +
          '`title`, `status`, `detail` et `instance` sont les membres ' +
          'normalisés ; `code` et `erreurs` sont deux membres d’EXTENSION ' +
          '(§3.2) que le produit utilise réellement. `title` résume le TYPE de ' +
          'problème et reste stable ; `detail` décrit CETTE occurrence. Seuls ' +
          '`type`/`code`/`status` sont faits pour être testés — les deux autres ' +
          'sont écrits pour être lus. Source de vérité du registre de codes : ' +
          '`contracts-kernel/dto/probleme.ts`.',
        properties: {
          type: {
            type: 'string',
            description:
              'URI du type de problème. `about:blank` quand le statut HTTP ' +
              'suffit à le décrire ; sinon une URN dérivée du code métier ' +
              '(`urn:probleme:creche-planner:<code-en-minuscules-tiretés>`).',
          },
          title: { type: 'string' },
          status: { type: 'integer' },
          detail: { type: 'string' },
          instance: {
            type: 'string',
            description: 'URI de la requête qui a produit ce problème.',
          },
          code: {
            type: 'string',
            description:
              'Code métier distinguant la CAUSE d’un statut qui, seul, n’en ' +
              'dit rien — trois 409 différents ne se traitent pas de la même ' +
              'façon à l’écran. Absent quand le statut se suffit.',
            enum: [
              'EMAIL_DEJA_UTILISE',
              'PARENT_PRINCIPAL_EXISTANT',
              'DERNIER_PARENT_ACTIF',
              'PERIODE_CHEVAUCHANTE',
            ],
          },
          erreurs: {
            type: 'array',
            description:
              'Détail par champ d’une erreur de validation. Absent hors ' +
              'validation.',
            items: {
              type: 'object',
              properties: {
                champ: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['champ', 'message'],
            },
          },
        },
        required: ['type', 'title', 'status'],
      },
      ErreurClient: {
        type: 'object',
        description:
          'Plantage remonté par le navigateur (lot C7). `route` est le `pathname` ' +
          'SEUL — jamais la query : les liens profonds portent `?semaine=` et ' +
          '`?enfant=<prénom>`, données personnelles qui n’ont rien à faire dans un ' +
          'journal d’exploitation. Les bornes sont appliquées des deux côtés (le ' +
          'client tronque, la gateway refuse).',
        properties: {
          origine: {
            type: 'string',
            description:
              'Où l’erreur a été interceptée : frontière racine, frontière de ' +
              'route, chargement d’un module `lazy()`, `window.onerror`, ou ' +
              'promesse rejetée sans `catch`.',
            enum: ['application', 'route', 'chunk', 'globale', 'promesse'],
          },
          message: { type: 'string', minLength: 1, maxLength: 500 },
          route: { type: 'string', minLength: 1, maxLength: 300 },
          pile: { type: 'string', maxLength: 4000 },
          composant: {
            type: 'string',
            maxLength: 1000,
            description: 'Tête de la pile de composants React, si connue.',
          },
        },
        required: ['origine', 'message', 'route'],
      },
      NotificationAValiderVue: {
        type: 'object',
        description:
          'Une semaine à valider (indicateur in-app). `enfant`/`mode` sont ' +
          'AJOUTÉS par la gateway (jointure avec les contrats du foyer) pour ' +
          'distinguer N lignes d’une même semaine ; ils sont absents si le ' +
          'contrat n’est plus listé — l’écran retombe sur son libellé de repli.',
        properties: {
          contratId: { type: 'string', format: 'uuid' },
          foyerId: { type: 'string', format: 'uuid' },
          semaineIso: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          statut: {
            type: 'string',
            enum: ['A_VALIDER', 'VALIDEE', 'VALIDEE_AVEC_MODIFS'],
          },
          notifieeLe: { type: 'string', format: 'date-time' },
          enfant: { type: 'string' },
          mode: { type: 'string' },
        },
        required: [
          'contratId',
          'foyerId',
          'semaineIso',
          'statut',
          'notifieeLe',
        ],
      },
      DeltaModifs: {
        type: 'object',
        description:
          'Jours modifiés entre le snapshot de notification et la relecture. ' +
          '`avant`/`apres` sont relayés TELS QUELS par la gateway (forme ' +
          'propriété de svc-notifications) : volontairement non décrits ici.',
        properties: {
          jours: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string', format: 'date' },
                avant: {},
                apres: {},
              },
              required: ['date', 'avant', 'apres'],
            },
          },
        },
        required: ['jours'],
      },
      ValidationResultat: {
        type: 'object',
        description: 'Résultat de la validation d’une semaine par le parent.',
        properties: {
          contratId: { type: 'string', format: 'uuid' },
          semaineIso: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          statut: {
            type: 'string',
            enum: ['A_VALIDER', 'VALIDEE', 'VALIDEE_AVEC_MODIFS'],
          },
          deltaModifs: {
            oneOf: [
              { $ref: '#/components/schemas/DeltaModifs' },
              { type: 'null' },
            ],
          },
        },
        required: ['contratId', 'semaineIso', 'statut', 'deltaModifs'],
      },
      EnfantBrouillonVue: {
        type: 'object',
        description:
          'Un enfant du foyer concerné par le récap agrégé d’un établissement.',
        properties: {
          contratId: { type: 'string', format: 'uuid' },
          enfant: { type: 'string' },
          deltaModifs: { $ref: '#/components/schemas/DeltaModifs' },
        },
        required: ['contratId', 'enfant', 'deltaModifs'],
      },
      BrouillonEtablissementVue: {
        type: 'object',
        description:
          'Brouillon régénérable du mail AGRÉGÉ par établissement (un seul ' +
          'mail regroupant tous les enfants du foyer validés avec ' +
          'modifications). `routable: false` signale un établissement non ' +
          'joignable (sans e-mail ou archivé) — l’écran affiche l’avertissement ' +
          "au lieu du bouton d’envoi, et `destinataire` vaut alors `''`. " +
          '`dryRun` = un envoi réel serait neutralisé (bac à sable / allowlist).',
        properties: {
          foyerId: { type: 'string', format: 'uuid' },
          semaineIso: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          etablissementId: { type: 'string', format: 'uuid' },
          etablissementLibelle: { type: 'string' },
          destinataire: { type: 'string' },
          sujet: { type: 'string' },
          corps: { type: 'string' },
          texte: { type: 'string' },
          enfants: {
            type: 'array',
            items: { $ref: '#/components/schemas/EnfantBrouillonVue' },
          },
          routable: { type: 'boolean' },
          raisonNonRoutable: {
            type: ['string', 'null'],
            enum: ['SANS_EMAIL', 'ARCHIVE', null],
          },
          dryRun: { type: 'boolean' },
        },
        required: [
          'foyerId',
          'semaineIso',
          'etablissementId',
          'etablissementLibelle',
          'destinataire',
          'sujet',
          'corps',
          'texte',
          'enfants',
          'routable',
          'raisonNonRoutable',
          'dryRun',
        ],
      },
      EnvoiEtablissementResultat: {
        type: 'object',
        description:
          'Issue réelle de l’envoi du récap agrégé à un établissement ' +
          '(idempotent sur `(foyer, semaine, établissement)`).',
        properties: {
          foyerId: { type: 'string', format: 'uuid' },
          semaineIso: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          etablissementId: { type: 'string', format: 'uuid' },
          destinataire: { type: 'string' },
          statut: {
            type: 'string',
            enum: ['EN_COURS', 'ENVOYE', 'ECHEC', 'DRY_RUN'],
          },
          messageId: { type: ['string', 'null'] },
          erreur: { type: ['string', 'null'] },
          envoyeLe: { type: ['string', 'null'], format: 'date-time' },
        },
        required: [
          'foyerId',
          'semaineIso',
          'etablissementId',
          'destinataire',
          'statut',
          'messageId',
          'erreur',
          'envoyeLe',
        ],
      },
      SuiviRappelParent: {
        type: 'object',
        description:
          'Livraison du récap du mardi vers UN parent (ledger ' +
          '`envoi_recap_parent`).',
        properties: {
          email: { type: 'string' },
          statut: { type: 'string', enum: ['ENVOYE', 'DRY_RUN', 'ECHEC'] },
          envoyeLe: { type: ['string', 'null'], format: 'date-time' },
          essais: { type: 'integer' },
        },
        required: ['email', 'statut', 'envoyeLe', 'essais'],
      },
      SuiviRappelHebdo: {
        type: 'object',
        description:
          'État d’envoi du rappel hebdomadaire du mardi aux parents (agrégat ' +
          'foyer + détail par parent).',
        properties: {
          statut: {
            type: 'string',
            enum: ['A_ENVOYER', 'ENVOYE', 'DRY_RUN', 'ECHEC', 'ABANDONNE'],
          },
          envoyeLe: { type: ['string', 'null'], format: 'date-time' },
          erreur: { type: ['string', 'null'] },
          parents: {
            type: 'array',
            items: { $ref: '#/components/schemas/SuiviRappelParent' },
          },
        },
        required: ['statut', 'envoyeLe', 'erreur', 'parents'],
      },
      SuiviEnvoiEtablissement: {
        type: 'object',
        description:
          'État d’envoi du récap agrégé vers un établissement (ledger ' +
          '`envoi_etablissement`).',
        properties: {
          etablissementId: { type: 'string', format: 'uuid' },
          statut: {
            type: 'string',
            enum: ['EN_COURS', 'ENVOYE', 'ECHEC', 'DRY_RUN'],
          },
          envoyeLe: { type: ['string', 'null'], format: 'date-time' },
          erreur: { type: ['string', 'null'] },
          destinataire: { type: ['string', 'null'] },
        },
        required: [
          'etablissementId',
          'statut',
          'envoyeLe',
          'erreur',
          'destinataire',
        ],
      },
      SuiviEnvoisVue: {
        type: 'object',
        description:
          'Suivi PERSISTANT des envois d’une `(foyer, semaine)` (lecture ' +
          'seule) : `rappel` est `null` si la semaine n’a jamais été programmée.',
        properties: {
          foyerId: { type: 'string', format: 'uuid' },
          semaineIso: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          rappel: {
            oneOf: [
              { $ref: '#/components/schemas/SuiviRappelHebdo' },
              { type: 'null' },
            ],
          },
          etablissements: {
            type: 'array',
            items: { $ref: '#/components/schemas/SuiviEnvoiEtablissement' },
          },
        },
        required: ['foyerId', 'semaineIso', 'rappel', 'etablissements'],
      },
      EtablissementConcerneVue: {
        type: 'object',
        description:
          'Établissement réel concerné par la semaine (entité libre, ' +
          'svc-planification) — clé de groupement de l’écran d’édition.',
        properties: {
          etablissementId: { type: 'string', format: 'uuid' },
          libelle: { type: 'string' },
          preavisRegle: {
            oneOf: [
              { $ref: '#/components/schemas/PreavisRegle' },
              { type: 'null' },
            ],
          },
        },
        required: ['etablissementId', 'libelle', 'preavisRegle'],
      },
      ContratBesoinsVue: {
        type: 'object',
        description:
          'Un contrat actif de la semaine avec ses besoins datés. `besoins` ' +
          '(jour `YYYY-MM-DD` → catégories datées), `semaineType` et ' +
          '`semaineAbcm` sont RELAYÉS TELS QUELS depuis svc-planification : ' +
          'la gateway n’en valide que l’enveloppe, ils restent donc ouverts ici ' +
          '(même parti pris que le corps de `PUT …/plannings/{mois}`).',
        properties: {
          contratId: { type: 'string', format: 'uuid' },
          enfant: { type: 'string' },
          mode: {
            type: 'string',
            enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
          },
          etablissementId: { type: ['string', 'null'], format: 'uuid' },
          besoins: { type: 'object', additionalProperties: true },
          semaineType: { type: 'object', additionalProperties: true },
          semaineAbcm: { type: 'object', additionalProperties: true },
        },
        required: ['contratId', 'enfant', 'mode', 'etablissementId', 'besoins'],
      },
      SemaineBesoinsVue: {
        type: 'object',
        description:
          'Vue consolidée d’une semaine éditable du foyer (lecture seule) : ' +
          'les 7 jours, les établissements concernés et les contrats actifs ' +
          'avec leurs besoins datés. Ouverte depuis une notification A_VALIDER.',
        properties: {
          semaineIso: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          jours: {
            type: 'array',
            items: { type: 'string', format: 'date' },
          },
          etablissements: {
            type: 'array',
            items: { $ref: '#/components/schemas/EtablissementConcerneVue' },
          },
          contrats: {
            type: 'array',
            items: { $ref: '#/components/schemas/ContratBesoinsVue' },
          },
        },
        required: ['semaineIso', 'jours', 'etablissements', 'contrats'],
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Readiness de la gateway (toute la chaîne)',
        description:
          'La gateway n’est prête que si la READINESS de ses 5 amonts l’est — ' +
          'donc base + migrations + NATS de chacun (lot B3). Une sonde terminus ' +
          'par amont : le corps du 503 NOMME le service fautif. Consommée par la ' +
          'Porte 3 du déploiement et le smoke CI ; le heartbeat, lui, sonde la ' +
          'liveness (`/api/health/live`) — un amont dégradé ne doit pas faire ' +
          'taire le dead man’s switch.',
        security: [],
        responses: {
          '200': {
            description: 'La chaîne est prête.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthCheckResult' },
              },
            },
          },
          '503': {
            description:
              'Au moins un amont n’est pas prêt (nommé dans `error`/`details`).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthCheckResult' },
              },
            },
          },
        },
      },
    },
    '/api/health/live': {
      get: {
        summary: 'Liveness de la gateway (aucune dépendance)',
        description:
          'Le process répond. AUCUNE dépendance externe n’est sondée — c’est ' +
          'la contrainte des lots A6/A7 : les healthchecks compose et la sonde ' +
          'blackbox doivent rester ici, sinon un amont dégradé provoque des ' +
          'restarts en cascade.',
        security: [],
        responses: {
          '200': {
            description: 'Le process gateway est vivant.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthCheckResult' },
              },
            },
          },
        },
      },
    },
    '/api/referentiel/health': {
      get: {
        summary: 'Santé du référentiel vue à travers la gateway',
        description:
          'Parcours distribué de la DoD : `gateway → svc-referentiel → /health ' +
          '→ DB`, avec propagation du `traceparent`. Relaie la réponse du ' +
          'service après validation contre le contrat partagé.',
        security: [],
        responses: {
          '200': {
            description:
              'Réponse de santé du référentiel, relayée telle quelle.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthCheckResult' },
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
                  dateEffet: { type: 'string' },
                  motif: { type: 'string' },
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
      delete: {
        summary: 'Effacer un foyer et tout ce qui s’y rattache',
        description:
          'Supprime définitivement le foyer : ressources et leur historique ' +
          'versionné, journal de corrections, enfants, parents (y compris ' +
          'ceux déjà retirés), préférences de notification et jetons de ' +
          'désabonnement partent par cascade. L’effacement est ensuite ' +
          'propagé aux copies détenues par les autres services via ' +
          'l’événement `foyer.FoyerSupprime.v1` — contrats, plannings, ' +
          'prestations, messages envoyés et boîte de réception. La ' +
          'propagation est **asynchrone** : la réponse 204 acquitte la ' +
          'suppression de la source, pas encore celle des copies. Geste ' +
          'irréversible et non rejouable (un second appel répond 404).',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': { description: 'Foyer effacé (pas de contenu).' },
          '404': { description: 'Foyer inconnu.' },
        },
      },
    },
    '/api/v1/foyers/{id}/export': {
      get: {
        summary: 'Exporter les données personnelles du foyer',
        description:
          'Rassemble en un document JSON unique tout ce que les trois services ' +
          '**sources** détiennent sur le foyer : situation et ressources, garde ' +
          'et plannings, communications. Droit à la portabilité, tenu en ' +
          'démarche volontaire (ADR-0007). Le périmètre exporté est celui de la ' +
          'cascade d’effacement — ce qu’un effacement emporte, un export le rend ' +
          '— aux exclusions déclarées près : les copies projetées de ' +
          'svc-tarification (déjà présentes ici sous leur forme source), les ' +
          'files techniques, et le `jti` d’un jeton de désabonnement, qui est ' +
          'une capacité et non une donnée. Inventaire table par table dans ' +
          'docs/37-registre-des-traitements.md §6. Les colonnes de chaque ligne ' +
          'ne sont pas contractées : l’export suit les tables des services, et ' +
          'les décrire ici en figerait une troisième copie.',
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
            description: 'Document d’export des données personnelles du foyer.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ExportPortabiliteVue' },
              },
            },
          },
          '403': { description: 'Foyer hors du périmètre de l’appelant.' },
          '404': { description: 'Foyer inconnu.' },
        },
      },
    },
    '/api/v1/foyers/{id}/versions': {
      get: {
        summary: 'Historique des versions de ressources du foyer',
        description:
          'Liste les versions de ressources à date d’effet (SFD 30, DV-03), de ' +
          'la plus récente à la plus ancienne, avec la tranche applicable à chacune.',
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
            description: 'Versions de ressources du foyer.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/FoyerVersionVue' },
                },
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
    '/api/v1/erreurs-client': {
      post: {
        summary: 'Signaler un plantage survenu dans le navigateur',
        description:
          'Point de collecte MÊME-ORIGINE des erreurs client (lot C7). Le web y ' +
          'poste ce que ses frontières d’erreur React interceptent, ainsi que les ' +
          'exceptions hors rendu et les promesses rejetées. La gateway journalise ' +
          'la ligne (préfixe « PLANTAGE CLIENT »), corrélée par le `trace_id` de ' +
          'la requête ; rien n’est stocké et rien ne sort du domaine. Envoi ' +
          'best-effort et plafonné côté client ; la route reste soumise à la ' +
          'limitation de débit.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErreurClient' },
            },
          },
        },
        responses: {
          '204': { description: 'Signalement journalisé.' },
          '400': {
            description: 'Corps invalide (origine inconnue, bornes dépassées).',
          },
          '429': { description: 'Trop de requêtes (limitation de débit).' },
        },
      },
    },
    '/api/v1/notifications/a-valider': {
      get: {
        summary: 'Lister les semaines à valider d’un foyer',
        description:
          'Indicateur in-app de l’encart de validation. Chaque notification est ' +
          'ENRICHIE par la gateway (jointure avec les contrats du foyer) du ' +
          'prénom de l’enfant et du mode, pour distinguer N lignes d’une même ' +
          'semaine.',
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
            description: 'Semaines à valider du foyer.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    $ref: '#/components/schemas/NotificationAValiderVue',
                  },
                },
              },
            },
          },
          '400': { description: 'Paramètre « foyer » manquant.' },
        },
      },
    },
    '/api/v1/notifications/semaine/{foyerId}/{semaineIso}/besoins': {
      get: {
        summary: 'Vue hebdomadaire consolidée et éditable d’un foyer',
        description:
          'Agrège les contrats actifs sur la semaine (mêmes bornes que le ' +
          'scheduler de notification) et, pour chacun, ses besoins datés ' +
          'extraits des saisies mensuelles RÉELLES, rattachés à leur ' +
          'établissement par le lien explicite `contrat.etablissementId`. ' +
          'Lecture seule : l’écran d’édition écrit par ' +
          '`PUT /contrats/{id}/plannings/semaine/{semaineIso}`.',
        parameters: [
          {
            name: 'foyerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'semaineIso',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          },
        ],
        responses: {
          '200': {
            description: 'Semaine consolidée du foyer.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SemaineBesoinsVue' },
              },
            },
          },
          '400': { description: 'Semaine ISO invalide (format `YYYY-Www`).' },
        },
      },
    },
    '/api/v1/notifications/semaine/{foyerId}/{semaineIso}/envois': {
      get: {
        summary: 'Suivi des envois de la semaine (lecture seule)',
        parameters: [
          {
            name: 'foyerId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'semaineIso',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          },
        ],
        responses: {
          '200': {
            description:
              'Statut persistant du rappel aux parents et des récaps aux ' +
              'établissements.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SuiviEnvoisVue' },
              },
            },
          },
        },
      },
    },
    '/api/v1/notifications/semaine/{foyerId}/{semaineIso}/etablissements/{etablissementId}/brouillon':
      {
        get: {
          summary: 'Régénérer le brouillon du récap agrégé d’un établissement',
          description:
            'Relecture avant envoi : un seul mail par établissement regroupant ' +
            'tous les enfants du foyer dont la semaine a été validée avec ' +
            'modifications.',
          parameters: [
            {
              name: 'foyerId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'semaineIso',
              in: 'path',
              required: true,
              schema: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
            },
            {
              name: 'etablissementId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Brouillon régénéré.',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/BrouillonEtablissementVue',
                  },
                },
              },
            },
          },
        },
      },
    '/api/v1/notifications/validations/{contratId}/{semaineIso}': {
      post: {
        summary: 'Valider la semaine d’un contrat',
        parameters: [
          {
            name: 'contratId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'semaineIso',
            in: 'path',
            required: true,
            schema: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
          },
        ],
        responses: {
          '200': {
            description: 'Semaine validée (avec ou sans modifications).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationResultat' },
              },
            },
          },
        },
      },
    },
    '/api/v1/notifications/envois/etablissement': {
      post: {
        summary: 'Envoyer le récap agrégé à un établissement',
        description:
          'Action sortante RÉELLE (après relecture), idempotente sur ' +
          '`(foyer, semaine, établissement)`. `sujet`/`corps` portent le texte ' +
          'édité par le parent : les deux ensemble ou aucun des deux (400 sinon).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  foyerId: { type: 'string', format: 'uuid' },
                  semaineIso: { type: 'string', pattern: '^\\d{4}-W\\d{2}$' },
                  etablissementId: { type: 'string', format: 'uuid' },
                  sujet: { type: 'string', minLength: 1, maxLength: 300 },
                  corps: { type: 'string', minLength: 1, maxLength: 20000 },
                },
                required: ['foyerId', 'semaineIso', 'etablissementId'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Issue de l’envoi (réel ou neutralisé en dry-run).',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/EnvoiEtablissementResultat',
                },
              },
            },
          },
          '400': {
            description:
              'Corps invalide, ou `sujet`/`corps` fournis l’un sans l’autre.',
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
                  /**
                   * Première année d'inscription à l'association ABCM (lot 4a).
                   * OPTIONNEL, contrats ABCM uniquement (cantine/péri/ALSH) —
                   * jamais exposé/accepté pour CRECHE_PSU (le service élimine
                   * la clé) ; absent ⇒ `false`.
                   */
                  premiereInscription: { type: 'boolean' },
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
    '/api/v1/contrats/{id}': {
      put: {
        summary: 'Modifier les paramètres versionnés courants d’un contrat',
        description:
          'Correction NON destructive de la version courante (SFD 30 lot 4) : ' +
          'les plannings saisis survivent. L’URL BFF est restée stable (le web ' +
          '« durcit » un contrat par ce chemin) mais le relais vise ' +
          '`PUT /contrats/{id}/version-courante` en amont ; l’identité du ' +
          'contrat (enfant, mode, établissement) n’est PAS versionnable.',
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
                  'Mêmes champs que la création (le BFF réutilise le schéma) ; ' +
                  'les paramètres mode-spécifiques passent en ' +
                  'additionalProperties et sont validés par svc-planification.',
                additionalProperties: true,
                properties: {
                  mode: {
                    type: 'string',
                    enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
                  },
                  foyerId: { type: 'string', format: 'uuid' },
                  enfant: { type: 'string' },
                  enfantId: { type: 'string', format: 'uuid' },
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
          '200': {
            description: 'Contrat modifié.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ContratVue' },
              },
            },
          },
          '404': { description: 'Contrat inconnu.' },
        },
      },
      delete: {
        summary: 'Supprimer un contrat de garde',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '204': { description: 'Contrat supprimé (pas de contenu).' },
          '404': { description: 'Contrat inconnu.' },
        },
      },
    },
    '/api/v1/contrats/{id}/versions': {
      get: {
        summary: 'Historique des versions d’un contrat',
        description:
          'Versions datées du contrat (SFD 30, US-30-04/06), de la plus récente ' +
          'à la plus ancienne, avec leur période dérivée.',
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
            description: 'Versions du contrat.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ContratVersionVue' },
                },
              },
            },
          },
          '404': { description: 'Contrat inconnu.' },
        },
      },
      post: {
        summary: 'Créer un avenant (nouvelle version à date d’effet)',
        description:
          'Insère une nouvelle version du contrat à `dateEffet` (SFD 30, ' +
          'US-30-01) ; la version précédente est close implicitement la veille. ' +
          'Les plannings mensuels saisis SURVIVENT (aucune cascade). Seuls les ' +
          'paramètres versionnés sont acceptés — l’identité (mode, enfant, ' +
          'établissement) ne change pas par avenant (H6).',
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
                  'Paramètres versionnés du mode (semaineType / semaineAbcm, ' +
                  'heuresAnnuellesContractualisees, nbMensualites, motif) laissés ' +
                  'ouverts via additionalProperties (validation profonde ' +
                  'svc-planification).',
                additionalProperties: true,
                properties: {
                  mode: {
                    type: 'string',
                    enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
                  },
                  dateEffet: { type: 'string', format: 'date' },
                  motif: { type: 'string' },
                },
                required: ['mode', 'dateEffet'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Avenant créé (contrat à jour renvoyé).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ContratVue' },
              },
            },
          },
          '400': {
            description:
              'Date d’effet antérieure au début du contrat, mode différent ' +
              '(l’identité n’est pas versionnée) ou paramètres invalides.',
          },
          '404': { description: 'Contrat inconnu.' },
          '409': {
            description: 'Une version existe déjà à cette date d’effet.',
          },
        },
      },
    },
    '/api/v1/contrats/{id}/versions/{versionId}': {
      put: {
        summary: 'Corriger une version existante (geste rétroactif tracé)',
        description:
          'Écrase les paramètres versionnés d’une version SANS déplacer sa date ' +
          'd’effet (SFD 30, US-30-05). La correction est journalisée ' +
          '(avant/après + motif) côté service. Consulter l’aperçu d’impact avant ' +
          'de corriger une version passée.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'versionId',
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
                  'Paramètres versionnés du mode (mêmes champs que l’avenant, ' +
                  'sans dateEffet).',
                additionalProperties: true,
                properties: {
                  mode: {
                    type: 'string',
                    enum: ['CRECHE_PSU', 'CANTINE', 'PERISCOLAIRE', 'ALSH'],
                  },
                  motif: { type: 'string' },
                },
                required: ['mode'],
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Version corrigée (contrat à jour renvoyé).',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ContratVue' },
              },
            },
          },
          '400': {
            description: 'Mode différent ou paramètres invalides.',
          },
          '404': { description: 'Contrat ou version inconnus.' },
        },
      },
    },
    '/api/v1/contrats/{id}/versions/{versionId}/impact': {
      get: {
        summary: 'Aperçu d’impact d’une version (mois recalculés)',
        description:
          'Liste les mois couverts par la période de la version (plafonnée à la ' +
          'vie du contrat) — les mois dont les coûts seraient recalculés par une ' +
          'correction. Lecture seule.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'versionId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Mois couverts par la version.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ImpactVersionVue' },
              },
            },
          },
          '404': { description: 'Contrat ou version inconnus.' },
        },
      },
    },
    '/api/v1/contrats/{id}/plannings/{mois}': {
      get: {
        summary: 'Lire la saisie de planning d’un mois (réelle ou simulée)',
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
        responses: {
          '200': {
            description:
              'La saisie enregistrée du mois, ou `null` si aucune saisie.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    saisie: {
                      type: ['object', 'null'],
                      description:
                        'Saisie mensuelle relayée telle quelle (même forme ' +
                        'ouverte que le corps du PUT).',
                      additionalProperties: true,
                    },
                  },
                  required: ['saisie'],
                },
              },
            },
          },
        },
      },
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
    '/api/v1/contrats/{id}/plannings/semaine/{semaineIso}': {
      put: {
        summary: 'Éditer les besoins d’UNE semaine (réels ou simulés)',
        description:
          'Édite les catégories DATÉES d’une seule semaine sans écraser le ' +
          'reste du/des mois recouverts : la fusion read-modify-write est faite ' +
          'par svc-planification. Les scalaires mensuels ' +
          '(`complementMinutes`, `pai`) sont hors périmètre de cette route.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'semaineIso',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              pattern: '^\\d{4}-W(0[1-9]|[1-4]\\d|5[0-3])$',
            },
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
                  'Besoins datés de la semaine. Structure laissée ouverte via ' +
                  'additionalProperties ; champs usuels : joursSupplementaires, ' +
                  'absences, ajustements, exceptions, joursAlsh.',
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          '204': { description: 'Besoins enregistrés (pas de contenu).' },
          '400': { description: 'Semaine ISO invalide (format `YYYY-Www`).' },
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
    '/api/v1/referentiel/grilles': {
      get: {
        summary: 'Lister les grilles ABCM publiées (écran Tarifs)',
        description:
          'Toutes les grilles ABCM du catalogue (SFD 30, US-30-02), une ligne ' +
          'par tranche et par période, montants en centimes. Le catalogue est ' +
          'global (aucun scoping foyer). Le front regroupe par période et affiche ' +
          'chaque grille « en préparation / active / passée ».',
        responses: {
          '200': {
            description: 'Grilles publiées (liste vide si aucune).',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/GrilleAbcmVue' },
                },
              },
            },
          },
        },
      },
      post: {
        summary: 'Publier une grille ABCM complète (période + tranches)',
        description:
          'Saisit la grille d’une nouvelle année (SFD 30, US-30-02) : une période ' +
          'de validité et une ligne par tranche (montants en EUROS, convertis en ' +
          'centimes côté service). Route globale (aucun scoping foyer). Publication ' +
          'ATOMIQUE : une période chevauchant une grille existante de la même ' +
          'tranche est refusée sans aucune écriture (409).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Grille à publier : bornes de période (`valideAu` null ou absent ' +
                  '= ouverte) et lignes de tranche (montants EUROS).',
                properties: {
                  valideDu: { type: 'string', format: 'date' },
                  valideAu: { type: ['string', 'null'], format: 'date' },
                  tranches: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: {
                        tranche: { type: 'integer', minimum: 1, maximum: 3 },
                        cantineTotal: { type: 'number', minimum: 0 },
                        cantinePartGarde: { type: 'number', minimum: 0 },
                        periMatin: { type: 'number', minimum: 0 },
                        periSoir: { type: 'number', minimum: 0 },
                        alshJourneeComplete: { type: 'number', minimum: 0 },
                        alshDemiJournee: { type: 'number', minimum: 0 },
                        alshRepas: { type: 'number', minimum: 0 },
                      },
                      required: [
                        'tranche',
                        'cantineTotal',
                        'periMatin',
                        'periSoir',
                        'alshJourneeComplete',
                        'alshDemiJournee',
                        'alshRepas',
                      ],
                    },
                  },
                },
                required: ['valideDu', 'tranches'],
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Grille publiée (les lignes créées, une par tranche).',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/GrilleAbcmVue' },
                },
              },
            },
          },
          '400': { description: 'Données invalides (tranche/période).' },
          '409': {
            description:
              'La période chevauche une grille existante de la même tranche ' +
              '(rien n’est écrit).',
          },
        },
      },
    },
    '/api/v1/referentiel/baremes/psu': {
      post: {
        summary: 'Publier un barème PSU versionné',
        description:
          'Publie un barème PSU (taux CNAF par nombre d’enfants + bornes en ' +
          'EUROS) sur une période (SFD 30). Route globale. 409 si la période ' +
          'chevauche un barème existant (rien d’écrit).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  valideDu: { type: 'string', format: 'date' },
                  valideAu: { type: ['string', 'null'], format: 'date' },
                  taux: {
                    type: 'object',
                    additionalProperties: { type: 'number' },
                  },
                  plancher: { type: 'number', minimum: 0 },
                  plafond: { type: 'number', minimum: 0 },
                },
                required: ['valideDu', 'taux'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Barème PSU publié.' },
          '400': { description: 'Données invalides.' },
          '409': { description: 'Période chevauchante (rien d’écrit).' },
        },
      },
    },
    '/api/v1/referentiel/baremes/tranches': {
      post: {
        summary: 'Publier un barème de seuils de tranche RFR versionné',
        description:
          'Publie les seuils de tranche RFR (liste ordonnée `[{niveau, rfrMax|' +
          'null}]`, bornes hautes inclusives en EUROS) sur une période (SFD 30, ' +
          'DV-03). Route globale. 409 si période chevauchante (rien d’écrit).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  valideDu: { type: 'string', format: 'date' },
                  valideAu: { type: ['string', 'null'], format: 'date' },
                  seuils: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: {
                        niveau: { type: 'integer', minimum: 1 },
                        rfrMax: { type: ['number', 'null'], minimum: 0 },
                      },
                      required: ['niveau', 'rfrMax'],
                    },
                  },
                },
                required: ['valideDu', 'seuils'],
              },
            },
          },
        },
        responses: {
          '201': { description: 'Barème de tranches publié.' },
          '400': { description: 'Données invalides.' },
          '409': { description: 'Période chevauchante (rien d’écrit).' },
        },
      },
    },
  },
} as const;

/**
 * Attache `application/problem+json` à **toute réponse 4xx/5xx qui ne déclare
 * pas déjà son propre corps** (lot 4 des standards, `AM-37`).
 *
 * Dérivation plutôt que recopie : les cinquante réponses d'erreur du document
 * porteraient sinon cinquante fois le même bloc `content`, que rien ne
 * garderait aligné — le motif de miroir que CONVENTIONS §4 interdit. La règle
 * tient en une phrase et n'a besoin d'aucune liste d'exceptions à tenir : une
 * réponse qui **porte déjà de la donnée** garde la sienne. C'est le cas du 503
 * de `/api/health`, dont le corps EST le rapport de santé nommant l'amont
 * tombé — le pendant contractuel exact de `@FormatErreurNatif()` côté
 * passerelle.
 *
 * Le type de retour reste celui du document écrit : aucun consommateur ne type
 * un corps d'erreur, et les rares accès statiques visent `components.schemas`.
 * Les types du front, eux, sont générés depuis la valeur **exécutée** — le
 * `content` ajouté ici apparaît donc dans `openapi-types.gen.ts`, et le job
 * `openapi-types-drift` échouerait si cette dérivation cessait de tourner.
 *
 * ⚠️ Le type de média est écrit en clair : ce fichier ne peut rien importer (il
 * est lu par `scripts/generate-openapi-types.mjs` via le type-stripping de Node,
 * qui ne résoudrait pas un import de `.ts`). L'accord avec
 * `MEDIA_TYPE_PROBLEME` est vérifié par la porte `pnpm problemes`.
 */
export function avecProblemes<T>(document: T): T {
  const copie = structuredClone(document) as {
    paths: Record<
      string,
      Record<string, { responses?: Record<string, unknown> }>
    >;
  };
  for (const item of Object.values(copie.paths)) {
    for (const operation of Object.values(item)) {
      for (const [statut, reponse] of Object.entries(
        operation.responses ?? {},
      )) {
        if (!/^[45]\d\d$/.test(statut)) continue;
        const corps = reponse as { content?: unknown };
        if (corps.content !== undefined) continue;
        corps.content = {
          'application/problem+json': {
            schema: { $ref: '#/components/schemas/Probleme' },
          },
        };
      }
    }
  }
  return copie as T;
}

/**
 * Document servi par `GET /api/openapi.json` : le document écrit à la main,
 * augmenté du corps d'erreur commun (cf. `avecProblemes`).
 */
export const gatewayOpenApiDocument = avecProblemes(documentEcrit);

export type GatewayOpenApiDocument = typeof gatewayOpenApiDocument;
