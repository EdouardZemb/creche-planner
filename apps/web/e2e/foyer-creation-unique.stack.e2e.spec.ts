import { test, expect } from '@playwright/test';

// Parcours « création unique de foyer » (P5, besoin B) — self-service de la 1ʳᵉ
// création + garde « create-once », contre la pile réelle.
//
// L'identité est injectée via l'en-tête de dev `X-Dev-User-Email` (la pile E2E
// tourne en NODE_ENV=development, cf. docker-compose.override.yml). Un e-mail
// SENTINELLE est dans ADMIN_EMAILS → l'identité de dev est NON-admin, ce qui
// active la garde create-once. `extraHTTPHeaders` (test.use) s'applique à la fois
// au navigateur (page) et au contexte API (request).
//
// ⚠️ Données : la 1ʳᵉ création persiste un foyer supplémentaire (pas de DELETE
// foyer côté API). On utilise un e-mail unique par exécution (pas de collision
// d'unicité globale) ; en CI la pile est détruite avec son volume (`down -v`).
// Le foyer seedé reste le plus ancien (tri par date croissante), donc les autres
// specs (mode hérité) continuent de le découvrir en tête.

const EMAIL = `createur-p5-${Date.now()}@example.test`;

interface DossierCree {
  foyer: { id: string };
}
interface MoiVue {
  email: string | null;
  foyers: string[];
}

test.describe('stack réelle : création unique de foyer (P5)', () => {
  test.use({ extraHTTPHeaders: { 'x-dev-user-email': EMAIL } });

  test('1ʳᵉ création OK, 2ᵉ refusée (409) et l’UI oriente vers l’édition', async ({
    page,
    request,
  }) => {
    const corps = {
      ressourcesMensuelles: 4000,
      rfr: 40000,
      nbEnfantsACharge: 1,
      nbParts: 2,
      enfants: [{ prenom: 'EnfantP5', dateNaissance: '2024-01-15' }],
      parents: [],
    };

    // 1ʳᵉ création (identité = EMAIL via en-tête de dev) → 201.
    const creation = await request.post('/api/v1/foyers', { data: corps });
    expect(creation.status()).toBe(201);
    const dossier = (await creation.json()) as DossierCree;
    const foyerId = dossier.foyer.id;

    // Le créateur a été rattaché comme parent → /moi le voit propriétaire.
    const moi = (await (await request.get('/api/v1/moi')).json()) as MoiVue;
    expect(moi.email).toBe(EMAIL);
    expect(moi.foyers).toContain(foyerId);

    // 2ᵉ création par la même identité → 409 (create-once).
    const refus = await request.post('/api/v1/foyers', { data: corps });
    expect(refus.status()).toBe(409);

    // UI : l'écran de création oriente vers l'édition (le formulaire est masqué).
    await page.goto('/foyers/new');
    await expect(page.getByText('Vous avez déjà une famille')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Créer ma famille' }),
    ).toHaveCount(0);
    await expect(
      page.locator('main').getByRole('link', { name: 'Voir ma famille' }),
    ).toHaveAttribute('href', `/foyers/${foyerId}/modifier`);
  });
});

// Session fraîche après création (lot 3) — après avoir créé sa famille via l'UI,
// revenir à l'accueil en navigation SPA (clic sur la marque, sans reload) doit
// router le nouveau parent vers son tableau de bord, jamais vers « Vous n'avez
// pas encore de foyer ». C'est la régression de fraîcheur corrigée par
// `MoiContext.recharger()`. E-mail unique : identité NON-admin distincte du
// scénario ci-dessus (garde create-once inactive tant qu'il n'a pas de foyer).
test.describe('stack réelle : session fraîche après création (lot 3)', () => {
  const EMAIL_FRAICHEUR = `fraicheur-lot3-${Date.now()}@example.test`;
  test.use({ extraHTTPHeaders: { 'x-dev-user-email': EMAIL_FRAICHEUR } });

  test('création via l’UI puis retour accueil (SPA) → dashboard, pas « pas encore de foyer »', async ({
    page,
  }) => {
    await page.goto('/foyers/new');

    // Formulaire réordonné (lot 3) : enfants, parents, ressources. En build de
    // prod les champs sont vides → on les remplit (parents laissés facultatifs).
    const enfants = page.getByRole('group', { name: 'Enfants' });
    await enfants.getByLabel(/Prénom/i).fill('EnfantFraicheur');
    await enfants.getByLabel(/Date de naissance/i).fill('2024-01-15');
    await page.getByLabel(/Ressources mensuelles/i).fill('4000');
    await page.getByLabel(/Revenu fiscal/i).fill('40000');
    await page.getByLabel(/enfants à charge/i).fill('1');
    await page.getByLabel(/parts fiscales/i).fill('2');

    await page.getByRole('button', { name: 'Créer ma famille' }).click();

    // La création aboutit sur la page Contrats du foyer neuf.
    await expect(page).toHaveURL(/\/foyers\/[^/]+\/contrats/);

    // Retour à l'accueil en navigation SPA (marque), sans rechargement complet.
    await page.getByRole('link', { name: 'Crèche Planner' }).click();

    // La session est fraîche : l'accueil route vers le dashboard du foyer…
    await expect(page).toHaveURL(/\/foyers\/[^/]+\/dashboard/);
    // …et jamais vers l'écran « pas encore de foyer ».
    await expect(
      page.getByText(/Vous n.avez pas encore créé votre famille/),
    ).toHaveCount(0);
  });
});
