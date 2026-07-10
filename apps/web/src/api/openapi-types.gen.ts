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
        /** Liveness/readiness de la gateway */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description La gateway est vivante. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            status: string;
                        };
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
    "/api/v1/contrats/{id}/plannings/{mois}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
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
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
