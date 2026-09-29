// @ts-check
/**
 * Client minimal de l'API REST GitHub (Node pur, zéro dépendance).
 *
 * Même règle cardinale que la veille des alertes : un appel qui échoue rend
 * `{ ok: false }`, JAMAIS une liste vide. C'est à l'appelant de décider quoi
 * faire d'une cécité ; ce module ne la déguise jamais en « rien à signaler ».
 */

const API = 'https://api.github.com';
const PAGES_MAX = 10;

/**
 * @template T
 * @typedef {{ ok: true, donnees: T } | { ok: false, statut: number | string, detail: string }} Reponse
 */

/**
 * Résout un chemin en URL de l'API, ou `null` si elle sortirait de l'API.
 *
 * Le jeton part avec la requête : c'est ici que se joue la fuite. Une URL
 * absolue n'est acceptée que si son ORIGINE est exactement celle de l'API — un
 * test de préfixe laisserait passer `https://api.github.com.evil.example`
 * (alerte CodeQL `js/incomplete-url-substring-sanitization`). Les URL absolues
 * ne viennent que de l'en-tête `Link` de pagination, mais ce module ne présume
 * pas de ses appelants.
 *
 * @param {string} chemin
 * @returns {string | null}
 */
export function urlApi(chemin) {
  let url;
  try {
    url = /^[a-z][a-z0-9+.-]*:/i.test(chemin)
      ? new URL(chemin)
      : new URL(chemin.replace(/^\/+/, ''), `${API}/`);
  } catch {
    return null;
  }
  return url.origin === API && url.username === '' && url.password === ''
    ? url.href
    : null;
}

/**
 * @param {string} jeton
 * @param {string} [agent]
 */
export function client(jeton, agent = 'creche-planner-dependances') {
  const entetes = {
    authorization: `Bearer ${jeton}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': agent,
  };

  /**
   * @param {string} methode
   * @param {string} chemin chemin relatif à l'API, ou URL absolue de l'API
   * @param {unknown} [corps]
   * @returns {Promise<{ ok: true, donnees: any, suivant: string } | { ok: false, statut: number | string, detail: string }>}
   */
  async function appeler(methode, chemin, corps) {
    const url = urlApi(chemin);
    if (url === null) {
      return {
        ok: false,
        statut: 'url',
        detail: 'URL hors de l’API GitHub refusée',
      };
    }
    let reponse;
    try {
      reponse = await fetch(url, {
        method: methode,
        headers:
          corps === undefined
            ? entetes
            : { ...entetes, 'content-type': 'application/json' },
        body: corps === undefined ? undefined : JSON.stringify(corps),
      });
    } catch (erreur) {
      return {
        ok: false,
        statut: 'réseau',
        detail: erreur instanceof Error ? erreur.message : String(erreur),
      };
    }
    if (!reponse.ok) {
      return {
        ok: false,
        statut: reponse.status,
        detail: (await reponse.text()).slice(0, 300),
      };
    }
    const texte = await reponse.text();
    let donnees = null;
    if (texte !== '') {
      try {
        donnees = JSON.parse(texte);
      } catch {
        return {
          ok: false,
          statut: reponse.status,
          detail: 'réponse non JSON',
        };
      }
    }
    const m = /<([^>]+)>;\s*rel="next"/.exec(reponse.headers.get('link') ?? '');
    return { ok: true, donnees, suivant: m ? m[1] : '' };
  }

  return {
    /**
     * @param {string} chemin
     * @returns {Promise<Reponse<any>>}
     */
    async lire(chemin) {
      const r = await appeler('GET', chemin);
      return r.ok ? { ok: true, donnees: r.donnees } : r;
    },

    /**
     * Toutes les pages d'une liste. `cle` désigne le tableau quand la réponse
     * est un objet (`check_runs`, `workflow_runs`…).
     *
     * @param {string} chemin
     * @param {string} [cle]
     * @returns {Promise<Reponse<any[]>>}
     */
    async lister(chemin, cle) {
      /** @type {any[]} */
      const tout = [];
      let url = chemin;
      for (let page = 0; page < PAGES_MAX && url; page++) {
        const r = await appeler('GET', url);
        if (!r.ok) return r;
        const lot = cle === undefined ? r.donnees : r.donnees?.[cle];
        if (!Array.isArray(lot)) {
          return { ok: false, statut: 'format', detail: 'tableau attendu' };
        }
        tout.push(...lot);
        url = r.suivant;
      }
      if (url) {
        return {
          ok: false,
          statut: 'pagination',
          detail: `plus de ${PAGES_MAX} pages : liste tronquée`,
        };
      }
      return { ok: true, donnees: tout };
    },

    /**
     * @param {'POST' | 'PATCH' | 'PUT'} methode
     * @param {string} chemin
     * @param {unknown} corps
     * @returns {Promise<Reponse<any>>}
     */
    async ecrire(methode, chemin, corps) {
      const r = await appeler(methode, chemin, corps);
      return r.ok ? { ok: true, donnees: r.donnees } : r;
    },
  };
}

/** @typedef {ReturnType<typeof client>} Client */
