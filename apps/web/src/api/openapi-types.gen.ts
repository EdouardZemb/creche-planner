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
        /** Créer un foyer et ses enfants (orchestration) */
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
                        };
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
        put?: never;
        post?: never;
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
    "/api/v1/etablissements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lister les établissements destinataires
         * @description Annuaire des établissements (crèche / ABCM) destinataires des mails de service, avec leur règle de préavis.
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
                /** @description Établissements destinataires. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["EtablissementVue"][];
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
    "/api/v1/etablissements/{cle}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Mettre à jour un établissement destinataire (upsert par clé) */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    cle: "CRECHE_HIRONDELLES" | "ABCM";
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: email */
                        emailService: string;
                        preavisRegle: components["schemas"]["PreavisRegle"];
                        libelle?: string;
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
                        "application/json": components["schemas"]["EtablissementVue"];
                    };
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
        /** @description Vue projetée d’un contrat de garde. */
        ContratVue: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            foyerId: string;
            enfant: string;
            mode: string;
            /** Format: date */
            valideDu: string;
            /** Format: date */
            valideAu: string | null;
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
        /** @description Établissement destinataire d’un mail de service (annuaire notifications). */
        EtablissementVue: {
            /** @enum {string} */
            cle: "CRECHE_HIRONDELLES" | "ABCM";
            libelle: string;
            /** Format: email */
            emailService: string;
            preavisRegle: components["schemas"]["PreavisRegle"];
            actif: boolean;
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
