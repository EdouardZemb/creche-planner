// NON-RÉGRESSION VISUELLE — filet manquant du dépôt, hors CI par défaut.
//
// Il n'y a qu'UN fichier CSS dans `apps/web`, aucun CSS module, aucun snapshot de
// rendu : rien ne rattrape une colonne de grille qui change, un bloc `@media`
// déplacé qui réveille un conflit d'ordre, ou un style inline résorbé en classe
// qui ne produit pas exactement la même valeur. La suite axe ne voit rien de tout
// cela. Ce balayage produit deux choses, sur les routes servies par les mocks de
// `a11y.e2e.spec.ts` :
//
//   1. les ÉCARTS DE CONTRASTE, en couvrant les angles morts d'axe — `opacity`
//      portée par un ANCÊTRE, bordures de champs (WCAG 1.4.11), états
//      `:disabled`, anneau de focus élément par élément, débordement à 375 px ;
//   2. une EMPREINTE des styles CALCULÉS de chaque élément (37 propriétés), à
//      comparer avant/après avec `scripts/comparer-empreinte.mjs`. C'est elle qui
//      démontre qu'une refonte est à iso-rendu, pas une relecture de diff.
//
// Usage :
//   nx run web:e2e-visuel                        (sortie par défaut)
//   SORTIE=avant.json nx run web:e2e-visuel      puis, après la refonte :
//   SORTIE=apres.json nx run web:e2e-visuel
//   node scripts/comparer-empreinte.mjs avant.json apres.json
//
// Deux garde-fous internes, tous deux nés d'un vrai défaut :
//   - une SONDE NÉGATIVE injecte trois défauts connus et exige qu'ils soient
//     détectés — un balayage qui ne crie jamais ne prouve rien ;
//   - une GARDE ANTI-BALAYAGE-À-VIDE refuse de conclure si une route a rendu une
//     page (quasi) vide. Sans elle, une attente trop courte faisait mesurer un
//     `#root` VIDE sur les 26 pages et sortir « 0 constat », indiscernable d'un
//     succès.
//
// Les transitions CSS sont neutralisées avant mesure : une propriété en cours de
// transition resterait figée sur sa valeur de départ et ferait croire à un défaut.
import { test, expect, type Page, type Route } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const FOYER_ID = 'foyer-a11y';
const ANNEE = new Date().getFullYear();
const MOIS = `${ANNEE}-10`;
const SORTIE = process.env['SORTIE'] ?? 'test-output/contrastes.json';

const dossier = {
  foyer: {
    id: FOYER_ID,
    ressourcesMensuellesCentimes: 671692,
    ressourcesMensuellesEuros: 6716.92,
    rfrCentimes: 7270500,
    rfrEuros: 72705,
    nbEnfantsACharge: 2,
    nbParts: 2.5,
    tranche: 3,
  },
  enfants: [
    {
      id: 'enf-1',
      foyerId: FOYER_ID,
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    },
    {
      id: 'enf-2',
      foyerId: FOYER_ID,
      prenom: 'Zoé',
      dateNaissance: '2023-03-12',
    },
  ],
  parents: [
    {
      id: 'parent-a11y',
      foyerId: FOYER_ID,
      email: 'parent@test.fr',
      prenom: 'Camille',
      nom: 'Martin',
      principal: true,
    },
  ],
};

const contratsLocaux = [
  {
    id: 'contrat-cantine',
    foyerId: FOYER_ID,
    enfant: 'Mia',
    mode: 'CANTINE',
    valideDu: `${ANNEE}-09-01`,
    valideAu: null,
    semaineAbcm: {
      LUNDI: { cantine: true },
      MERCREDI: { cantine: true },
      VENDREDI: { cantine: true },
    },
  },
  {
    id: 'contrat-peri',
    foyerId: FOYER_ID,
    enfant: 'Mia',
    mode: 'PERISCOLAIRE',
    valideDu: `${ANNEE}-09-01`,
    valideAu: null,
    semaineAbcm: { LUNDI: { periMatin: true, periSoir: true } },
  },
];

const coutMois = {
  foyerId: FOYER_ID,
  mois: MOIS,
  simule: false,
  totalCentimes: 20288,
  prestations: [
    {
      enfant: 'Mia',
      mode: 'CANTINE',
      totalCentimes: 20288,
      lignes: [
        { libelle: 'Cantine (16 j)', sens: 'debit', montantCentimes: 20288 },
      ],
    },
  ],
  lignes: [{ libelle: 'Total à payer', sens: 'debit', montantCentimes: 20288 }],
};

const coutAnnuel = {
  foyerId: FOYER_ID,
  annee: ANNEE,
  simule: false,
  totalCentimes: 243456,
  mois: Array.from({ length: 12 }, (_, i) => ({
    mois: `${ANNEE}-${String(i + 1).padStart(2, '0')}`,
    totalCentimes: 20288,
  })),
};

const semaineBesoinsVide = {
  semaineIso: `${ANNEE}-W01`,
  jours: [],
  etablissements: [],
  contrats: [],
};

const MOI = { email: 'parent@test.fr', admin: false, foyers: [FOYER_ID] };

const MON_PROFIL = {
  parentId: 'parent-a11y',
  foyerId: FOYER_ID,
  email: 'parent@test.fr',
  prenom: 'Camille',
  nom: 'Martin',
  principal: true,
  preferences: [
    {
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'EMAIL',
      actif: true,
      consentementAt: null,
      desabonneAt: null,
    },
    {
      typeNotification: 'VALIDATION_HEBDO',
      canal: 'IN_APP',
      actif: false,
      consentementAt: null,
      desabonneAt: null,
    },
  ],
};

const INBOX = {
  notifications: [
    {
      id: 'notif-1',
      type: 'VALIDATION_HEBDO',
      sujet: 'Planning de la semaine du 29 juin au 5 juillet à valider',
      corps: 'Le planning de Mia est à valider.',
      creeLe: '2026-06-23T06:01:00.000Z',
      luLe: null,
      lien: `/foyers/${FOYER_ID}/planning?semaine=2026-W27`,
    },
  ],
  nonLus: 1,
};

const ETABLISSEMENTS = [
  {
    id: 'etab-1',
    foyerId: FOYER_ID,
    nom: 'Crèche des Lilas',
    type: 'CRECHE',
    email: 'creche@test.fr',
    archive: false,
  },
  {
    id: 'etab-2',
    foyerId: FOYER_ID,
    nom: 'École Papin (archivée)',
    type: 'ECOLE',
    email: 'ecole@test.fr',
    archive: true,
  },
];

const GRILLES = [
  {
    id: 'grille-1',
    mode: 'CANTINE',
    annee: ANNEE,
    valideDu: `${ANNEE}-01-01`,
    valideAu: null,
    tranches: [
      { rang: 1, plafondQf: 700, montantCentimes: 350 },
      { rang: 2, plafondQf: 1200, montantCentimes: 480 },
      { rang: 3, plafondQf: null, montantCentimes: 620 },
    ],
  },
];

async function amorcerStockage(page: Page): Promise<void> {
  await page.addInitScript(
    ({ foyerId, contrats }) => {
      localStorage.setItem('creche:foyerId', foyerId);
      sessionStorage.setItem(
        `creche:contrats:${foyerId}`,
        JSON.stringify(contrats),
      );
    },
    { foyerId: FOYER_ID, contrats: contratsLocaux },
  );
}

async function mockerBff(page: Page): Promise<void> {
  await page.route('**/api/v1/**', async (route: Route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    const method = req.method();

    if (method !== 'GET') return route.fulfill({ status: 204, body: '' });

    if (pathname.endsWith('/api/v1/moi')) {
      return route.fulfill({ status: 200, json: MOI });
    }
    if (pathname.endsWith('/api/v1/moi/profil')) {
      return route.fulfill({ status: 200, json: MON_PROFIL });
    }
    if (pathname.endsWith('/api/v1/moi/notifications')) {
      return route.fulfill({ status: 200, json: INBOX });
    }
    if (pathname.endsWith('/etablissements')) {
      return route.fulfill({ status: 200, json: ETABLISSEMENTS });
    }
    if (pathname.endsWith('/api/v1/referentiel/grilles')) {
      return route.fulfill({ status: 200, json: GRILLES });
    }
    if (pathname.includes('/api/v1/referentiel/baremes')) {
      return route.fulfill({ status: 200, json: [] });
    }
    if (pathname.endsWith('/api/v1/foyers')) {
      return route.fulfill({ status: 200, json: [dossier.foyer] });
    }
    if (/\/api\/v1\/foyers\/[^/]+$/.test(pathname)) {
      return route.fulfill({ status: 200, json: dossier });
    }
    if (pathname.endsWith('/api/v1/contrats')) {
      return route.fulfill({ status: 200, json: contratsLocaux });
    }
    if (
      pathname.includes('/notifications/semaine/') &&
      pathname.endsWith('/besoins')
    ) {
      return route.fulfill({ status: 200, json: semaineBesoinsVide });
    }
    if (pathname.endsWith('/api/v1/notifications/a-valider')) {
      // TABLEAU, pas un objet enveloppe : `PastilleAValider` fait `data.map(…)`
      // et une mauvaise forme faisait tomber tout l'arbre React (aucun error
      // boundary), donc rendait une page blanche que le balayage prenait pour
      // une page sans défaut de contraste.
      return route.fulfill({ status: 200, json: [] });
    }
    if (pathname.endsWith('/api/v1/couts/annuel')) {
      return route.fulfill({ status: 200, json: coutAnnuel });
    }
    if (pathname.endsWith('/api/v1/couts')) {
      return route.fulfill({ status: 200, json: coutMois });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
}

/** Code injecté dans la page : mesure des contrastes. Autonome (pas de closure). */
const SCRIPT_MESURE = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return { r: 0, g: 0, b: 0, a: 0 };
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] === undefined ? 1 : p[3] };
  };
  const melange = (dessus, dessous) => ({
    r: dessus.r * dessus.a + dessous.r * (1 - dessus.a),
    g: dessus.g * dessus.a + dessous.g * (1 - dessus.a),
    b: dessus.b * dessus.a + dessous.b * (1 - dessus.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const chemin = (el) => {
    const bouts = [];
    let n = el;
    for (let i = 0; n && i < 4; i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (n.className && typeof n.className === 'string') {
        s += '.' + n.className.trim().split(/\\s+/).slice(0, 3).join('.');
      }
      bouts.unshift(s);
      n = n.parentElement;
    }
    return bouts.join(' > ');
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // Fond effectif : on remonte jusqu'au premier ancêtre opaque en compositant
  // les fonds translucides. Renvoie aussi le noeud source (borne de l'opacité).
  const fondEffectif = (el) => {
    const pile = [];
    let n = el;
    let source = null;
    while (n) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg.a > 0) pile.push(bg);
      if (bg.a === 1) { source = n; break; }
      n = n.parentElement;
    }
    let res = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = pile.length - 1; i >= 0; i--) res = melange(pile[i], res);
    return { couleur: res, source };
  };
  // Opacité cumulée entre \`el\` et le noeud porteur du fond opaque (exclu) :
  // c'est l'angle mort n°1 d'axe, qui ignore \`opacity\` sur un ancêtre.
  const opaciteCumulee = (el, borne) => {
    let o = 1;
    let n = el;
    while (n && n !== borne) {
      const v = parseFloat(getComputedStyle(n).opacity || '1');
      if (!Number.isNaN(v)) o *= v;
      n = n.parentElement;
    }
    return o;
  };
  const aDuTexte = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent && n.textContent.trim().length > 0) return true;
    }
    return false;
  };

  const constats = [];
  const tous = Array.from(document.querySelectorAll('body *'));

  // 1. Texte (seuil AA : 4.5, ou 3.0 pour du grand texte).
  for (const el of tous) {
    if (!aDuTexte(el) || !visible(el)) continue;
    const s = getComputedStyle(el);
    const { couleur: fond, source } = fondEffectif(el);
    const brut = parse(s.color);
    const alpha = brut.a * opaciteCumulee(el, source);
    if (alpha <= 0.02) continue;
    const avant = melange({ r: brut.r, g: brut.g, b: brut.b, a: alpha }, fond);
    const px = parseFloat(s.fontSize);
    const gras = parseInt(s.fontWeight, 10) >= 700;
    const grand = px >= 24 || (gras && px >= 18.66);
    const requis = grand ? 3 : 4.5;
    const r = ratio(avant, fond);
    if (r < requis) {
      constats.push({
        genre: el.matches(':disabled, :disabled *') ? 'texte-disabled' : 'texte',
        chemin: chemin(el),
        ratio: Math.round(r * 100) / 100,
        requis,
        couleur: s.color,
        fond: 'rgb(' + Math.round(fond.r) + ',' + Math.round(fond.g) + ',' + Math.round(fond.b) + ')',
        opacite: Math.round(opaciteCumulee(el, source) * 100) / 100,
        extrait: (el.textContent || '').trim().slice(0, 40),
      });
    }
  }

  // 2. Bordures de champs et de boutons (WCAG 1.4.11 : 3:1 contre le fond voisin).
  for (const el of document.querySelectorAll('input, select, textarea, button, [role="tab"]')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const l = parseFloat(s.borderTopWidth);
    if (!(l > 0) || s.borderTopStyle === 'none') continue;
    const parent = el.parentElement;
    if (!parent) continue;
    const { couleur: fond } = fondEffectif(parent);
    const bord = parse(s.borderTopColor);
    if (bord.a <= 0.02) continue;
    // WCAG 1.4.11 demande que la LIMITE du composant soit perceptible, pas que
    // ce soit forcément la bordure qui la porte. Si le remplissage du contrôle
    // tranche déjà sur son entourage (bouton blanc posé sur le bandeau bleu),
    // la forme se voit et la bordure n'a plus rien à prouver.
    const remplissage = parse(s.backgroundColor);
    if (remplissage.a > 0.02) {
      const fill = melange(remplissage, fond);
      if (ratio(fill, fond) >= 3) continue;
    }
    const avant = melange(bord, fond);
    const r = ratio(avant, fond);
    if (r < 3) {
      constats.push({
        genre: el.matches(':disabled') ? 'bordure-disabled' : 'bordure',
        chemin: chemin(el),
        ratio: Math.round(r * 100) / 100,
        requis: 3,
        couleur: s.borderTopColor,
        fond: 'rgb(' + Math.round(fond.r) + ',' + Math.round(fond.g) + ',' + Math.round(fond.b) + ')',
        opacite: 1,
        extrait: (el.getAttribute('name') || el.getAttribute('type') || el.tagName).slice(0, 40),
      });
    }
  }
  return constats;
})()`;

/** Balaie l'anneau de focus : `.focus()` puis mesure de l'outline / box-shadow. */
const SCRIPT_FOCUS = `(() => {
  const parse = (c) => {
    const m = /rgba?\\(([^)]+)\\)/.exec(c);
    if (!m) return { r: 0, g: 0, b: 0, a: 0 };
    const p = m[1].split(/[,\\s/]+/).filter(Boolean).map(Number);
    return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] === undefined ? 1 : p[3] };
  };
  const melange = (d, b) => ({
    r: d.r * d.a + b.r * (1 - d.a),
    g: d.g * d.a + b.g * (1 - d.a),
    b: d.b * d.a + b.b * (1 - d.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const chemin = (el) => {
    const bouts = [];
    let n = el;
    for (let i = 0; n && i < 4; i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) s += '#' + n.id;
      else if (n.className && typeof n.className === 'string') s += '.' + n.className.trim().split(/\\s+/).slice(0, 3).join('.');
      bouts.unshift(s);
      n = n.parentElement;
    }
    return bouts.join(' > ');
  };
  const fondEffectif = (el) => {
    const pile = [];
    let n = el;
    while (n) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg.a > 0) pile.push(bg);
      if (bg.a === 1) break;
      n = n.parentElement;
    }
    let res = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = pile.length - 1; i >= 0; i--) res = melange(pile[i], res);
    return res;
  };
  const constats = [];
  const cibles = Array.from(document.querySelectorAll(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )).filter((el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }).slice(0, 80);

  for (const el of cibles) {
    el.focus();
    const s = getComputedStyle(el);
    // Fond DERRIÈRE l'anneau : celui du parent (l'anneau est peint à l'extérieur).
    const fond = fondEffectif(el.parentElement || document.body);
    const largeur = parseFloat(s.outlineWidth);
    const aOutline = largeur > 0 && s.outlineStyle !== 'none';
    const ombre = s.boxShadow && s.boxShadow !== 'none';
    if (!aOutline && !ombre) {
      constats.push({
        genre: 'focus-absent', chemin: chemin(el), ratio: 0, requis: 3,
        couleur: 'aucun', fond: 'rgb(' + Math.round(fond.r) + ',' + Math.round(fond.g) + ',' + Math.round(fond.b) + ')',
        opacite: 1, extrait: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
      });
      continue;
    }
    if (!aOutline) continue;
    const c = parse(s.outlineColor);
    if (c.a <= 0.02) continue;
    const avant = melange(c, fond);
    const r = ratio(avant, fond);
    if (r < 3) {
      constats.push({
        genre: 'focus', chemin: chemin(el), ratio: Math.round(r * 100) / 100, requis: 3,
        couleur: s.outlineColor,
        fond: 'rgb(' + Math.round(fond.r) + ',' + Math.round(fond.g) + ',' + Math.round(fond.b) + ')',
        opacite: 1, extrait: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
      });
    }
  }
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  return constats;
})()`;

/**
 * Empreinte des styles CALCULÉS de chaque élément. C'est le filet qui manque au
 * dépôt : il n'y a qu'un seul fichier CSS, aucun snapshot de rendu, et la suite
 * axe ne voit ni une colonne de grille qui change, ni un bloc `@media` déplacé
 * qui réveille un conflit d'ordre. Comparée avant/après, cette empreinte prouve
 * qu'une réorganisation de `styles.css` ou une résorption de style inline est
 * réellement à iso-rendu.
 *
 * La clé est le CHEMIN D'INDEX depuis `<body>` : stable tant que la structure du
 * DOM ne bouge pas — ce qui est précisément l'invariant à démontrer.
 */
const SCRIPT_EMPREINTE = `(() => {
  const PROPS = [
    'display','position','flex-direction','flex-wrap','flex-grow','grid-template-columns',
    'width','height','min-height','max-width','padding','margin','gap',
    'font-size','font-weight','line-height','text-align','text-decoration-line','white-space',
    'color','background-color','border-width','border-style','border-color','border-radius',
    'outline-width','outline-style','outline-color','box-shadow','opacity','z-index',
    'overflow-x','overflow-y','visibility','vertical-align','align-items','justify-content',
  ];
  const empreinte = {};
  const marcher = (el, cle) => {
    const s = getComputedStyle(el);
    const vals = [];
    for (const p of PROPS) vals.push(s.getPropertyValue(p));
    let nom = el.tagName.toLowerCase();
    if (typeof el.className === 'string' && el.className.trim()) {
      nom += '.' + el.className.trim().split(/\\s+/).join('.');
    }
    empreinte[cle + '|' + nom] = vals.join('~');
    let i = 0;
    for (const enfant of el.children) marcher(enfant, cle + '/' + i++);
  };
  marcher(document.body, 'b');
  return empreinte;
})()`;

interface Constat {
  genre: string;
  chemin: string;
  ratio: number;
  requis: number;
  couleur: string;
  fond: string;
  opacite: number;
  extrait: string;
}

const ROUTES: readonly { nom: string; url: string }[] = [
  { nom: 'dashboard', url: `/foyers/${FOYER_ID}/dashboard` },
  { nom: 'foyer-new', url: '/foyers/new' },
  { nom: 'foyer-modifier', url: `/foyers/${FOYER_ID}/modifier` },
  { nom: 'contrats', url: `/foyers/${FOYER_ID}/contrats` },
  { nom: 'planning', url: `/foyers/${FOYER_ID}/planning?mois=${MOIS}` },
  {
    nom: 'planning-simule',
    url: `/foyers/${FOYER_ID}/planning?mois=${MOIS}&simule=true`,
  },
  { nom: 'couts', url: `/foyers/${FOYER_ID}/couts?simule=true` },
  { nom: 'etablissements', url: `/foyers/${FOYER_ID}/etablissements` },
  { nom: 'mon-profil', url: '/mon-profil' },
  { nom: 'tarifs', url: '/tarifs' },
  { nom: 'mes-foyers', url: '/mes-foyers' },
  { nom: 'desabonnement', url: '/desabonnement' },
  { nom: 'introuvable', url: '/route-qui-nexiste-pas' },
];

const VIEWPORTS = [
  { nom: '375', largeur: 375, hauteur: 812 },
  { nom: '1280', largeur: 1280, hauteur: 800 },
];

test.describe.configure({ mode: 'serial' });

/**
 * Sonde NÉGATIVE : un balayage qui sort « 0 constat » ne prouve rien tant qu'on
 * n'a pas vérifié qu'il sait crier. On injecte trois défauts connus — dont les
 * deux angles morts d'axe (opacité d'ancêtre, bordure de champ) — et on exige
 * qu'ils soient tous les trois détectés.
 */
const SCRIPT_SONDE = `(() => {
  const d = document.createElement('div');
  d.id = 'sonde-contraste';
  d.style.cssText = 'position:fixed;top:0;left:0;background:#ffffff;padding:4px;z-index:99999';
  // (1) texte gris clair sur blanc — ratio ~1.6
  const t = document.createElement('p');
  t.textContent = 'sonde texte faible';
  t.style.cssText = 'color:#dddddd;background:#ffffff;font-size:14px;margin:0';
  d.appendChild(t);
  // (2) opacité portée par l'ANCÊTRE (axe ne la voit pas) : noir sur blanc à 0.15
  const groupe = document.createElement('div');
  groupe.style.cssText = 'opacity:0.15;background:transparent';
  const t2 = document.createElement('p');
  t2.textContent = 'sonde opacite ancetre';
  t2.style.cssText = 'color:#000000;font-size:14px;margin:0';
  groupe.appendChild(t2);
  d.appendChild(groupe);
  // (3) bordure de champ quasi invisible (WCAG 1.4.11)
  const i = document.createElement('input');
  i.name = 'sonde-bordure';
  i.style.cssText = 'border:1px solid #fbfbfb;background:#ffffff';
  d.appendChild(i);
  document.body.appendChild(d);
})()`;

test('balayage des contrastes (getComputedStyle)', async ({ page }) => {
  test.setTimeout(300_000);
  // Une exception au montage vide `#root` et rendrait le balayage aveugle : on
  // la journalise pour que la garde de fin soit diagnosticable d'un coup d'œil.
  // (On n'écoute PAS `requestfailed` : Playwright y signale chaque route
  // interceptée, ce qui noierait le signal.)
  page.on('pageerror', (e) => {
    console.log(`[contrastes] ERREUR DE PAGE : ${e.message}`);
  });
  await amorcerStockage(page);
  await mockerBff(page);

  // --- Sonde négative, avant toute mesure réelle -----------------------------
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/foyers/${FOYER_ID}/dashboard`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(500);
  await page.evaluate(SCRIPT_SONDE);
  const sondes = ((await page.evaluate(SCRIPT_MESURE)) as Constat[]).filter(
    (c) => c.chemin.includes('sonde-contraste'),
  );
  const extraits = sondes.map((c) => `${c.genre}:${c.ratio}`).join(', ');
  console.log(
    `[contrastes] sonde négative → ${sondes.length} défaut(s) : ${extraits}`,
  );
  expect(
    sondes.filter((c) => c.genre === 'texte' && c.extrait.includes('faible')),
    'la sonde « texte faible » doit être détectée',
  ).toHaveLength(1);
  expect(
    sondes.filter((c) => c.genre === 'texte' && c.opacite < 0.2),
    "la sonde « opacité d'ancêtre » doit être détectée",
  ).toHaveLength(1);
  expect(
    sondes.filter((c) => c.genre === 'bordure'),
    'la sonde « bordure de champ » doit être détectée',
  ).toHaveLength(1);

  const rapport: Record<string, Constat[]> = {};
  const empreintes: Record<string, Record<string, string>> = {};
  const debordements: string[] = [];

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.largeur, height: vp.hauteur });
    for (const route of ROUTES) {
      const cle = `${route.nom}@${vp.nom}`;
      await page.goto(route.url, { waitUntil: 'load' });
      // Attendre le MONTAGE RÉEL de React, pas seulement le document. Avec
      // `domcontentloaded` + un délai fixe, le serveur de dev n'avait pas fini de
      // transformer le graphe de modules : `#root` restait VIDE et le balayage
      // mesurait une page blanche — 0 constat, ce qui ressemblait trait pour
      // trait à un succès. C'est le défaut que la garde de fin verrouille.
      await page.waitForFunction(
        () => (document.querySelector('#root')?.childElementCount ?? 0) > 0,
        undefined,
        { timeout: 20_000 },
      );
      // Puis laisser les écrans de chargement se résoudre (les pages montent un
      // `ChargementPage` avant que les appels BFF mockés ne rendent la vue).
      await page.waitForTimeout(1200);
      // Neutralisation des transitions/animations : sans cela une propriété en
      // cours de transition reste figée sur sa valeur de départ (faux défaut).
      await page.addStyleTag({
        content:
          '*,*::before,*::after{transition:none !important;animation:none !important}',
      });
      await page.waitForTimeout(120);

      const texte = (await page.evaluate(SCRIPT_MESURE)) as Constat[];
      empreintes[cle] = (await page.evaluate(SCRIPT_EMPREINTE)) as Record<
        string,
        string
      >;
      // Le balayage de focus mute l'état de la page (`.focus()` en série) : il
      // passe APRÈS l'empreinte, qui doit refléter la page au repos.
      const focus = (await page.evaluate(SCRIPT_FOCUS)) as Constat[];
      rapport[cle] = [...texte, ...focus];

      if (vp.largeur === 375) {
        const trop = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (trop > 1) debordements.push(`${route.nom}: +${trop}px`);
      }
    }
  }

  const total = Object.values(rapport).reduce((n, c) => n + c.length, 0);
  const sortie = {
    genereLe: new Date().toISOString(),
    total,
    debordements,
    rapport,
    empreintes,
  };
  mkdirSync(dirname(SORTIE), { recursive: true });
  writeFileSync(SORTIE, JSON.stringify(sortie, null, 2), 'utf8');
  const nbElements = Object.values(empreintes).reduce(
    (n, e) => n + Object.keys(e).length,
    0,
  );
  console.log(`[contrastes] empreinte de ${nbElements} élément(s) capturée`);
  console.log(`[contrastes] ${total} constat(s) écrits dans ${SORTIE}`);
  for (const [cle, constats] of Object.entries(rapport)) {
    if (constats.length > 0) {
      console.log(`[contrastes] ${cle} → ${constats.length}`);
      for (const c of constats.slice(0, 8)) {
        console.log(
          `    ${c.genre} ${c.ratio}/${c.requis} ${c.chemin} « ${c.extrait} » (${c.couleur} sur ${c.fond}, op=${c.opacite})`,
        );
      }
    }
  }
  if (debordements.length > 0) {
    console.log(`[contrastes] débordements 375px : ${debordements.join(', ')}`);
  }

  // GARDE ANTI-BALAYAGE-À-VIDE. Un outil qui ne mesure rien rend « 0 constat »,
  // exactement comme un outil qui ne trouve rien : indiscernables. On exige donc
  // que CHAQUE route ait rendu une vraie page. Le seuil est bas à dessein — il
  // ne juge pas la richesse d'un écran, il détecte la page blanche.
  const maigres = Object.entries(empreintes)
    .map(([cle, e]) => [cle, Object.keys(e).length] as const)
    .filter(([, n]) => n < 15);
  expect(
    maigres.map(([cle, n]) => `${cle}: ${n} nœuds`),
    'aucune route ne doit rendre une page (quasi) vide — sinon le balayage ne prouve rien',
  ).toEqual([]);
});
