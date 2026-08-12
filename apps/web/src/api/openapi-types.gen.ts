// ⚠️ FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Source : gatewayOpenApiDocument (libs/contracts/kernel/src/lib/openapi/gateway.openapi.ts).
// Régénérer : pnpm nx run web:generate-types (scripts/generate-openapi-types.mjs).
// Garde CI : job openapi-types-drift (régénération + diff vide exigé).

export interface paths {
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness de la gateway (toute la chaîne)
         * @description La gateway n’est prête que si la READINESS de ses 5 amonts l’est — donc base + migrations + NATS de chacun (lot B3). Une sonde terminus par amont : le corps du 503 NOMME le service fautif. Consommée par la Porte 3 du déploiement et le smoke CI ; le heartbeat, lui, sonde la liveness (`/api/health/live`) — un amont dégradé ne doit pas faire taire le dead man’s switch.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description La chaîne est prête. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HealthCheckResult"];
                    };
                };
                /** @description Au moins un amont n’est pas prêt (nommé dans `error`/`details`). */
                503: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HealthCheckResult"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liveness de la gateway (aucune dépendance)
         * @description Le process répond. AUCUNE dépendance externe n’est sondée — c’est la contrainte des lots A6/A7 : les healthchecks compose et la sonde blackbox doivent rester ici, sinon un amont dégradé provoque des restarts en cascade.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Le process gateway est vivant. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HealthCheckResult"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/referentiel/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Santé du référentiel vue à travers la gateway
         * @description Parcours distribué de la DoD : `gateway → svc-referentiel → /health → DB`, avec propagation du `traceparent`. Relaie la réponse du service après validation contre le contrat partagé.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Réponse de santé du référentiel, relayée telle quelle. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["HealthCheckResult"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/openapi.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Spécification OpenAPI de la gateway */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Le document OpenAPI de la gateway. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": Record<string, never>;
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lister les foyers existants
         * @description Découverte du foyer déjà configuré (accueil sans foyer mémorisé côté client). Liste triée par date de création croissante.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Foyers existants (liste vide si aucun). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FoyerVue"][];
                    };
                };
            };
        };
        put?: never;
        /**
         * Créer un foyer et ses enfants (orchestration)
         * @description Self-service de la première création (P5). Une identité non-admin qui possède déjà un foyer reçoit 409 (create-once) ; l’admin crée sans limite, une identité absente reste en mode hérité. Le créateur non-admin est rattaché comme parent du foyer.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        ressourcesMensuelles: number;
                        rfr: number;
                        nbEnfantsACharge: number;
                        nbParts: number;
                        enfants: {
                            prenom: string;
                            /** Format: date */
                            dateNaissance: string;
                        }[];
                        /** @description Parents rattachés à la création (optionnel ; défaut []). */
                        parents?: {
                            /** Format: email */
                            email: string;
                            prenom?: string;
                            nom?: string;
                            principal?: boolean;
                            ordre?: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Foyer créé avec ses enfants. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            foyer: components["schemas"]["FoyerVue"];
                            enfants: components["schemas"]["EnfantVue"][];
                            parents: components["schemas"]["ParentVue"][];
                        };
                    };
                };
                /** @description Création refusée : l’utilisateur (non-admin identifié) possède déjà un foyer. Orienter vers l’édition de son foyer. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lire un foyer et ses enfants */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Foyer et ses enfants. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            foyer: components["schemas"]["FoyerVue"];
                            enfants: components["schemas"]["EnfantVue"][];
                            parents: components["schemas"]["ParentVue"][];
                        };
                    };
                };
                /** @description Foyer inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        /**
         * Éditer les scalaires d’un foyer
         * @description Met à jour les finances/RFR/parts/nb enfants à charge d’un foyer existant. Les enfants et parents se gèrent via leurs propres routes.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        ressourcesMensuelles: number;
                        rfr: number;
                        nbEnfantsACharge: number;
                        nbParts: number;
                        dateEffet?: string;
                        motif?: string;
                    };
                };
            };
            responses: {
                /** @description Foyer mis à jour. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FoyerVue"];
                    };
                };
                /** @description Foyer inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        /**
         * Effacer un foyer et tout ce qui s’y rattache
         * @description Supprime définitivement le foyer : ressources et leur historique versionné, journal de corrections, enfants, parents (y compris ceux déjà retirés), préférences de notification et jetons de désabonnement partent par cascade. L’effacement est ensuite propagé aux copies détenues par les autres services via l’événement `foyer.FoyerSupprime.v1` — contrats, plannings, prestations, messages envoyés et boîte de réception. La propagation est **asynchrone** : la réponse 204 acquitte la suppression de la source, pas encore celle des copies. Geste irréversible et non rejouable (un second appel répond 404).
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Foyer effacé (pas de contenu). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Foyer inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Exporter les données personnelles du foyer
         * @description Rassemble en un document JSON unique tout ce que les trois services **sources** détiennent sur le foyer : situation et ressources, garde et plannings, communications. Droit à la portabilité, tenu en démarche volontaire (ADR-0007). Le périmètre exporté est celui de la cascade d’effacement — ce qu’un effacement emporte, un export le rend — aux exclusions déclarées près : les copies projetées de svc-tarification (déjà présentes ici sous leur forme source), les files techniques, et le `jti` d’un jeton de désabonnement, qui est une capacité et non une donnée. Inventaire table par table dans docs/37-registre-des-traitements.md §6. Les colonnes de chaque ligne ne sont pas contractées : l’export suit les tables des services, et les décrire ici en figerait une troisième copie.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Document d’export des données personnelles du foyer. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ExportPortabiliteVue"];
                    };
                };
                /** @description Foyer hors du périmètre de l’appelant. */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Foyer inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Historique des versions de ressources du foyer
         * @description Liste les versions de ressources à date d’effet (SFD 30, DV-03), de la plus récente à la plus ancienne, avec la tranche applicable à chacune.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Versions de ressources du foyer. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FoyerVersionVue"][];
                    };
                };
                /** @description Foyer inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{id}/enfants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rattacher un enfant au foyer
         * @description Ajoute un enfant à un foyer existant (prénom + date de naissance). L’édition et la suppression d’un enfant se font via /foyers/{id}/enfants/{enfantId}.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        prenom: string;
                        /** Format: date */
                        dateNaissance: string;
                    };
                };
            };
            responses: {
                /** @description Enfant rattaché. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["EnfantVue"];
                    };
                };
                /** @description Foyer inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{id}/enfants/{enfantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Éditer un enfant (prénom/date)
         * @description Met à jour un enfant du foyer. Le renommage se propage aux contrats existants : svc-planification référence l’enfant par `enfantId` et rafraîchit son prénom dénormalisé à la réception de `foyer.EnfantModifie` (projection NATS).
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    enfantId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        prenom: string;
                        /** Format: date */
                        dateNaissance: string;
                    };
                };
            };
            responses: {
                /** @description Enfant mis à jour. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["EnfantVue"];
                    };
                };
                /** @description Enfant inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        /**
         * Retirer un enfant (hard delete)
         * @description Supprime un enfant du foyer. Sans effet sur les contrats existants (leur `enfantId` pointe alors vers un enfant disparu ; leur suppression reste un geste explicite de l’utilisateur).
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    enfantId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Enfant retiré (pas de contenu). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Enfant inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{id}/parents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lister les parents actifs d’un foyer */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Parents actifs du foyer (liste vide si aucun). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ParentVue"][];
                    };
                };
            };
        };
        put?: never;
        /** Rattacher un parent au foyer */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: email */
                        email: string;
                        prenom?: string;
                        nom?: string;
                        principal?: boolean;
                        ordre?: number;
                    };
                };
            };
            responses: {
                /** @description Parent rattaché. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ParentVue"];
                    };
                };
                /** @description Adresse e-mail déjà utilisée. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{id}/parents/{parentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Éditer un parent (champs fournis uniquement) */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    parentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: email */
                        email?: string;
                        prenom?: string | null;
                        nom?: string | null;
                        principal?: boolean;
                        ordre?: number;
                        actif?: boolean;
                    };
                };
            };
            responses: {
                /** @description Parent mis à jour. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ParentVue"];
                    };
                };
                /** @description Parent inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Adresse e-mail déjà utilisée. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        /** Retirer un parent (soft-delete) */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    parentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Parent retiré (pas de contenu). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Parent inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/moi": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Identité courante et droits (admin, foyers autorisés)
         * @description Renvoie l’identité Cloudflare Access du client (e-mail vérifié ou null), son statut admin et l’ensemble des foyers dont il est parent actif. Le front s’en sert pour gater l’écran de création (admin) et borner la sélection de foyer (0/1/N).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Identité courante et droits. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MoiVue"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/moi/profil": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Mon profil (parent connecté) et mes préférences de notification
         * @description Résout la ligne parent du client à partir de son e-mail vérifié (identité Cloudflare Access) et renvoie ses préférences de notification effectives. La résolution est côté serveur : le client ne fournit jamais de parentId (il ne voit que « son » profil).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Profil du parent connecté et ses préférences. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["MonProfilVue"];
                    };
                };
                /** @description Aucune identité établie. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Aucun profil parent pour cette identité (aucun foyer, ou foyer sans la ligne parent correspondante). */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/moi/preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Mettre à jour mes préférences de notification
         * @description Met à jour les préférences (type × canal) du parent connecté. Défense en profondeur : le parentId ciblé est résolu depuis l’identité (la ligne dont l’e-mail = moi.email), jamais fourni par le client — un parent ne modifie que SA ligne. Refus (400) si la combinaison coupe tous les canaux d’un type de service (invariant ≥ 1 canal actif).
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        preferences: {
                            /** @enum {string} */
                            typeNotification: "VALIDATION_HEBDO" | "RECAP_SERVICE";
                            /** @enum {string} */
                            canal: "EMAIL" | "IN_APP";
                            actif: boolean;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Préférences mises à jour (état effectif renvoyé). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PreferenceVue"][];
                    };
                };
                /** @description Combinaison invalide (dernier canal d’un type de service coupé). */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Aucune identité établie. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Aucun profil parent pour cette identité. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/moi/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Mon inbox in-app (notifications + compteur de non-lus)
         * @description Inbox in-app du parent connecté (PR6, §5.6) : ses notifications récentes et le nombre de non-lus (cloche). Le parentId est résolu côté serveur depuis l’identité (le client ne voit que « ses » notifications). Journal informationnel : ne duplique pas l’action « Valider » (portée par /notifications/a-valider).
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Inbox du parent connecté. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["InboxVue"];
                    };
                };
                /** @description Aucune identité établie. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Aucun profil parent pour cette identité. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/moi/notifications/{id}/lu": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Marquer une de mes notifications comme lue
         * @description Accusé de lecture d’une notification du parent connecté (idempotent). Défense en profondeur : le parentId est résolu depuis l’identité et scope l’écriture — un parent ne marque que SA notification (404 si l’id est inconnu ou appartient à un autre parent).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Notification marquée comme lue (état renvoyé). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotificationInApp"];
                    };
                };
                /** @description Aucune identité établie. */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Notification inconnue (ou appartenant à un autre parent), ou aucun profil parent pour cette identité. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/desabonnement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Désabonnement one-click (RFC 8058)
         * @description Endpoint PUBLIC (sans session) de désabonnement one-click. Ciblé par l’en-tête List-Unsubscribe des e-mails (POST direct du client de messagerie). Le seul paramètre est un jeton signé opaque (aucun e-mail ni identifiant ⇒ pas d’énumération) ; l’usage est one-shot. Toujours soumis à la limitation de débit.
         */
        post: {
            parameters: {
                query: {
                    /** @description Jeton de désabonnement signé (lié à parent/type/canal). */
                    token: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Désabonnement enregistré (canal e-mail coupé). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Lien invalide, expiré ou déjà utilisé (message générique). */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Dernier canal actif d’un type de service : ce canal ne peut être coupé (gérez vos préférences). */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Trop de requêtes (limitation de débit). */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/erreurs-client": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Signaler un plantage survenu dans le navigateur
         * @description Point de collecte MÊME-ORIGINE des erreurs client (lot C7). Le web y poste ce que ses frontières d’erreur React interceptent, ainsi que les exceptions hors rendu et les promesses rejetées. La gateway journalise la ligne (préfixe « PLANTAGE CLIENT »), corrélée par le `trace_id` de la requête ; rien n’est stocké et rien ne sort du domaine. Envoi best-effort et plafonné côté client ; la route reste soumise à la limitation de débit.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["ErreurClient"];
                };
            };
            responses: {
                /** @description Signalement journalisé. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Corps invalide (origine inconnue, bornes dépassées). */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Trop de requêtes (limitation de débit). */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/a-valider": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lister les semaines à valider d’un foyer
         * @description Indicateur in-app de l’encart de validation. Chaque notification est ENRICHIE par la gateway (jointure avec les contrats du foyer) du prénom de l’enfant et du mode, pour distinguer N lignes d’une même semaine.
         */
        get: {
            parameters: {
                query: {
                    foyer: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Semaines à valider du foyer. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["NotificationAValiderVue"][];
                    };
                };
                /** @description Paramètre « foyer » manquant. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/semaine/{foyerId}/{semaineIso}/besoins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Vue hebdomadaire consolidée et éditable d’un foyer
         * @description Agrège les contrats actifs sur la semaine (mêmes bornes que le scheduler de notification) et, pour chacun, ses besoins datés extraits des saisies mensuelles RÉELLES, rattachés à leur établissement par le lien explicite `contrat.etablissementId`. Lecture seule : l’écran d’édition écrit par `PUT /contrats/{id}/plannings/semaine/{semaineIso}`.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    foyerId: string;
                    semaineIso: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Semaine consolidée du foyer. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SemaineBesoinsVue"];
                    };
                };
                /** @description Semaine ISO invalide (format `YYYY-Www`). */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/semaine/{foyerId}/{semaineIso}/envois": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Suivi des envois de la semaine (lecture seule) */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    foyerId: string;
                    semaineIso: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Statut persistant du rappel aux parents et des récaps aux établissements. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["SuiviEnvoisVue"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/semaine/{foyerId}/{semaineIso}/etablissements/{etablissementId}/brouillon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Régénérer le brouillon du récap agrégé d’un établissement
         * @description Relecture avant envoi : un seul mail par établissement regroupant tous les enfants du foyer dont la semaine a été validée avec modifications.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    foyerId: string;
                    semaineIso: string;
                    etablissementId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Brouillon régénéré. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["BrouillonEtablissementVue"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/validations/{contratId}/{semaineIso}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Valider la semaine d’un contrat */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    contratId: string;
                    semaineIso: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Semaine validée (avec ou sans modifications). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ValidationResultat"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/envois/etablissement": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Envoyer le récap agrégé à un établissement
         * @description Action sortante RÉELLE (après relecture), idempotente sur `(foyer, semaine, établissement)`. `sujet`/`corps` portent le texte édité par le parent : les deux ensemble ou aucun des deux (400 sinon).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        foyerId: string;
                        semaineIso: string;
                        /** Format: uuid */
                        etablissementId: string;
                        sujet?: string;
                        corps?: string;
                    };
                };
            };
            responses: {
                /** @description Issue de l’envoi (réel ou neutralisé en dry-run). */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["EnvoiEtablissementResultat"];
                    };
                };
                /** @description Corps invalide, ou `sujet`/`corps` fournis l’un sans l’autre. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/contrats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lister les contrats d’un foyer */
        get: {
            parameters: {
                query: {
                    foyer: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Contrats du foyer. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContratVue"][];
                    };
                };
            };
        };
        put?: never;
        /** Créer un contrat de garde (crèche PSU ou ABCM) */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        mode: "CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH";
                        /** Format: uuid */
                        foyerId: string;
                        enfant: string;
                        /** Format: uuid */
                        enfantId: string;
                        /** Format: uuid */
                        etablissementId?: string;
                        nouvelEtablissement?: components["schemas"]["CreerEtablissementCorps"];
                        /** Format: date */
                        valideDu: string;
                        /** Format: date */
                        valideAu: string | null;
                        premiereInscription?: boolean;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Contrat créé. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContratVue"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/contrats/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Modifier les paramètres versionnés courants d’un contrat
         * @description Correction NON destructive de la version courante (SFD 30 lot 4) : les plannings saisis survivent. L’URL BFF est restée stable (le web « durcit » un contrat par ce chemin) mais le relais vise `PUT /contrats/{id}/version-courante` en amont ; l’identité du contrat (enfant, mode, établissement) n’est PAS versionnable.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        mode: "CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH";
                        /** Format: uuid */
                        foyerId: string;
                        enfant: string;
                        /** Format: uuid */
                        enfantId: string;
                        /** Format: date */
                        valideDu: string;
                        /** Format: date */
                        valideAu: string | null;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Contrat modifié. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContratVue"];
                    };
                };
                /** @description Contrat inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        /** Supprimer un contrat de garde */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Contrat supprimé (pas de contenu). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Contrat inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/contrats/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Historique des versions d’un contrat
         * @description Versions datées du contrat (SFD 30, US-30-04/06), de la plus récente à la plus ancienne, avec leur période dérivée.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Versions du contrat. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContratVersionVue"][];
                    };
                };
                /** @description Contrat inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        /**
         * Créer un avenant (nouvelle version à date d’effet)
         * @description Insère une nouvelle version du contrat à `dateEffet` (SFD 30, US-30-01) ; la version précédente est close implicitement la veille. Les plannings mensuels saisis SURVIVENT (aucune cascade). Seuls les paramètres versionnés sont acceptés — l’identité (mode, enfant, établissement) ne change pas par avenant (H6).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        mode: "CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH";
                        /** Format: date */
                        dateEffet: string;
                        motif?: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Avenant créé (contrat à jour renvoyé). */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContratVue"];
                    };
                };
                /** @description Date d’effet antérieure au début du contrat, mode différent (l’identité n’est pas versionnée) ou paramètres invalides. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Contrat inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Une version existe déjà à cette date d’effet. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/contrats/{id}/versions/{versionId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Corriger une version existante (geste rétroactif tracé)
         * @description Écrase les paramètres versionnés d’une version SANS déplacer sa date d’effet (SFD 30, US-30-05). La correction est journalisée (avant/après + motif) côté service. Consulter l’aperçu d’impact avant de corriger une version passée.
         */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    versionId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        mode: "CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH";
                        motif?: string;
                    } & {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Version corrigée (contrat à jour renvoyé). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ContratVue"];
                    };
                };
                /** @description Mode différent ou paramètres invalides. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Contrat ou version inconnus. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/contrats/{id}/versions/{versionId}/impact": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Aperçu d’impact d’une version (mois recalculés)
         * @description Liste les mois couverts par la période de la version (plafonnée à la vie du contrat) — les mois dont les coûts seraient recalculés par une correction. Lecture seule.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    versionId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Mois couverts par la version. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ImpactVersionVue"];
                    };
                };
                /** @description Contrat ou version inconnus. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/contrats/{id}/plannings/{mois}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lire la saisie de planning d’un mois (réelle ou simulée) */
        get: {
            parameters: {
                query?: {
                    simule?: boolean;
                };
                header?: never;
                path: {
                    id: string;
                    mois: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description La saisie enregistrée du mois, ou `null` si aucune saisie. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @description Saisie mensuelle relayée telle quelle (même forme ouverte que le corps du PUT). */
                            saisie: {
                                [key: string]: unknown;
                            } | null;
                        };
                    };
                };
            };
        };
        /** Écrire le planning mensuel (réel ou simulé) */
        put: {
            parameters: {
                query?: {
                    simule?: boolean;
                };
                header?: never;
                path: {
                    id: string;
                    mois: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Planning enregistré (pas de contenu). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/contrats/{id}/plannings/semaine/{semaineIso}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Éditer les besoins d’UNE semaine (réels ou simulés)
         * @description Édite les catégories DATÉES d’une seule semaine sans écraser le reste du/des mois recouverts : la fusion read-modify-write est faite par svc-planification. Les scalaires mensuels (`complementMinutes`, `pai`) sont hors périmètre de cette route.
         */
        put: {
            parameters: {
                query?: {
                    simule?: boolean;
                };
                header?: never;
                path: {
                    id: string;
                    semaineIso: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            responses: {
                /** @description Besoins enregistrés (pas de contenu). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Semaine ISO invalide (format `YYYY-Www`). */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/couts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Coût consolidé du mois */
        get: {
            parameters: {
                query: {
                    foyer: string;
                    mois: string;
                    simule?: boolean;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Coût consolidé du mois. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoutMoisVue"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/couts/annuel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Coût consolidé de l’année (transition crèche → école) */
        get: {
            parameters: {
                query: {
                    foyer: string;
                    annee: number;
                    simule?: boolean;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Coût consolidé de l’année. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CoutAnnuelVue"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{foyerId}/etablissements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lister les établissements d’un foyer (entité libre)
         * @description Établissements configurables propres au foyer (P2/P3), source de vérité `svc-planification`.
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    foyerId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Établissements du foyer (liste vide si aucun). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["EtablissementFoyerVue"][];
                    };
                };
            };
        };
        put?: never;
        /** Créer un établissement dans le foyer */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    foyerId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": components["schemas"]["CreerEtablissementCorps"];
                };
            };
            responses: {
                /** @description Établissement créé. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["EtablissementFoyerVue"];
                    };
                };
                /** @description Données invalides (ex. nom déjà utilisé). */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/foyers/{foyerId}/etablissements/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Modifier un établissement du foyer (champs fournis uniquement) */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    foyerId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        nom?: string;
                        /** Format: email */
                        emailService?: string | null;
                        preavisRegle?: components["schemas"]["PreavisRegle"] | null;
                        types?: ("CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH")[];
                        adresse?: string | null;
                        telephone?: string | null;
                        contact?: string | null;
                        actif?: boolean;
                    };
                };
            };
            responses: {
                /** @description Établissement mis à jour. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["EtablissementFoyerVue"];
                    };
                };
                /** @description Établissement inconnu. */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        /**
         * Supprimer un établissement du foyer
         * @description Suppression bloquée (409) tant qu’au moins un contrat y est rattaché.
         */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    foyerId: string;
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Établissement supprimé (pas de contenu). */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Des contrats sont rattachés à l’établissement. */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/referentiel/grilles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lister les grilles ABCM publiées (écran Tarifs)
         * @description Toutes les grilles ABCM du catalogue (SFD 30, US-30-02), une ligne par tranche et par période, montants en centimes. Le catalogue est global (aucun scoping foyer). Le front regroupe par période et affiche chaque grille « en préparation / active / passée ».
         */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Grilles publiées (liste vide si aucune). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["GrilleAbcmVue"][];
                    };
                };
            };
        };
        put?: never;
        /**
         * Publier une grille ABCM complète (période + tranches)
         * @description Saisit la grille d’une nouvelle année (SFD 30, US-30-02) : une période de validité et une ligne par tranche (montants en EUROS, convertis en centimes côté service). Route globale (aucun scoping foyer). Publication ATOMIQUE : une période chevauchant une grille existante de la même tranche est refusée sans aucune écriture (409).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: date */
                        valideDu: string;
                        /** Format: date */
                        valideAu?: string | null;
                        tranches: {
                            tranche: number;
                            cantineTotal: number;
                            cantinePartGarde?: number;
                            periMatin: number;
                            periSoir: number;
                            alshJourneeComplete: number;
                            alshDemiJournee: number;
                            alshRepas: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Grille publiée (les lignes créées, une par tranche). */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["GrilleAbcmVue"][];
                    };
                };
                /** @description Données invalides (tranche/période). */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description La période chevauche une grille existante de la même tranche (rien n’est écrit). */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/referentiel/baremes/psu": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publier un barème PSU versionné
         * @description Publie un barème PSU (taux CNAF par nombre d’enfants + bornes en EUROS) sur une période (SFD 30). Route globale. 409 si la période chevauche un barème existant (rien d’écrit).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: date */
                        valideDu: string;
                        /** Format: date */
                        valideAu?: string | null;
                        taux: {
                            [key: string]: number;
                        };
                        plancher?: number;
                        plafond?: number;
                    };
                };
            };
            responses: {
                /** @description Barème PSU publié. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Données invalides. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Période chevauchante (rien d’écrit). */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/referentiel/baremes/tranches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publier un barème de seuils de tranche RFR versionné
         * @description Publie les seuils de tranche RFR (liste ordonnée `[{niveau, rfrMax|null}]`, bornes hautes inclusives en EUROS) sur une période (SFD 30, DV-03). Route globale. 409 si période chevauchante (rien d’écrit).
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: date */
                        valideDu: string;
                        /** Format: date */
                        valideAu?: string | null;
                        seuils: {
                            niveau: number;
                            rfrMax: number | null;
                        }[];
                    };
                };
            };
            responses: {
                /** @description Barème de tranches publié. */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Données invalides. */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Période chevauchante (rien d’écrit). */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description Vue projetée d’un foyer (montants en centimes et euros). */
        FoyerVue: {
            /** Format: uuid */
            id: string;
            ressourcesMensuellesCentimes: number;
            ressourcesMensuellesEuros: number;
            rfrCentimes: number;
            rfrEuros: number;
            nbEnfantsACharge: number;
            nbParts: number;
            tranche: number;
        };
        /** @description Une version de ressources d’un foyer à date d’effet (SFD 30, DV-03). */
        FoyerVersionVue: {
            /** Format: uuid */
            id: string;
            /** Format: date */
            dateEffet: string;
            ressourcesMensuellesCentimes: number;
            ressourcesMensuellesEuros: number;
            rfrCentimes: number;
            rfrEuros: number;
            nbEnfantsACharge: number;
            nbParts: number;
            tranche: number;
            /** Format: date-time */
            saisiLe: string;
            motif: string | null;
        };
        /** @description Une ligne d’export : un enregistrement tel qu’il vit dans la table du service qui le détient. Les colonnes ne sont volontairement pas décrites ici — les figer ferait une troisième copie du schéma, après la table et l’interface du service, sans que rien ne garde les trois alignées. La garantie contractuelle porte sur la présence des sections, pas sur la forme des lignes. */
        LigneExport: {
            [key: string]: unknown;
        };
        /** @description Document d’export des données personnelles d’un foyer. Les sections portent le nom de ce qu’elles contiennent pour la personne, pas celui du service qui les détient. */
        ExportPortabiliteVue: {
            /** @description Version du format du document (pas de l’application). N’augmente que si une section est renommée ou retirée. */
            versionFormat: number;
            /** Format: date-time */
            genereLe: string;
            /** Format: uuid */
            foyerId: string;
            /** @description Situation et ressources du foyer, enfants, parents (retirés compris), préférences de notification effectives et traces de désabonnement. */
            situationFoyer: {
                situationCourante: components["schemas"]["LigneExport"];
                versionsRessources: components["schemas"]["LigneExport"][];
                correctionsRessources: components["schemas"]["LigneExport"][];
                enfants: components["schemas"]["LigneExport"][];
                parents: components["schemas"]["LigneExport"][];
                preferencesNotification: components["schemas"]["LigneExport"][];
                jetonsDesabonnement: components["schemas"]["LigneExport"][];
            };
            /** @description Contrats d’accueil et tout ce qui leur est rattaché (avenants, corrections, plannings mensuels), et établissements déclarés. */
            gardeEtPlanning: {
                contrats: components["schemas"]["LigneExport"][];
                etablissements: components["schemas"]["LigneExport"][];
            };
            /** @description Semaines soumises à validation, preuves de ce qui a réellement été envoyé (au foyer, à chaque parent, à l’établissement) et boîte de réception in-app. */
            communications: {
                validationsHebdo: components["schemas"]["LigneExport"][];
                envoisRecapFoyer: components["schemas"]["LigneExport"][];
                envoisRecapParent: components["schemas"]["LigneExport"][];
                envoisEtablissement: components["schemas"]["LigneExport"][];
                messagesInApp: components["schemas"]["LigneExport"][];
            };
        };
        /** @description Vue projetée d’un enfant rattaché à un foyer. */
        EnfantVue: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            foyerId: string;
            prenom: string;
            /** Format: date */
            dateNaissance: string;
        };
        /** @description Vue projetée d’un parent rattaché à un foyer (destinataire des notifications ; e-mail = PII). `prenom`/`nom` sont une identité douce optionnelle (nullable). */
        ParentVue: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            foyerId: string;
            prenom: string | null;
            nom: string | null;
            /** Format: email */
            email: string;
            principal: boolean;
            ordre: number;
            actif: boolean;
        };
        /** @description Identité courante du client (Cloudflare Access B1) et ses droits, résolus côté serveur : e-mail vérifié (ou null hors identité), statut admin (permissif si le gating ADMIN_EMAILS est inactif), et ids des foyers autorisés (parent actif). Sert à gater l’écran de création et à borner la sélection de foyer. */
        MoiVue: {
            /** Format: email */
            email: string | null;
            admin: boolean;
            foyers: string[];
        };
        /** @description Préférence de notification effective d’un parent (type × canal) : défaut applicatif fusionné avec le choix explicite stocké. `consentementAt`/`desabonneAt` tracent l’opt-in/opt-out (RGPD ; null tant qu’aucun choix n’a été posé). */
        PreferenceVue: {
            /** @enum {string} */
            typeNotification: "VALIDATION_HEBDO" | "RECAP_SERVICE";
            /** @enum {string} */
            canal: "EMAIL" | "IN_APP";
            actif: boolean;
            /** Format: date-time */
            consentementAt: string | null;
            /** Format: date-time */
            desabonneAt: string | null;
        };
        /** @description Vue « Mon profil » du parent connecté (A1) : sa ligne parent ciblée sur lui (résolue côté serveur depuis l’identité Cloudflare Access, jamais un parentId fourni par le client) et ses préférences de notification effectives. `foyerId`/`parentId` permettent au web de réutiliser les routes d’édition existantes sous @FoyerScope. */
        MonProfilVue: {
            /** Format: uuid */
            parentId: string;
            /** Format: uuid */
            foyerId: string;
            /** Format: email */
            email: string;
            prenom: string | null;
            nom: string | null;
            principal: boolean;
            preferences: components["schemas"]["PreferenceVue"][];
        };
        /** @description Une notification de l’inbox in-app d’un parent (PR6, journal informationnel lu/non-lu). `luLe` null tant qu’elle n’est pas lue. C’est un journal : il n’expose pas d’action « Valider » (celle-ci reste portée par l’encart A_VALIDER). */
        NotificationInApp: {
            /** Format: uuid */
            id: string;
            type: string;
            sujet: string;
            corps: string;
            /** @description Lien profond in-app (chemin relatif `/foyers/:id/planning?semaine=…`) rendant la carte tapable jusqu’à l’éditeur concerné. `null` pour les entrées sans lien. Champ **optionnel** (compat ascendante). */
            lien?: string | null;
            /** Format: date-time */
            creeLe: string;
            /** Format: date-time */
            luLe: string | null;
        };
        /** @description Panneau de l’inbox in-app du parent connecté : ses notifications récentes (les plus récentes d’abord) et le compteur total de non-lus (cloche). `nonLus` n’est pas borné par la taille de `notifications`. */
        InboxVue: {
            notifications: components["schemas"]["NotificationInApp"][];
            nonLus: number;
        };
        /** @description Vue projetée d’un contrat de garde. */
        ContratVue: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            foyerId: string;
            enfant: string;
            /** Format: uuid */
            enfantId: string | null;
            mode: string;
            /** Format: uuid */
            etablissementId?: string | null;
            /** Format: date */
            valideDu: string;
            /** Format: date */
            valideAu: string | null;
            premiereInscription?: boolean;
        };
        /** @description Version datée d’un contrat de garde (SFD 30, versionnement à date d’effet) : paramètres versionnés + période dérivée (`du`/`au`, `au` null si ouverte) + traçabilité. Les paramètres mode-spécifiques (`semaineType`/`semaineAbcm`) sont relayés tels quels. */
        ContratVersionVue: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            contratId: string;
            mode: string;
            /** Format: date */
            dateEffet: string;
            /** Format: date */
            du: string;
            /** Format: date */
            au: string | null;
            heuresAnnuellesContractualisees?: number | null;
            nbMensualites?: number | null;
            /** Format: date-time */
            saisiLe: string;
            motif?: string | null;
        } & {
            [key: string]: unknown;
        };
        /** @description Aperçu d’impact d’une version : les mois (YYYY-MM) qui seraient recalculés par une correction, du plus ancien au plus récent, et — parmi eux — ceux déjà communiqués à un établissement (récap envoyé), pour l’avertissement « déjà envoyé » (US-30-05). */
        ImpactVersionVue: {
            /** Format: uuid */
            versionId: string;
            moisCouverts: string[];
            /** @description Sous-ensemble de `moisCouverts` dont le récap a déjà été envoyé à un établissement (croisé avec le suivi des envois). Vide si aucun, ou si le suivi est momentanément indisponible. */
            moisCommuniques: string[];
        };
        /** @description Règle de préavis d’un établissement (union discriminée par `type`). */
        PreavisRegle: {
            /** @enum {string} */
            type: "JOURS_OUVRES";
            valeur: number;
        } | {
            /** @enum {string} */
            type: "JOUR_HEURE";
            /** @enum {string} */
            jour: "LUNDI" | "MARDI" | "MERCREDI" | "JEUDI" | "VENDREDI" | "SAMEDI" | "DIMANCHE";
            heure: string;
        };
        /** @description Établissement en entité libre, propre à un foyer (propriété de svc-planification, P2/P3). Identifié par un `id` libre (UUID), pas l’ancienne clé fermée. Tous les champs descriptifs sauf `nom` peuvent être null tant qu’ils ne sont pas renseignés. */
        EtablissementFoyerVue: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            foyerId: string;
            nom: string;
            /** Format: email */
            emailService: string | null;
            preavisRegle: components["schemas"]["PreavisRegle"] | null;
            /** @description Modes de garde proposés par l’établissement (informatif, multi-valeurs ; indépendant du `mode` d’un contrat). */
            types: ("CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH")[];
            adresse: string | null;
            telephone: string | null;
            contact: string | null;
            actif: boolean;
        };
        /** @description Corps de création d’un établissement (entité libre par foyer). Seul `nom` est requis ; le reste est facultatif et peut être null. Sert aussi de `nouvelEtablissement` à la création d’un contrat (à la volée). */
        CreerEtablissementCorps: {
            nom: string;
            /** Format: email */
            emailService?: string | null;
            preavisRegle?: components["schemas"]["PreavisRegle"] | null;
            types?: ("CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH")[];
            adresse?: string | null;
            telephone?: string | null;
            contact?: string | null;
            actif?: boolean;
        };
        /** @description Ligne de coût (débit ou crédit) en centimes. */
        Ligne: {
            libelle: string;
            /** @enum {string} */
            sens: "debit" | "credit";
            montantCentimes: number;
        };
        /** @description Coût consolidé d’un foyer sur un mois. */
        CoutMoisVue: {
            /** Format: uuid */
            foyerId: string;
            mois: string;
            simule: boolean;
            totalCentimes: number;
            prestations: {
                enfant: string;
                mode: string;
                totalCentimes: number;
                lignes: components["schemas"]["Ligne"][];
                /**
                 * Format: date
                 * @description Date d’effet (YYYY-MM-DD) du tarif résolu pour ce mois (grille ABCM ou barème PSU) — « Calculé avec » (US-30-04). Optionnel (absent si non résolu, ex. frais fixes).
                 */
                grilleValideDu?: string;
                /**
                 * Format: date
                 * @description Date de début (YYYY-MM-DD) du contrat ayant servi au calcul — « contrat du … » (US-30-04). Optionnel.
                 */
                contratValideDu?: string;
            }[];
            lignes: components["schemas"]["Ligne"][];
        };
        /** @description Coût consolidé d’un foyer sur une année (transition crèche → école). */
        CoutAnnuelVue: {
            /** Format: uuid */
            foyerId: string;
            annee: number;
            simule: boolean;
            totalCentimes: number;
            mois: components["schemas"]["CoutMoisVue"][];
        };
        /** @description Ligne de grille ABCM publiée pour une tranche, versionnée par période (SFD 30, US-30-02). Montants en CENTIMES entiers (fidèles à `Money`). `valideAu` null = période ouverte ; `cantinePartGardeCentimes` null quand la part « garde » n’est pas connue (surtout hors T3). */
        GrilleAbcmVue: {
            /** Format: uuid */
            id: string;
            tranche: number;
            /** Format: date */
            valideDu: string;
            /** Format: date */
            valideAu: string | null;
            cantineTotalCentimes: number;
            cantinePartGardeCentimes: number | null;
            periMatinCentimes: number;
            periSoirCentimes: number;
            alshJourneeCompleteCentimes: number;
            alshDemiJourneeCentimes: number;
            alshRepasCentimes: number;
        };
        /** @description Résultat de sonde `@nestjs/terminus` : `status` global + un objet par indicateur. `info` (indicateurs `up`) et `error` (indicateurs `down`) sont des vues partielles de `details`, qui les contient tous — d’où le nom de l’amont fautif dans le corps d’un 503 (lot B3). */
        HealthCheckResult: {
            /** @enum {string} */
            status: "ok" | "error" | "shutting_down";
            info?: {
                [key: string]: unknown;
            };
            error?: {
                [key: string]: unknown;
            };
            details: {
                [key: string]: unknown;
            };
        };
        /** @description Plantage remonté par le navigateur (lot C7). `route` est le `pathname` SEUL — jamais la query : les liens profonds portent `?semaine=` et `?enfant=<prénom>`, données personnelles qui n’ont rien à faire dans un journal d’exploitation. Les bornes sont appliquées des deux côtés (le client tronque, la gateway refuse). */
        ErreurClient: {
            /**
             * @description Où l’erreur a été interceptée : frontière racine, frontière de route, chargement d’un module `lazy()`, `window.onerror`, ou promesse rejetée sans `catch`.
             * @enum {string}
             */
            origine: "application" | "route" | "chunk" | "globale" | "promesse";
            message: string;
            route: string;
            pile?: string;
            /** @description Tête de la pile de composants React, si connue. */
            composant?: string;
        };
        /** @description Une semaine à valider (indicateur in-app). `enfant`/`mode` sont AJOUTÉS par la gateway (jointure avec les contrats du foyer) pour distinguer N lignes d’une même semaine ; ils sont absents si le contrat n’est plus listé — l’écran retombe sur son libellé de repli. */
        NotificationAValiderVue: {
            /** Format: uuid */
            contratId: string;
            /** Format: uuid */
            foyerId: string;
            semaineIso: string;
            /** @enum {string} */
            statut: "A_VALIDER" | "VALIDEE" | "VALIDEE_AVEC_MODIFS";
            /** Format: date-time */
            notifieeLe: string;
            enfant?: string;
            mode?: string;
        };
        /** @description Jours modifiés entre le snapshot de notification et la relecture. `avant`/`apres` sont relayés TELS QUELS par la gateway (forme propriété de svc-notifications) : volontairement non décrits ici. */
        DeltaModifs: {
            jours: {
                /** Format: date */
                date: string;
                avant: unknown;
                apres: unknown;
            }[];
        };
        /** @description Résultat de la validation d’une semaine par le parent. */
        ValidationResultat: {
            /** Format: uuid */
            contratId: string;
            semaineIso: string;
            /** @enum {string} */
            statut: "A_VALIDER" | "VALIDEE" | "VALIDEE_AVEC_MODIFS";
            deltaModifs: components["schemas"]["DeltaModifs"] | null;
        };
        /** @description Un enfant du foyer concerné par le récap agrégé d’un établissement. */
        EnfantBrouillonVue: {
            /** Format: uuid */
            contratId: string;
            enfant: string;
            deltaModifs: components["schemas"]["DeltaModifs"];
        };
        /** @description Brouillon régénérable du mail AGRÉGÉ par établissement (un seul mail regroupant tous les enfants du foyer validés avec modifications). `routable: false` signale un établissement non joignable (sans e-mail ou archivé) — l’écran affiche l’avertissement au lieu du bouton d’envoi, et `destinataire` vaut alors `''`. `dryRun` = un envoi réel serait neutralisé (bac à sable / allowlist). */
        BrouillonEtablissementVue: {
            /** Format: uuid */
            foyerId: string;
            semaineIso: string;
            /** Format: uuid */
            etablissementId: string;
            etablissementLibelle: string;
            destinataire: string;
            sujet: string;
            corps: string;
            texte: string;
            enfants: components["schemas"]["EnfantBrouillonVue"][];
            routable: boolean;
            /** @enum {string|null} */
            raisonNonRoutable: "SANS_EMAIL" | "ARCHIVE" | null;
            dryRun: boolean;
        };
        /** @description Issue réelle de l’envoi du récap agrégé à un établissement (idempotent sur `(foyer, semaine, établissement)`). */
        EnvoiEtablissementResultat: {
            /** Format: uuid */
            foyerId: string;
            semaineIso: string;
            /** Format: uuid */
            etablissementId: string;
            destinataire: string;
            /** @enum {string} */
            statut: "EN_COURS" | "ENVOYE" | "ECHEC" | "DRY_RUN";
            messageId: string | null;
            erreur: string | null;
            /** Format: date-time */
            envoyeLe: string | null;
        };
        /** @description Livraison du récap du mardi vers UN parent (ledger `envoi_recap_parent`). */
        SuiviRappelParent: {
            email: string;
            /** @enum {string} */
            statut: "ENVOYE" | "DRY_RUN" | "ECHEC";
            /** Format: date-time */
            envoyeLe: string | null;
            essais: number;
        };
        /** @description État d’envoi du rappel hebdomadaire du mardi aux parents (agrégat foyer + détail par parent). */
        SuiviRappelHebdo: {
            /** @enum {string} */
            statut: "A_ENVOYER" | "ENVOYE" | "DRY_RUN" | "ECHEC" | "ABANDONNE";
            /** Format: date-time */
            envoyeLe: string | null;
            erreur: string | null;
            parents: components["schemas"]["SuiviRappelParent"][];
        };
        /** @description État d’envoi du récap agrégé vers un établissement (ledger `envoi_etablissement`). */
        SuiviEnvoiEtablissement: {
            /** Format: uuid */
            etablissementId: string;
            /** @enum {string} */
            statut: "EN_COURS" | "ENVOYE" | "ECHEC" | "DRY_RUN";
            /** Format: date-time */
            envoyeLe: string | null;
            erreur: string | null;
            destinataire: string | null;
        };
        /** @description Suivi PERSISTANT des envois d’une `(foyer, semaine)` (lecture seule) : `rappel` est `null` si la semaine n’a jamais été programmée. */
        SuiviEnvoisVue: {
            /** Format: uuid */
            foyerId: string;
            semaineIso: string;
            rappel: components["schemas"]["SuiviRappelHebdo"] | null;
            etablissements: components["schemas"]["SuiviEnvoiEtablissement"][];
        };
        /** @description Établissement réel concerné par la semaine (entité libre, svc-planification) — clé de groupement de l’écran d’édition. */
        EtablissementConcerneVue: {
            /** Format: uuid */
            etablissementId: string;
            libelle: string;
            preavisRegle: components["schemas"]["PreavisRegle"] | null;
        };
        /** @description Un contrat actif de la semaine avec ses besoins datés. `besoins` (jour `YYYY-MM-DD` → catégories datées), `semaineType` et `semaineAbcm` sont RELAYÉS TELS QUELS depuis svc-planification : la gateway n’en valide que l’enveloppe, ils restent donc ouverts ici (même parti pris que le corps de `PUT …/plannings/{mois}`). */
        ContratBesoinsVue: {
            /** Format: uuid */
            contratId: string;
            enfant: string;
            /** @enum {string} */
            mode: "CRECHE_PSU" | "CANTINE" | "PERISCOLAIRE" | "ALSH";
            /** Format: uuid */
            etablissementId: string | null;
            besoins: {
                [key: string]: unknown;
            };
            semaineType?: {
                [key: string]: unknown;
            };
            semaineAbcm?: {
                [key: string]: unknown;
            };
        };
        /** @description Vue consolidée d’une semaine éditable du foyer (lecture seule) : les 7 jours, les établissements concernés et les contrats actifs avec leurs besoins datés. Ouverte depuis une notification A_VALIDER. */
        SemaineBesoinsVue: {
            semaineIso: string;
            jours: string[];
            etablissements: components["schemas"]["EtablissementConcerneVue"][];
            contrats: components["schemas"]["ContratBesoinsVue"][];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
