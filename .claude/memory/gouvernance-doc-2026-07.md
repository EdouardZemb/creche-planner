---
name: gouvernance-doc-2026-07
description: "Session gouvernance doc 2026-07 — statuts d'audit réalignés, PR #142/#145/#144 toutes mergées main"
metadata:
  node_type: memory
  type: project
  originSessionId: 8d615960-c04c-4f9b-b073-261fa16b8473
---

Audit gouvernance doc (2026-07-01) traité le 2026-07-02/03 en 3 PRs, **toutes
mergées** (main `949165f`) :

- **#142** (`docs/statuts-audits-2026-07`) : docs 25/27/28 réalignés sur le réel
  vérifié dans le code. État réel : **AUD-01→16 = 16/16 faites** ; **AQ-01→13
  faites**, AQ-14/15 partielles (reste : AsyncAPI + doc rétention JetStream ;
  healthchecks compose des apps hors gateway + mutualisation smoke/e2e), AQ-17
  (timeout transaction) et AQ-18 (React.lazy) ouvertes ; **doc 28 phases 5→13
  toutes faites, roadmap close**. Doc 22 déjà à jour (AN-14 ✅ PR #128).
- **#145** (`docs/conventions-et-index` ; née #143 empilée sur #142 — GitHub a
  FERMÉ la PR à la suppression de sa branche de base au lieu de la recibler, et
  une PR fermée ne peut ni changer de base ni rouvrir → rebase sur main +
  nouvelle PR ; piège à retenir pour les PRs empilées) : AQ-16 close —
  `docs/README.md` (index),
  `CONTRIBUTING.md` racine, CONVENTIONS.md précisé (règles React Compiler
  ratchetées warn : set-state-in-effect, refs, preserve-manual-memoization,
  immutability + exhaustive-deps), bandeau « historique » sur doc 05.
  Déviations : cert `caddy-root.crt` non déplacé (réfs deploy.mjs/doc 24).
- **#144** (`docs/politique-logs-pii`, indépendante) : section PII dans
  observabilite.md (e-mails parents logués par le chemin mail svc-notifications ;
  Loki 7 j ; accès prod = clé SSH seule ; purge = volume loki-data) + doc 06 :
  **Phase 12 a11y = RÉALISÉE 2026-06-05** (le bandeau disait « planifiée » alors
  que le §18 la documentait faite ; UT-01 livré, 0 violation axe AA — reste
  humain non bloquant : NVDA/VoiceOver, panel, SUS).

**Why:** ne pas re-vérifier ces statuts ni re-signaler ces « gaps » (UT-01,
AUD-05/CD…) — ils étaient des artefacts de docs périmées, pas des manques réels.
Piège racine : [[piege-numeros-pr-pre-publication]].

**How to apply:** le self-merge des PRs de session exige l'accord explicite de
l'utilisateur (« merge tout » donné ici). Avec `strict:true`, merger N PRs en
série = `gh pr update-branch` + auto-merge pour chaque suivante. Chip créée pour
rafraîchir le README racine
(périmé : Phase 9, React 18, 4 services). Sujets encore ouverts si on cherche du
travail d'audit : AQ-14 (reste), AQ-15 (reste), AQ-17, AQ-18.
