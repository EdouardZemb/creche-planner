// @ts-check
/**
 * Collecte, pour UNE PR Dependabot, tout ce dont le tri a besoin, puis rend la
 * décision. La collecte vit ici, la politique dans `tri.mjs` (pur, testé).
 *
 * Chaque lecture qui échoue devient une raison de blocage nommée : une PR dont
 * on n'a pas pu lire les contrôles n'est pas « verte par défaut ».
 */
import {
  decider,
  examinerAvis,
  examinerControles,
  examinerPolitique,
} from './tri.mjs';

/**
 * @param {import('./github.mjs').Client} api
 * @param {string} depot
 * @param {any} brute PR telle que rendue par `GET /pulls/{n}` (pas la liste :
 *   seule la lecture unitaire calcule `mergeable_state`)
 * @returns {Promise<import('./tri.mjs').Verdict & { numero: number, titre: string, url: string, sha: string, ouverteLe: string }>}
 */
export async function evaluer(api, depot, brute) {
  const numero = Number(brute.number);
  const sha = String(brute.head?.sha ?? '');
  /** @type {import('./tri.mjs').Pr} */
  const pr = {
    numero,
    titre: String(brute.title ?? ''),
    auteur: {
      login: String(brute.user?.login ?? ''),
      type: String(brute.user?.type ?? ''),
    },
    brancheTete: String(brute.head?.ref ?? ''),
    depotTete: String(brute.head?.repo?.full_name ?? ''),
    depotBase: String(brute.base?.repo?.full_name ?? ''),
    brouillon: Boolean(brute.draft),
    corps: String(brute.body ?? ''),
    shaTete: sha,
    etatFusion: String(brute.mergeable_state ?? ''),
    ouverteLe: String(brute.created_at ?? ''),
  };
  const entete = {
    numero,
    titre: pr.titre,
    url: String(brute.html_url ?? ''),
    sha,
    ouverteLe: pr.ouverteLe,
  };

  /** @type {string[]} */
  const cecites = [];

  const commitsR = await api.lister(
    `repos/${depot}/pulls/${numero}/commits?per_page=100`,
  );
  if (!commitsR.ok) cecites.push(`commits illisibles (${commitsR.statut})`);
  const commits = commitsR.ok
    ? commitsR.donnees.map((c) => ({
        sha: String(c.sha ?? ''),
        auteur: c.author?.login ?? null,
        verifie: c.commit?.verification?.verified === true,
        message: String(c.commit?.message ?? ''),
      }))
    : [];

  const fichiersR = await api.lister(
    `repos/${depot}/pulls/${numero}/files?per_page=100`,
  );
  if (!fichiersR.ok) cecites.push(`fichiers illisibles (${fichiersR.statut})`);
  const fichiers = fichiersR.ok
    ? fichiersR.donnees.map((f) => String(f.filename ?? ''))
    : [];

  const politique = examinerPolitique(pr, commits, fichiers, depot);
  politique.bloquant.push(...cecites);

  // Avis de sécurité : base publique GitHub Advisory Database. Interrogée même
  // pour une PR déjà bloquée par ailleurs, pour que le récapitulatif puisse
  // classer une mise à jour de sécurité en PRIORITÉ plutôt que « à la main ».
  const ecosysteme =
    pr.brancheTete.split('/')[1] === 'npm_and_yarn' ? 'npm' : null;
  /** @type {import('./tri.mjs').Avis[]} */
  const avisDepart = [];
  /** @type {import('./tri.mjs').Avis[]} */
  const avisCible = [];
  if (ecosysteme !== null) {
    for (const d of politique.aVerifier) {
      avisDepart.push(await avisPour(api, ecosysteme, d.nom, d.depart));
      avisCible.push(await avisPour(api, ecosysteme, d.nom, d.cible));
    }
  }
  const avis = examinerAvis(avisDepart, avisCible);

  /** @type {import('./tri.mjs').Controle[]} */
  let controles = [];
  /** @type {{ contexte: string, etat: string }[]} */
  let statuts = [];
  /** @type {string[]} */
  const cecitesControles = [];
  if (sha === '') {
    cecitesControles.push('commit de tête inconnu');
  } else {
    const runsR = await api.lister(
      `repos/${depot}/commits/${sha}/check-runs?per_page=100&filter=latest`,
      'check_runs',
    );
    if (!runsR.ok)
      cecitesControles.push(`contrôles illisibles (${runsR.statut})`);
    else {
      controles = runsR.donnees.map((c) => ({
        nom: String(c.name ?? ''),
        statut: String(c.status ?? ''),
        conclusion: c.conclusion ?? null,
      }));
    }
    const statutsR = await api.lire(
      `repos/${depot}/commits/${sha}/status?per_page=100`,
    );
    if (!statutsR.ok)
      cecitesControles.push(`statuts illisibles (${statutsR.statut})`);
    else {
      statuts = (statutsR.donnees?.statuses ?? []).map((s) => ({
        contexte: String(s.context ?? ''),
        etat: String(s.state ?? ''),
      }));
    }
  }
  const etatControles = examinerControles(controles, statuts, pr.etatFusion);
  etatControles.echec.push(...cecitesControles);

  return { ...entete, ...decider(politique, avis, etatControles) };
}

/**
 * @param {import('./github.mjs').Client} api
 * @param {string} ecosysteme
 * @param {string} nom
 * @param {string} version
 * @returns {Promise<import('./tri.mjs').Avis>}
 */
async function avisPour(api, ecosysteme, nom, version) {
  const affecte = encodeURIComponent(`${nom}@${version}`);
  const r = await api.lister(
    `advisories?ecosystem=${ecosysteme}&affects=${affecte}&per_page=100`,
  );
  if (!r.ok) return { nom, ok: false, erreur: String(r.statut) };
  return {
    nom,
    ok: true,
    avis: r.donnees
      .filter((a) => !a.withdrawn_at)
      .map((a) => ({
        ghsa: String(a.ghsa_id ?? '?'),
        severite: String(a.severity ?? '?'),
      })),
  };
}
