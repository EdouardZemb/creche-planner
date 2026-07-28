import { type FormEvent, useId, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { GrilleAbcmVue, PublierGrille } from '../types/bff';
import { centimesEnEuros } from '../utils/money';
import { formaterDateFr } from '../utils/dates';
import { messageErreur } from '../utils/erreurs';
import { useAsync } from '../hooks/useAsync';
import { useTitrePage } from '../hooks/useTitrePage';
import { Spinner } from '../ui/Spinner';
import { EtatVide } from '../ui/EtatVide';

/** Aujourd'hui au format ISO `YYYY-MM-DD` (comparaison lexicographique). */
function aujourdhuiIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type StatutGrille = 'preparation' | 'active' | 'passee';

interface PeriodeGrille {
  readonly cle: string;
  readonly valideDu: string;
  readonly valideAu: string | null;
  readonly statut: StatutGrille;
  readonly lignes: readonly GrilleAbcmVue[];
}

/** Statut d'une grille au regard d'aujourd'hui (bornes ISO inclusives). */
function statutGrille(
  valideDu: string,
  valideAu: string | null,
  aujourdhui: string,
): StatutGrille {
  if (valideDu > aujourdhui) return 'preparation';
  if (valideAu !== null && valideAu < aujourdhui) return 'passee';
  return 'active';
}

const LIBELLE_STATUT: Record<StatutGrille, string> = {
  preparation: 'en préparation',
  active: 'active',
  passee: 'passée',
};

/**
 * Regroupe les lignes de grille (une par tranche) par **période** de validité, de
 * la plus récente à la plus ancienne (le service les trie déjà ainsi), et calcule
 * le statut de chaque période. Une « grille » à l'écran = une période et ses tranches.
 */
function grouperParPeriode(
  lignes: readonly GrilleAbcmVue[],
  aujourdhui: string,
): PeriodeGrille[] {
  const parCle = new Map<string, GrilleAbcmVue[]>();
  const ordre: string[] = [];
  for (const ligne of lignes) {
    const cle = `${ligne.valideDu}__${ligne.valideAu ?? ''}`;
    const groupe = parCle.get(cle);
    if (groupe === undefined) {
      parCle.set(cle, [ligne]);
      ordre.push(cle);
    } else {
      groupe.push(ligne);
    }
  }
  return ordre.map((cle) => {
    const groupe = parCle.get(cle) ?? [];
    const premiere = groupe[0];
    const valideDu = premiere?.valideDu ?? '';
    const valideAu = premiere?.valideAu ?? null;
    return {
      cle,
      valideDu,
      valideAu,
      statut: statutGrille(valideDu, valideAu, aujourdhui),
      lignes: [...groupe].sort((a, b) => a.tranche - b.tranche),
    };
  });
}

/** Message clair pour un chevanchement (409 `PERIODE_CHEVAUCHANTE`) ou autre erreur. */
function messagePublication(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.status === 409 &&
    typeof err.corps === 'object' &&
    err.corps !== null &&
    (err.corps as Record<string, unknown>)['code'] === 'PERIODE_CHEVAUCHANTE'
  ) {
    return 'Cette période chevauche une grille déjà enregistrée. Choisissez une date de début après la grille en cours, ou une période sans recoupement.';
  }
  return messageErreur(err);
}

/** Les 7 postes tarifaires d'une ligne de tranche (montants saisis en euros, chaînes). */
interface SaisieTranche {
  cantineTotal: string;
  cantinePartGarde: string;
  periMatin: string;
  periSoir: string;
  alshJourneeComplete: string;
  alshDemiJournee: string;
  alshRepas: string;
}

const TRANCHE_VIDE: SaisieTranche = {
  cantineTotal: '',
  cantinePartGarde: '',
  periMatin: '',
  periSoir: '',
  alshJourneeComplete: '',
  alshDemiJournee: '',
  alshRepas: '',
};

const NIVEAUX_TRANCHE = [1, 2, 3] as const;

const POSTES: readonly {
  readonly cle: keyof SaisieTranche;
  readonly libelle: string;
  readonly requis: boolean;
}[] = [
  { cle: 'cantineTotal', libelle: 'Cantine (repas)', requis: true },
  {
    cle: 'cantinePartGarde',
    libelle: 'Cantine — part garde (PAI)',
    requis: false,
  },
  { cle: 'periMatin', libelle: 'Périscolaire matin', requis: true },
  { cle: 'periSoir', libelle: 'Périscolaire soir', requis: true },
  {
    cle: 'alshJourneeComplete',
    libelle: 'ALSH journée complète',
    requis: true,
  },
  { cle: 'alshDemiJournee', libelle: 'ALSH demi-journée', requis: true },
  { cle: 'alshRepas', libelle: 'ALSH repas', requis: true },
];

/** Convertit une saisie euros (chaîne) en nombre ; NaN si vide/illisible. */
function nombre(valeur: string): number {
  return Number.parseFloat(valeur.replace(',', '.'));
}

/**
 * Écran « Tarifs » (SFD 30, US-30-02, lot 6) : le parent consulte les grilles ABCM
 * du catalogue (par période, « en préparation / active / passée ») et **publie** la
 * grille d'une nouvelle année depuis le PDF de l'établissement — sans redéploiement.
 * Le catalogue est global (pas de foyer). Montants saisis en euros, stockés en
 * centimes côté service. Une période chevauchante est refusée avec un message clair.
 */
export function TarifsPage() {
  useTitrePage('Tarifs');
  const idPrefixe = useId();
  const {
    data: grilles,
    loading,
    error,
    reload,
  } = useAsync<readonly GrilleAbcmVue[]>(
    (signal) => api.listerGrilles({ signal }),
    [],
  );

  const [valideDu, setValideDu] = useState('');
  const [valideAu, setValideAu] = useState('');
  const [tranches, setTranches] = useState<SaisieTranche[]>(() =>
    NIVEAUX_TRANCHE.map(() => ({ ...TRANCHE_VIDE })),
  );
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [messageEnvoi, setMessageEnvoi] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const alerteRef = useRef<HTMLParagraphElement>(null);

  const aujourdhui = aujourdhuiIso();
  const periodes = useMemo(
    () => grouperParPeriode(grilles ?? [], aujourdhui),
    [grilles, aujourdhui],
  );

  const majTranche = (
    index: number,
    cle: keyof SaisieTranche,
    valeur: string,
  ): void => {
    setTranches((liste) =>
      liste.map((t, i) => (i === index ? { ...t, [cle]: valeur } : t)),
    );
  };

  const reinitialiser = (): void => {
    setValideDu('');
    setValideAu('');
    setTranches(NIVEAUX_TRANCHE.map(() => ({ ...TRANCHE_VIDE })));
  };

  const soumettre = (evenement: FormEvent): void => {
    evenement.preventDefault();
    setMessageEnvoi(null);
    setSucces(null);

    const lignes: PublierGrille['tranches'] = tranches.map((t, i) => {
      const niveau = NIVEAUX_TRANCHE[i] ?? i + 1;
      const partGarde = nombre(t.cantinePartGarde);
      return {
        tranche: niveau,
        cantineTotal: nombre(t.cantineTotal),
        periMatin: nombre(t.periMatin),
        periSoir: nombre(t.periSoir),
        alshJourneeComplete: nombre(t.alshJourneeComplete),
        alshDemiJournee: nombre(t.alshDemiJournee),
        alshRepas: nombre(t.alshRepas),
        ...(t.cantinePartGarde.trim() !== '' && !Number.isNaN(partGarde)
          ? { cantinePartGarde: partGarde }
          : {}),
      };
    });

    const montantsInvalides = lignes.some((l) =>
      [
        l.cantineTotal,
        l.periMatin,
        l.periSoir,
        l.alshJourneeComplete,
        l.alshDemiJournee,
        l.alshRepas,
      ].some((v) => Number.isNaN(v) || v < 0),
    );
    if (valideDu === '' || montantsInvalides) {
      setMessageEnvoi(
        'Renseignez la date de début et un montant (en euros) pour chaque poste des trois tranches.',
      );
      alerteRef.current?.focus();
      return;
    }

    const corps: PublierGrille = {
      valideDu,
      tranches: lignes,
      ...(valideAu !== '' ? { valideAu } : {}),
    };

    setEnvoiEnCours(true);
    api
      .publierGrille(corps)
      .then(() => {
        setSucces(
          'Grille enregistrée. Elle s’appliquera à sa période de validité.',
        );
        reinitialiser();
        reload();
      })
      .catch((err: unknown) => {
        setMessageEnvoi(messagePublication(err));
        alerteRef.current?.focus();
      })
      .finally(() => {
        setEnvoiEnCours(false);
      });
  };

  return (
    <div className="page-etroite">
      <h1 style={{ marginTop: 0 }}>Tarifs</h1>
      <p className="muted">
        Les grilles de l’association (cantine, périscolaire, ALSH) par année.
        Une nouvelle grille prend effet à sa date de début : les mois d’avant
        gardent les anciens tarifs.
      </p>

      <section
        aria-labelledby={`${idPrefixe}-liste`}
        style={{ marginTop: 'var(--esp-5)' }}
      >
        <h2 id={`${idPrefixe}-liste`} style={{ fontSize: '1.1rem' }}>
          Grilles enregistrées
        </h2>
        {loading && <Spinner label="Chargement des grilles…" />}
        {!loading && error !== null && (
          <p role="alert" className="muted">
            {error}
          </p>
        )}
        {!loading && error === null && periodes.length === 0 && (
          <EtatVide
            titre="Aucune grille enregistrée"
            description="Publiez la première grille avec le formulaire ci-dessous."
          />
        )}
        {!loading &&
          periodes.map((periode) => (
            <article
              key={periode.cle}
              className="carte"
              style={{ marginBottom: 'var(--esp-3)' }}
            >
              <h3 style={{ margin: 0, fontSize: '1rem' }}>
                Grille du {formaterDateFr(periode.valideDu)}
                {periode.valideAu !== null
                  ? ` au ${formaterDateFr(periode.valideAu)}`
                  : ''}{' '}
                <span className="muted">
                  — {LIBELLE_STATUT[periode.statut]}
                </span>
              </h3>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 'var(--esp-2) 0 0',
                }}
              >
                {periode.lignes.map((ligne) => (
                  <li
                    key={ligne.id}
                    className="muted"
                    style={{
                      padding: '0.25rem 0',
                      borderTop: '1px solid var(--bordure)',
                    }}
                  >
                    <strong>Tranche {ligne.tranche}</strong> — cantine{' '}
                    {centimesEnEuros(ligne.cantineTotalCentimes)}, péri matin{' '}
                    {centimesEnEuros(ligne.periMatinCentimes)}, péri soir{' '}
                    {centimesEnEuros(ligne.periSoirCentimes)}, ALSH journée{' '}
                    {centimesEnEuros(ligne.alshJourneeCompleteCentimes)}
                  </li>
                ))}
              </ul>
            </article>
          ))}
      </section>

      <section
        aria-labelledby={`${idPrefixe}-form`}
        style={{ marginTop: 'var(--esp-5)' }}
      >
        <h2 id={`${idPrefixe}-form`} style={{ fontSize: '1.1rem' }}>
          Publier une nouvelle grille
        </h2>
        <form onSubmit={soumettre} noValidate>
          <div
            style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--esp-3)' }}
          >
            <label style={{ display: 'flex', flexDirection: 'column' }}>
              <span>À partir du</span>
              <input
                type="date"
                value={valideDu}
                onChange={(e) => {
                  setValideDu(e.target.value);
                }}
                required
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column' }}>
              <span>Jusqu’au (facultatif)</span>
              <input
                type="date"
                value={valideAu}
                onChange={(e) => {
                  setValideAu(e.target.value);
                }}
              />
            </label>
          </div>

          {tranches.map((t, index) => {
            const niveau = NIVEAUX_TRANCHE[index] ?? index + 1;
            return (
              <fieldset
                key={niveau}
                style={{
                  marginTop: 'var(--esp-3)',
                  border: '1px solid var(--bordure)',
                  borderRadius: '10px',
                  padding: 'var(--esp-3)',
                }}
              >
                <legend>Tranche {niveau} (montants en euros)</legend>
                {POSTES.map((poste) => {
                  const idChamp = `${idPrefixe}-t${String(niveau)}-${poste.cle}`;
                  return (
                    <label
                      key={poste.cle}
                      htmlFor={idChamp}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        marginTop: 'var(--esp-2)',
                      }}
                    >
                      <span>
                        {poste.libelle}
                        {poste.requis ? '' : ' (facultatif)'}
                      </span>
                      <input
                        id={idChamp}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={t[poste.cle]}
                        onChange={(e) => {
                          majTranche(index, poste.cle, e.target.value);
                        }}
                        required={poste.requis}
                      />
                    </label>
                  );
                })}
              </fieldset>
            );
          })}

          {messageEnvoi !== null && (
            <p
              ref={alerteRef}
              role="alert"
              tabIndex={-1}
              className="debit"
              style={{ marginTop: 'var(--esp-3)' }}
            >
              {messageEnvoi}
            </p>
          )}
          {succes !== null && (
            <p
              role="status"
              className="credit"
              style={{ marginTop: 'var(--esp-3)' }}
            >
              {succes}
            </p>
          )}

          <button
            type="submit"
            className="btn"
            disabled={envoiEnCours}
            style={{ marginTop: 'var(--esp-3)' }}
          >
            {envoiEnCours ? 'Enregistrement…' : 'Publier la grille'}
          </button>
        </form>
      </section>
    </div>
  );
}
