import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import type {
  FoyerClient,
  FoyerVue,
  ParentVue,
} from '../clients/foyer.client.js';
import type { NotificationsClient } from '../clients/notifications.client.js';
import type { PlanificationClient } from '../clients/planification.client.js';
import { FoyersController } from './foyers.controller.js';

const FOYER: FoyerVue = {
  id: 'foyer-1',
  ressourcesMensuellesCentimes: 671692,
  ressourcesMensuellesEuros: 6716.92,
  rfrCentimes: 7270500,
  rfrEuros: 72705,
  nbEnfantsACharge: 2,
  nbParts: 3,
  tranche: 3,
};

const parent = (p: Partial<ParentVue> & Pick<ParentVue, 'id'>): ParentVue => ({
  foyerId: 'foyer-1',
  prenom: 'Alex',
  nom: 'Dupont',
  email: 'alex@example.test',
  principal: false,
  ordre: 0,
  actif: true,
  ...p,
});

/**
 * Construit le contrôleur avec des clients doublés. `PlanificationClient` et
 * `NotificationsClient` ne servent qu'à l'export de portabilité (lot 3) : les
 * tests qui ne le visent pas les laissent vides.
 */
function controleur(
  foyers: Partial<FoyerClient>,
  planification: Partial<PlanificationClient> = {},
  notifications: Partial<NotificationsClient> = {},
): FoyersController {
  return new FoyersController(
    foyers as FoyerClient,
    planification as PlanificationClient,
    notifications as NotificationsClient,
  );
}

describe('FoyersController · création atomique', () => {
  it('crée le dossier via un seul appel svc-foyer (foyer + enfants + parents)', async () => {
    const dossier = {
      foyer: FOYER,
      enfants: [
        {
          id: 'e1',
          foyerId: 'foyer-1',
          prenom: 'Mia',
          dateNaissance: '2024-12-08',
        },
      ],
      parents: [
        parent({ id: 'p1', email: 'alex@example.test', principal: true }),
      ],
    };
    const creerFoyer = vi.fn().mockResolvedValue(dossier);
    const controller = controleur({
      creerFoyer,
    });

    const vue = await controller.creer({
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
      enfants: [{ prenom: 'Mia', dateNaissance: '2024-12-08' }],
      parents: [{ email: 'alex@example.test', principal: true }],
    });

    // Un seul appel amont : enfants et parents voyagent dans la commande.
    expect(creerFoyer).toHaveBeenCalledOnce();
    expect(creerFoyer).toHaveBeenCalledWith({
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
      enfants: [{ prenom: 'Mia', dateNaissance: '2024-12-08' }],
      parents: [{ email: 'alex@example.test', principal: true }],
    });
    expect(vue.parents).toHaveLength(1);
    expect(vue.parents[0]?.email).toBe('alex@example.test');
  });

  it('accepte une création sans enfants ni parents (défauts [])', async () => {
    const creerFoyer = vi
      .fn()
      .mockResolvedValue({ foyer: FOYER, enfants: [], parents: [] });
    const controller = controleur({
      creerFoyer,
    });

    const vue = await controller.creer({
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
    });

    expect(creerFoyer).toHaveBeenCalledWith({
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
      enfants: [],
      parents: [],
    });
    expect(vue.parents).toEqual([]);
  });

  it('refuse un parent à l’e-mail invalide (400, sans appel amont)', () => {
    const creerFoyer = vi.fn();
    const controller = controleur({
      creerFoyer,
    });

    expect(() =>
      controller.creer({
        ressourcesMensuelles: 6716.92,
        rfr: 72705,
        nbEnfantsACharge: 2,
        nbParts: 3,
        parents: [{ email: 'pas-un-email' }],
      }),
    ).toThrow(BadRequestException);
    expect(creerFoyer).not.toHaveBeenCalled();
  });

  // P5 — le rattachement du créateur vit désormais dans `svc-foyer` : la gateway se
  // borne à transmettre (ou non) `createurEmail`. Sans identité (mode hérité) rien
  // n'est transmis ; une identité non-admin fournit son e-mail.
  it('mode hérité (sans identité) : ne transmet aucun createurEmail', async () => {
    const creerFoyer = vi
      .fn()
      .mockResolvedValue({ foyer: FOYER, enfants: [], parents: [] });
    const controller = controleur({
      creerFoyer,
    });

    await controller.creer({
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
    });

    const arg = creerFoyer.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('createurEmail' in arg).toBe(false);
  });

  it('identité non-admin : transmet createurEmail (rattachement svc-foyer)', async () => {
    const creerFoyer = vi
      .fn()
      .mockResolvedValue({ foyer: FOYER, enfants: [], parents: [] });
    const controller = controleur({
      creerFoyer,
    });

    await controller.creer(
      {
        ressourcesMensuelles: 6716.92,
        rfr: 72705,
        nbEnfantsACharge: 2,
        nbParts: 3,
      },
      { headers: {}, identite: { email: 'createur@example.test' } },
    );

    expect(creerFoyer).toHaveBeenCalledWith(
      expect.objectContaining({ createurEmail: 'createur@example.test' }),
    );
  });

  it('identité admin : ne transmet pas createurEmail (provisioning pour autrui)', async () => {
    const envInitial = { ...process.env };
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    try {
      const creerFoyer = vi
        .fn()
        .mockResolvedValue({ foyer: FOYER, enfants: [], parents: [] });
      const controller = controleur({
        creerFoyer,
      });

      await controller.creer(
        {
          ressourcesMensuelles: 6716.92,
          rfr: 72705,
          nbEnfantsACharge: 2,
          nbParts: 3,
        },
        { headers: {}, identite: { email: 'admin@example.test' } },
      );

      const arg = creerFoyer.mock.calls[0]?.[0] as Record<string, unknown>;
      expect('createurEmail' in arg).toBe(false);
    } finally {
      process.env = envInitial;
    }
  });

  it('propage un 409 amont en HttpException (relais, dossier annulé côté svc-foyer)', async () => {
    const creerFoyer = vi.fn().mockRejectedValue(new Error('HTTP 409'));
    const controller = controleur({
      creerFoyer,
    });

    await expect(
      controller.creer({
        ressourcesMensuelles: 6716.92,
        rfr: 72705,
        nbEnfantsACharge: 2,
        nbParts: 3,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('FoyersController · édition des scalaires', () => {
  it('valide puis relaie l’édition des scalaires', async () => {
    const mettreAJour = vi.fn().mockResolvedValue(FOYER);
    const controller = controleur({
      mettreAJour,
    });

    const vue = await controller.mettreAJour('foyer-1', {
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
    });

    expect(mettreAJour).toHaveBeenCalledWith('foyer-1', {
      ressourcesMensuelles: 6716.92,
      rfr: 72705,
      nbEnfantsACharge: 2,
      nbParts: 3,
    });
    expect(vue).toEqual(FOYER);
  });

  it('refuse un corps invalide (400, sans appel amont)', () => {
    const mettreAJour = vi.fn();
    const controller = controleur({
      mettreAJour,
    });

    expect(() =>
      controller.mettreAJour('foyer-1', { ressourcesMensuelles: -1 }),
    ).toThrow(BadRequestException);
    expect(mettreAJour).not.toHaveBeenCalled();
  });

  it('propage une erreur amont en HttpException (relais)', async () => {
    const mettreAJour = vi.fn().mockRejectedValue(new Error('HTTP 404'));
    const controller = controleur({
      mettreAJour,
    });

    await expect(
      controller.mettreAJour('foyer-1', {
        ressourcesMensuelles: 6716.92,
        rfr: 72705,
        nbEnfantsACharge: 2,
        nbParts: 3,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('FoyersController · ajout d’enfant', () => {
  it('valide puis relaie le rattachement d’un enfant', async () => {
    const ajouterEnfant = vi
      .fn()
      .mockResolvedValue({ id: 'e1', foyerId: 'foyer-1' });
    const controller = controleur({
      ajouterEnfant,
    });

    await controller.ajouterEnfant('foyer-1', {
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    });

    expect(ajouterEnfant).toHaveBeenCalledWith('foyer-1', {
      prenom: 'Mia',
      dateNaissance: '2024-12-08',
    });
  });

  it('refuse un enfant sans prénom (400, sans appel amont)', () => {
    const ajouterEnfant = vi.fn();
    const controller = controleur({
      ajouterEnfant,
    });

    expect(() =>
      controller.ajouterEnfant('foyer-1', { dateNaissance: '2024-12-08' }),
    ).toThrow(BadRequestException);
    expect(ajouterEnfant).not.toHaveBeenCalled();
  });
});

describe('FoyersController · lecture agrégée', () => {
  it('agrège foyer, enfants et parents', async () => {
    const controller = controleur({
      foyer: vi.fn().mockResolvedValue(FOYER),
      enfants: vi.fn().mockResolvedValue([{ id: 'e1' }]),
      parents: vi.fn().mockResolvedValue([parent({ id: 'p1' })]),
    });

    const vue = await controller.lire('foyer-1');

    expect(vue.foyer).toEqual(FOYER);
    expect(vue.enfants).toHaveLength(1);
    expect(vue.parents).toHaveLength(1);
  });
});

describe('FoyersController · liste scopée à l’identité (lot 5)', () => {
  const AUTRE_FOYER: FoyerVue = { ...FOYER, id: 'foyer-2' };
  let envInitial: NodeJS.ProcessEnv;

  beforeEach(() => {
    envInitial = { ...process.env };
    delete process.env['ADMIN_EMAILS'];
  });
  afterEach(() => {
    process.env = envInitial;
  });

  it('mode hérité (sans identité) : renvoie la liste complète', async () => {
    const lister = vi.fn().mockResolvedValue([FOYER, AUTRE_FOYER]);
    const foyersParEmail = vi.fn();
    const controller = controleur({
      lister,
      foyersParEmail,
    });

    const vue = await controller.lister();

    expect(vue).toHaveLength(2);
    expect(foyersParEmail).not.toHaveBeenCalled();
  });

  it('admin identifié : renvoie la liste complète (provisioning)', async () => {
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const lister = vi.fn().mockResolvedValue([FOYER, AUTRE_FOYER]);
    const foyersParEmail = vi.fn();
    const controller = controleur({
      lister,
      foyersParEmail,
    });

    const vue = await controller.lister({
      headers: {},
      identite: { email: 'admin@example.test' },
    });

    expect(vue).toHaveLength(2);
    expect(foyersParEmail).not.toHaveBeenCalled();
  });

  it('non-admin identifié : ne renvoie que ses foyers', async () => {
    // ADMIN_EMAILS non vide ⇒ gating actif ⇒ le non-admin est bien scopé.
    process.env['ADMIN_EMAILS'] = 'admin@example.test';
    const lister = vi.fn().mockResolvedValue([FOYER, AUTRE_FOYER]);
    const foyersParEmail = vi.fn().mockResolvedValue(['foyer-2']);
    const controller = controleur({
      lister,
      foyersParEmail,
    });

    const vue = await controller.lister({
      headers: {},
      identite: { email: 'parent@example.test' },
    });

    expect(foyersParEmail).toHaveBeenCalledWith('parent@example.test');
    expect(vue).toEqual([AUTRE_FOYER]);
  });

  // AN-17 — ce cas assertait l'inverse : « gating admin inactif ⇒ permissif ⇒ liste
  // complète ». Le défaut n'était donc pas seulement écrit, il était **tenu par un
  // test** : aucune porte ne pouvait le trouver. L'idiome « allowlist vide ⇒ tout le
  // monde passe » vaut pour une affordance d'écran, pas pour une réponse qui porte le
  // revenu et le RFR de tous les foyers de la base.
  it('ADMIN_EMAILS vide : un client identifié ne voit QUE ses foyers', async () => {
    const lister = vi.fn().mockResolvedValue([FOYER, AUTRE_FOYER]);
    const foyersParEmail = vi.fn().mockResolvedValue(['foyer-2']);
    const controller = controleur({
      lister,
      foyersParEmail,
    });

    const vue = await controller.lister({
      headers: {},
      identite: { email: 'parent@example.test' },
    });

    expect(foyersParEmail).toHaveBeenCalledWith('parent@example.test');
    expect(vue).toEqual([AUTRE_FOYER]);
  });

  it('ADMIN_EMAILS vide : aucun foyer rattaché ⇒ liste vide, pas la liste globale', async () => {
    const lister = vi.fn().mockResolvedValue([FOYER, AUTRE_FOYER]);
    const foyersParEmail = vi.fn().mockResolvedValue([]);
    const controller = controleur({
      lister,
      foyersParEmail,
    });

    const vue = await controller.lister({
      headers: {},
      identite: { email: 'inconnu@example.test' },
    });

    expect(vue).toEqual([]);
  });
});

describe('FoyersController · effacement du foyer', () => {
  it('relaie la suppression au service foyer', async () => {
    const supprimerFoyer = vi.fn().mockResolvedValue(undefined);
    const controller = controleur({
      supprimerFoyer,
    });

    await controller.supprimer('foyer-1');

    expect(supprimerFoyer).toHaveBeenCalledWith('foyer-1');
  });

  it('propage un 404 amont plutôt que de le taire (geste non rejouable)', async () => {
    const supprimerFoyer = vi.fn().mockRejectedValue(new Error('HTTP 404'));
    const controller = controleur({
      supprimerFoyer,
    });

    await expect(controller.supprimer('foyer-1')).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});

describe('FoyersController · CRUD parents', () => {
  it('liste les parents', async () => {
    const parents = vi.fn().mockResolvedValue([parent({ id: 'p1' })]);
    const controller = controleur({
      parents,
    });

    const vue = await controller.listerParents('foyer-1');

    expect(parents).toHaveBeenCalledWith('foyer-1');
    expect(vue).toHaveLength(1);
  });

  it('rattache un parent (valide puis relaie)', async () => {
    const ajouterParent = vi.fn().mockResolvedValue(parent({ id: 'p1' }));
    const controller = controleur({
      ajouterParent,
    });

    await controller.ajouterParent('foyer-1', { email: 'alex@example.test' });

    expect(ajouterParent).toHaveBeenCalledWith('foyer-1', {
      email: 'alex@example.test',
    });
  });

  it('refuse l’ajout d’un e-mail invalide (400, sans appel amont)', () => {
    const ajouterParent = vi.fn();
    const controller = controleur({
      ajouterParent,
    });

    expect(() =>
      controller.ajouterParent('foyer-1', { email: 'nope' }),
    ).toThrow(BadRequestException);
    expect(ajouterParent).not.toHaveBeenCalled();
  });

  it('édite un parent (champs fournis uniquement)', async () => {
    const modifierParent = vi
      .fn()
      .mockResolvedValue(parent({ id: 'p1', principal: true }));
    const controller = controleur({
      modifierParent,
    });

    await controller.modifierParent('foyer-1', 'p1', { principal: true });

    expect(modifierParent).toHaveBeenCalledWith('foyer-1', 'p1', {
      principal: true,
    });
  });

  it('retire un parent', async () => {
    const retirerParent = vi.fn().mockResolvedValue(undefined);
    const controller = controleur({
      retirerParent,
    });

    await controller.retirerParent('foyer-1', 'p1');

    expect(retirerParent).toHaveBeenCalledWith('foyer-1', 'p1');
  });

  it('propage une erreur amont en HttpException (relais)', async () => {
    const ajouterParent = vi.fn().mockRejectedValue(new Error('HTTP 409'));
    const controller = controleur({
      ajouterParent,
    });

    await expect(
      controller.ajouterParent('foyer-1', { email: 'alex@example.test' }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('FoyersController · export de portabilité', () => {
  const PART_FOYER = {
    situationCourante: { id: 'foyer-1' },
    versionsRessources: [],
    correctionsRessources: [],
    enfants: [{ prenom: 'Mia' }],
    parents: [{ email: 'alex@example.test' }],
    preferencesNotification: [],
    jetonsDesabonnement: [],
  };
  const PART_PLANIF = { contrats: [{ id: 'c1' }], etablissements: [] };
  const PART_NOTIF = {
    validationsHebdo: [],
    envoisRecapFoyer: [],
    envoisRecapParent: [],
    envoisEtablissement: [],
    messagesInApp: [],
  };

  it('agrège les trois services sources en un seul document', async () => {
    const exporterFoyer = vi.fn().mockResolvedValue(PART_FOYER);
    const exporterPlanif = vi.fn().mockResolvedValue(PART_PLANIF);
    const exporterNotif = vi.fn().mockResolvedValue(PART_NOTIF);
    const controller = controleur(
      { exporter: exporterFoyer },
      { exporter: exporterPlanif },
      { exporter: exporterNotif },
    );

    const vue = await controller.exporter('foyer-1');

    expect(exporterFoyer).toHaveBeenCalledWith('foyer-1');
    expect(exporterPlanif).toHaveBeenCalledWith('foyer-1');
    expect(exporterNotif).toHaveBeenCalledWith('foyer-1');
    expect(vue.foyerId).toBe('foyer-1');
    expect(vue.situationFoyer.enfants).toEqual([{ prenom: 'Mia' }]);
    expect(vue.gardeEtPlanning.contrats).toEqual([{ id: 'c1' }]);
    expect(vue.communications.messagesInApp).toEqual([]);
    expect(vue.genereLe).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // Le point de conception du lot : ailleurs (aperçu d'impact, préférences de
  // /moi), un amont muet fait perdre un enrichissement. Ici il ferait livrer un
  // export AMPUTÉ SANS LE DIRE — un document qui affirme être complet et ne l'est
  // pas. Un seul service en panne doit donc faire échouer l'export entier.
  it.each([
    ['svc-planification', 1],
    ['svc-notifications', 2],
  ])(
    'échoue si %s ne répond pas, plutôt que de livrer un export amputé',
    async (_service, rang) => {
      const doubles = [
        vi.fn().mockResolvedValue(PART_FOYER),
        vi.fn().mockResolvedValue(PART_PLANIF),
        vi.fn().mockResolvedValue(PART_NOTIF),
      ];
      doubles[rang] = vi
        .fn()
        .mockRejectedValue(new Error('service injoignable'));
      const controller = controleur(
        { exporter: doubles[0] } as unknown as FoyerClient,
        { exporter: doubles[1] } as unknown as PlanificationClient,
        { exporter: doubles[2] } as unknown as NotificationsClient,
      );

      await expect(controller.exporter('foyer-1')).rejects.toMatchObject({
        status: 502,
      });
    },
  );

  it('relaie le 404 d’un foyer inconnu tel quel', async () => {
    const controller = controleur(
      {
        exporter: vi.fn().mockRejectedValue(new Error('HTTP 404')),
      },
      { exporter: vi.fn().mockResolvedValue(PART_PLANIF) },
      { exporter: vi.fn().mockResolvedValue(PART_NOTIF) },
    );

    await expect(controller.exporter('inconnu')).rejects.toMatchObject({
      status: 404,
    });
  });
});
