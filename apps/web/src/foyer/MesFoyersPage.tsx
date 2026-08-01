import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DossierFoyerVue } from '../types/bff';
import { useAsync } from '../hooks/useAsync';
import { useTitrePage } from '../hooks/useTitrePage';
import { ChargementPage } from '../ui/ChargementPage';
import { EtatVide } from '../ui/EtatVide';
import { useMoi } from '../session/MoiContext';

/**
 * Page « mes foyers » (mode borné) : 0 foyer → `EtatVide` « Créer mon foyer »
 * (self-service de la 1ʳᵉ création, plus de renvoi vers un administrateur) ;
 * N foyers → sélecteur borné à l'ensemble autorisé. Atteinte depuis l'accueil ou
 * le lien « Mes foyers » de l'en-tête.
 */
export function MesFoyersPage() {
  const moi = useMoi();
  useTitrePage('Mes familles');
  if (moi.loading) {
    return <ChargementPage message="Chargement de votre session…" />;
  }
  if (moi.foyers.length === 0) {
    // P5 : self-service de la 1ʳᵉ création (besoin B). Sans foyer rattaché, on
    // propose de créer le sien plutôt que de renvoyer vers un administrateur.
    return (
      <EtatVide
        titrePrincipal
        titre="Vous n’avez pas encore créé votre famille"
        description="Créez votre famille pour commencer à planifier la garde de vos enfants."
        actions={[
          { libelle: 'Créer ma famille', href: '/foyers/new', primaire: true },
        ]}
      />
    );
  }
  return <SelecteurFamilles ids={moi.foyers} />;
}

/**
 * Libellé lisible d'une famille (fonction pure) pour le sélecteur multi-foyer.
 * `FoyerVue` n'a AUCUN nom : l'identité naturelle pour un parent, ce sont les
 * prénoms de ses enfants. Ordre de repli :
 *   1. enfants présents → « Famille de <prénoms en français> » (Intl.ListFormat) ;
 *   2. sinon parent principal → « Famille <prénom nom> », à défaut son e-mail ;
 *   3. sinon → « Ma famille » (repli ultime, jamais un ordinal).
 */
function libelleFamille(dossier: DossierFoyerVue): string {
  const prenoms = dossier.enfants
    .map((enfant) => enfant.prenom.trim())
    .filter((prenom) => prenom.length > 0);
  if (prenoms.length > 0) {
    const liste = new Intl.ListFormat('fr', {
      style: 'long',
      type: 'conjunction',
    }).format(prenoms);
    return `Famille de ${liste}`;
  }
  const principal =
    dossier.parents.find((parent) => parent.principal) ?? dossier.parents[0];
  if (principal !== undefined) {
    const prenom = principal.prenom?.trim() ?? '';
    const nom = principal.nom?.trim() ?? '';
    const nomComplet = [prenom, nom]
      .filter((part) => part.length > 0)
      .join(' ');
    if (nomComplet.length > 0) {
      return `Famille ${nomComplet}`;
    }
    return principal.email;
  }
  return 'Ma famille';
}

/** Une famille du sélecteur : son id + son dossier chargé (`null` = échec isolé). */
interface FamilleChargee {
  readonly id: string;
  readonly dossier: DossierFoyerVue | null;
}

/**
 * Sélecteur « Mes familles » (mode borné, multi-foyer — cas rare : `foyers.length
 * > 1`). Charge le dossier de CHAQUE foyer autorisé (`api.lireFoyer`) pour en
 * dériver un libellé lisible, puis affiche une liste de cartes cliquables vers
 * chaque tableau de bord. Dégradation gracieuse par carte : l'échec d'un dossier
 * n'ampute jamais les familles chargées (repli « Ouvrir cette famille ») ; si
 * TOUS échouent, un `EtatVide` « Réessayer ».
 */
function SelecteurFamilles({ ids }: { ids: readonly string[] }) {
  // Clé stable pour ne relancer le fetch groupé que si l'ensemble d'ids change.
  const cle = ids.join(',');
  const { data, loading, error, reload } = useAsync<readonly FamilleChargee[]>(
    (signal) =>
      Promise.all(
        ids.map((id) =>
          api
            .lireFoyer(id, { signal })
            .then((dossier): FamilleChargee => ({ id, dossier }))
            .catch((erreur: unknown): FamilleChargee => {
              // Dégradation par carte : un dossier en échec ne bloque pas les
              // autres. Une vraie annulation (démontage / changement d'ids) est
              // re-levée pour rester silencieuse — useAsync l'ignore.
              if (signal.aborted) throw erreur;
              return { id, dossier: null };
            }),
        ),
      ),
    [cle],
  );

  if (loading) {
    return <ChargementPage message="Chargement de vos familles…" />;
  }

  const familles = data ?? [];
  const aucuneChargee = familles.every((famille) => famille.dossier === null);
  if (error !== null || (familles.length > 0 && aucuneChargee)) {
    return (
      <EtatVide
        titrePrincipal
        titre="Impossible de charger vos familles"
        description="Une erreur est survenue. Vérifiez votre connexion, puis réessayez."
        actions={[{ libelle: 'Réessayer', onClick: reload, primaire: true }]}
      />
    );
  }

  return (
    <section className="selecteur-familles">
      <h1 className="selecteur-familles-titre">Choisir une famille</h1>
      <p className="selecteur-familles-intro muted">
        Plusieurs familles vous sont rattachées. Choisissez celle à ouvrir.
      </p>
      <ul className="selecteur-familles-liste">
        {familles.map(({ id, dossier }) => {
          const libelle =
            dossier !== null ? libelleFamille(dossier) : 'Ouvrir cette famille';
          const nbEnfants = dossier !== null ? dossier.enfants.length : 0;
          return (
            <li key={id}>
              <Link
                to={`/foyers/${id}/dashboard`}
                className="selecteur-famille-carte"
              >
                <span className="selecteur-famille-nom">{libelle}</span>
                {nbEnfants > 0 && (
                  <span className="selecteur-famille-detail" aria-hidden="true">
                    {nbEnfants > 1 ? `${nbEnfants} enfants` : '1 enfant'}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
