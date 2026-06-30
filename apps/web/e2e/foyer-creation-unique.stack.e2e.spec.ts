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
    await expect(page.getByText('Vous avez déjà un foyer')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Créer le foyer' }),
    ).toHaveCount(0);
    await expect(
      page.locator('main').getByRole('link', { name: 'Modifier mon foyer' }),
    ).toHaveAttribute('href', `/foyers/${foyerId}/modifier`);
  });
});
