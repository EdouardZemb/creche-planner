---
name: plan-qualite-coquille-navigation
description: 'Plan qualité « Coquille + fiabilité rappels + mail au service » — 9 lots (4 front coquille + 2 backend fiabilité + 1 lien rappel + 2 mail établissement), rédigé pas encore exécuté'
metadata:
  node_type: memory
  type: project
  originSessionId: 49f56375-d1de-4903-84c6-545728fddf57
---

Chantier qualité n°9 : la **coquille** (tout autour des écrans de fonctionnalité, tous déjà
polis) + **2 failles de fiabilité backend** des rappels. Plan auto-portant :
`.claude/plans/qualite-coquille-navigation.md` (rédigé 2026-07-16 par session planification,
**pas encore exécuté**). Périmètre validé par le PO = coquille **+** fiabilité rappels, avec
**offline étendu (consultation en cache)**.

**Audits faits (2 agents Explore) :** coquille = gap MOYEN (bien construite mais 5 défauts
bornés) ; backend = très solide, seules 2 vraies failles non-trackées (les 3 autres « gaps »
remontés sont des faux positifs : isolation foyer DÉJÀ active en prod, back-fill enfant_id
DÉJÀ fait, doublon-au-crash borné/documenté).

**6 lots (1 PR chacun) :**

- **L1** mobile-PWA & a11y : `viewport-fit=cover` + safe-area-inset-top en-tête (sinon contenu
  sous l'encoche), min-height 44px `.app-header a` (états hors-foyer), prop `EtatVide.titrePrincipal`
  (h1 sur 6 sites pleine page App.tsx:83/93/345/376/387/399, les 8 in-page restent h2),
  `.spinner-roue{animation:none}` sous reduced-motion, typo `…`. **Sonnet 5 délégable** (sauf prop EtatVide).
- **L2** chargement unifié + annonce fiable : nouveau `ChargementPage` (roue+texte visible,
  role=status) remplace 8 loaders `<p class=muted>` de niveau écran ; **fix annonce-route** =
  contexte `TitrePageContext` alimenté par `useTitrePage`, lu par `useAnnonceRoute` (l'annonce
  suit l'écran RÉEL, plus le pathname → un 404-famille annonce « Famille introuvable »). Opus.
- **L3** sélecteur « Mes familles » réel : `FoyerVue` n'a AUCUN nom → libellé = prénoms enfants
  via `lireFoyer(id)` (renvoie {foyer,enfants,parents}) + `Intl.ListFormat('fr')`. Repli parent
  principal/email. **Dépend de L2** (ChargementPage). Cas RARE (multi-foyer, mode borné). Opus.
- **L4** offline étendu : workbox `runtimeCaching` NetworkFirst `/api/v1/` GET, `cacheableResponse
{statuses:[200]}` (jamais l'opaqueredirect Access), timeout 4s, expiration 24h ; hook `useEnLigne`
  - `BanniereHorsLigne` (ambre, role=status) dans Coquille ; `messageErreur` offline-aware.
    ⚠️ SW actif SEULEMENT en build+preview (pas vite dev). Opus.
- **L5** GAP A envoi crèche : ligne `envoi_etablissement` coincée `EN_COURS` jamais retentée
  (`onConflictDoNothing` renvoie la ligne bloquée sans rappeler le mailer). Fix = reprise
  status-aware À LA RÉ-ACTION DU PARENT (ENVOYE/DRY_RUN→no-op ; ECHEC→resend ; EN_COURS vieux
  de >2min→resend ; EN_COURS récent→no-op), injecter CLOCK (clock.ts existe), **SURTOUT PAS de
  reaper auto** (envoi human-in-the-loop). 0 migration (réutilise created_at). Opus.
- **L6** GAP B rappel mardi : slot `envoi_recap_hebdo` resté ECHEC devient inatteignable quand
  `semaineProchaine(now)` avance → abandon SILENCIEUX. Fix = balayage additif AVANT le gate de
  fenêtre → nouvel état terminal `ABANDONNE` (varchar, **0 migration**) + `logger.error` structuré
  distinct. Pas de re-livraison tardive spéculative. Opus.

**+ 3 lots ajoutés (demande PO 2026-07-16, section « mail au service & lien de rappel ») :**

- **L7** lien du mail de rappel : le CHEMIN est déjà correct (#180 déployé) ; le vrai bug =
  l'URL de base pointe sur l'**IP LAN `192.168.1.129`** (erreur TLS `ERR_CERT_AUTHORITY_INVALID`,
  injoignable hors LAN) au lieu du domaine public. `NOTIF_APP_URL`=`NOTIF_PUBLIC_API_URL`=`SERVER_ORIGIN`
  (docker-compose.server.yml:175/179). Fix = **action ops** (poser `SERVER_ORIGIN`/URLs sur
  `https://creche.testlens.dev`, à CONFIRMER, recréer conteneur) **+ garde-fou boot** prod-only
  (refuse une URL http/IP/localhost). NE PAS retoucher le chemin. Opus + action humaine.
- **L8** (svc-notif + api-gateway) : ouvrir `POST /envois/etablissement` à un `sujet`/`corps`
  OPTIONNELS fournis par le client (texte brut, échappé serveur→HTML), rétro-compatible (sans
  corps→régénération actuelle). **Pact élargi** (seul contrat touché du chantier), 0 migration
  (colonnes sujet varchar(300)/corps text existent). destinataire reste résolu serveur. Opus.
- **L9** (web, dépend de L8) : composer un brouillon **semaine COMPLÈTE** lisible (module pur
  `brouillonSemaineComplete.ts` depuis `SemaineBesoins` DÉJÀ chargé dans RelectureEnvoi mais
  inutilisé au-delà de `.etablissements`), champs **objet+corps ÉDITABLES** (le PO a choisi
  « tout le corps éditable »), envoi du texte saisi. Réutiliser le rendu de jour existant
  (cohérence écran↔mail). Opus.

**Décisions clés / hypothèses :** URL `/foyers/` gardée (deep-links e-mails) ; offline = pas de
file d'écritures, bannière globale ; **éditabilité mail = TOUT le corps** (serveur journalise/
envoie ce que le client fournit, échappé ; destinataire serveur) ; **0 migration, 0 secret, 0
dépendance** ; **1 seul contrat Pact touché = L8** (rétro-compat → can-i-deploy vert après
régénération) ; **1 action ops = L7** (URL publique). Ordres : coquille 1→2→3→4 (App.tsx,
rebaser) ; 5/6/7 orthogonaux ; 8→9. Voir [[audit-2026-07-plan-amelioration]] (faux positifs
backend), [[verif-ui-locale-stack]] (vérif), [[prod-deployment-facts]] (domaine public/serveur).
