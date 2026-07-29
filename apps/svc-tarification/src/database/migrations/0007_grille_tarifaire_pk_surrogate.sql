-- `grille_tarifaire.id` portait l'identifiant de la grille amont. Or une grille
-- amont est publiée en **un événement par mode ABCM** (PERISCOLAIRE/CANTINE/ALSH)
-- avec le même `grilleId` : les 2e et 3e modes violaient donc `grille_tarifaire_pkey`,
-- violation que le `ON CONFLICT ("mode","tranche","valide_du")` de la projection ne
-- rattrape pas (index différent) — d'où l'échec de projection puis la dead-letter.
-- `id` devient une PK surrogate ; l'identifiant amont passe en colonne de traçabilité
-- et l'unicité métier reste portée par `grille_tarifaire_mode_tranche_du_uq`.
ALTER TABLE "grille_tarifaire" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "grille_tarifaire" ADD COLUMN "grille_id" uuid;--> statement-breakpoint
-- Back-fill : sur les lignes déjà projetées, l'ancien `id` EST l'identifiant amont.
-- Les `id` existants sont conservés tels quels (uuid valides et distincts) ; seules
-- les insertions futures tirent la valeur par défaut.
UPDATE "grille_tarifaire" SET "grille_id" = "id" WHERE "grille_id" IS NULL;--> statement-breakpoint
ALTER TABLE "grille_tarifaire" ALTER COLUMN "grille_id" SET NOT NULL;
