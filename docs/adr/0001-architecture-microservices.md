# ADR-0001 — Architecture microservices

- **Statut** : Accepté
- **Date** : 2026-06-02
- **Décideurs** : Propriétaire du produit (utilisateur)

## Contexte

L'outil est un planificateur de crèche personnel, mono-utilisateur, qui calcule un
coût mensuel selon le barème PSU/CNAF. Deux options ont été présentées :

1. **Monolithe modulaire hexagonal** (« modulith »), microservices-ready —
   _recommandé_ par l'assistant pour ce profil (simplicité d'exploitation, mêmes
   bénéfices d'architecture propre, éclatement ultérieur mécanique).
2. **Microservices stricts** dès le départ.

## Décision

Le propriétaire choisit l'option **2 — microservices stricts**, en connaissance des
arbitrages, pour s'aligner sur les standards visés et/ou monter en compétence sur ce
style d'architecture.

## Conséquences

**Acceptées (coûts) :**

- Complexité opérationnelle : plusieurs déployables, base par service, broker
  d'événements, observabilité distribuée obligatoire.
- Cohérence **éventuelle** entre services (pas de transaction ACID transverse).
- Débogage et tests plus exigeants (contrats, traçage distribué).

**Mesures de maîtrise (déjà intégrées en doc 04) :**

- Périmètre limité à **3 services** + 1 gateway + le web.
- **Outbox + événements idempotents** pour la fiabilité.
- **OpenTelemetry / trace id** dès la première phase.
- **Tests de contrat Pact** bloquants en CI.
- Automatisation locale (`docker-compose up`, Nx affected).
- Architecture **hexagonale conservée à l'intérieur de chaque service** → le domaine
  reste portable si l'on consolidait un jour.

## Révision

Réversible : la nature hexagonale des services permet de re-consolider en modulith
si le coût d'exploitation devenait disproportionné.
