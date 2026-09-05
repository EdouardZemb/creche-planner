import { useCallback, useEffect, useId, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type {
  EtablissementFoyerVue,
  ExceptionCalendrierVue,
  PeriodeCalendrierVue,
  RecurrencesCalendrierVue,
} from '../types/bff';
import { messageErreur } from '../utils/erreurs';
import { useTitrePage } from '../hooks/useTitrePage';
import { Bouton, BoutonLien } from '../ui/Bouton';
import { ChampFormulaire } from '../ui/ChampFormulaire';
import { EtatVide } from '../ui/EtatVide';
import { ChargementPage } from '../ui/ChargementPage';

/**
 * **Écran « Calendrier » d'un établissement** — SFD 31, US-31-01 / US-31-02.
 *
 * Le parent y fait trois choses : il déclare la **zone** de vacances de
 * l'établissement, il **importe** l'année scolaire officielle, et il **retouche**
 * ce que l'officiel ne dit pas (journée pédagogique, pont, fermeture propre à
 * l'établissement).
 *
 * ## Ce que l'écran montre — et ce qu'il ne montre pas
 *
 * Il liste les **couches brutes** : les périodes telles qu'elles sont posées et
 * les exceptions telles qu'elles sont saisies. Il ne montre PAS le calendrier
 * résolu (« ce jour-là, la cantine est-elle ouverte ? ») : c'est un autre écran,
 * et surtout une autre question. Mélanger les deux ferait qu'on ne saurait plus,
 * devant une anomalie, si c'est la saisie ou la résolution qui est fautive.
 *
 * ## Le vocabulaire dit ce qui se passe
 *
 * On « retire » une exception, on ne la « supprime » pas : côté base, l'action
 * **clôt** la ligne, qui reste lisible à un instant de connaissance antérieur.
 * Écrire « supprimer définitivement » serait un mensonge d'interface — et
 * exactement le genre de mensonge qui fait douter du reste.
 */
export function CalendrierPage() {
  useTitrePage('Calendrier');
  const { foyerId, etabId } = useParams<{ foyerId: string; etabId: string }>();

  const [etablissement, setEtablissement] =
    useState<EtablissementFoyerVue | null>(null);
  const [periodes, setPeriodes] = useState<PeriodeCalendrierVue[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionCalendrierVue[]>([]);
  const [recurrences, setRecurrences] =
    useState<RecurrencesCalendrierVue | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    if (foyerId === undefined || etabId === undefined) return;
    setChargement(true);
    try {
      const [etabs, vuePeriodes, vueExceptions, vueRecurrences] =
        await Promise.all([
          api.listerEtablissements(foyerId),
          api.lirePeriodesCalendrier(foyerId, etabId),
          api.lireExceptionsCalendrier(foyerId, etabId),
          api.lireRecurrencesCalendrier(foyerId, etabId),
        ]);
      setEtablissement(etabs.find((e) => e.id === etabId) ?? null);
      setPeriodes(vuePeriodes.periodes);
      setExceptions(vueExceptions.exceptions);
      setRecurrences(vueRecurrences);
      setErreur(null);
    } catch (cause) {
      setErreur(messageErreur(cause));
    } finally {
      setChargement(false);
    }
  }, [foyerId, etabId]);

  useEffect(() => {
    // `void` seul suffit : `charger` pose son propre état de chargement de façon
    // asynchrone, l'effet ne fait qu'amorcer.
    const amorce = setTimeout(() => void charger(), 0);
    return () => {
      clearTimeout(amorce);
    };
  }, [charger]);

  if (chargement) return <ChargementPage message="Chargement du calendrier…" />;
  if (foyerId === undefined || etabId === undefined) return null;

  return (
    <section>
      <h1>Calendrier{etablissement ? ` — ${etablissement.nom}` : ''}</h1>

      {erreur !== null && (
        <p role="alert" className="message-erreur">
          {erreur}
        </p>
      )}
      {info !== null && (
        <p role="status" className="message-succes">
          {info}
        </p>
      )}

      <ZoneEtImport
        foyerId={foyerId}
        etabId={etabId}
        etablissement={etablissement}
        surErreur={setErreur}
        surInfo={setInfo}
        surChangement={charger}
      />

      <ListePeriodes periodes={periodes} />

      <Exceptions
        foyerId={foyerId}
        etabId={etabId}
        exceptions={exceptions}
        surErreur={setErreur}
        surInfo={setInfo}
        surChangement={charger}
      />

      <SemaineType recurrences={recurrences} />

      <p>
        <BoutonLien to={`/foyers/${foyerId}/etablissements`}>
          Retour aux crèches &amp; écoles
        </BoutonLien>
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────── zone et import

const ANNEES = ['2026-2027', '2027-2028'] as const;

function ZoneEtImport({
  foyerId,
  etabId,
  etablissement,
  surErreur,
  surInfo,
  surChangement,
}: {
  foyerId: string;
  etabId: string;
  etablissement: EtablissementFoyerVue | null;
  surErreur: (m: string | null) => void;
  surInfo: (m: string | null) => void;
  surChangement: () => Promise<void>;
}) {
  const idZone = useId();
  const idAnnee = useId();
  const [annee, setAnnee] = useState<string>(ANNEES[0]);
  const [enCours, setEnCours] = useState(false);
  const zone = etablissement?.zoneScolaire ?? '';

  async function changerZone(valeur: string): Promise<void> {
    if (etablissement === null) return;
    surErreur(null);
    surInfo(null);
    try {
      await api.modifierEtablissement(foyerId, etabId, {
        nom: etablissement.nom,
        // La zone est la SEULE chose que ce champ change. Le reste est renvoyé
        // tel quel : un PUT partiel effacerait ce qu'il ne cite pas.
        zoneScolaire: valeur === '' ? null : valeur,
      } as never);
      await surChangement();
      surInfo(
        valeur === ''
          ? 'Zone retirée. L’import d’une année n’est plus possible.'
          : `Zone ${valeur} enregistrée.`,
      );
    } catch (cause) {
      surErreur(messageErreur(cause));
    }
  }

  async function importer(): Promise<void> {
    surErreur(null);
    surInfo(null);
    setEnCours(true);
    try {
      const vue = await api.importerCalendrier(foyerId, etabId, annee);
      await surChangement();
      surInfo(
        vue.remplacees > 0
          ? `${String(vue.importees)} périodes rafraîchies pour ${vue.anneeScolaire} (zone ${vue.zoneScolaire}). Vos saisies sont intactes.`
          : `${String(vue.importees)} périodes importées pour ${vue.anneeScolaire} (zone ${vue.zoneScolaire}).`,
      );
    } catch (cause) {
      // CA3 : l'écran reste utilisable. On dit ce qui a échoué, on ne bloque rien.
      surErreur(
        cause instanceof ApiError
          ? messageErreur(cause)
          : 'L’import n’a pas abouti. La saisie manuelle reste possible ci-dessous.',
      );
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section aria-labelledby={`${idZone}-titre`}>
      <h2 id={`${idZone}-titre`}>Année scolaire</h2>

      <ChampFormulaire id={idZone} libelle="Zone de vacances">
        {(controle) => (
        <select
          {...controle}
          value={zone}
          onChange={(e) => void changerZone(e.target.value)}
        >
          <option value="">Aucune (pas de calendrier scolaire)</option>
          <option value="A">Zone A</option>
          <option value="B">Zone B</option>
          <option value="C">Zone C</option>
        </select>
        )}
      </ChampFormulaire>

      <ChampFormulaire id={idAnnee} libelle="Année à importer">
        {(controle) => (
        <select
          {...controle}
          value={annee}
          onChange={(e) => {
            setAnnee(e.target.value);
          }}
        >
          {ANNEES.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        )}
      </ChampFormulaire>

      <Bouton
        type="button"
        onClick={() => void importer()}
        disabled={zone === '' || enCours}
      >
        {enCours ? 'Import en cours…' : `Importer l’année ${annee}`}
      </Bouton>
      {zone === '' && (
        <p className="aide">
          Choisissez d’abord une zone : c’est elle qui dit quel calendrier
          officiel importer.
        </p>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────── périodes

function ListePeriodes({ periodes }: { periodes: PeriodeCalendrierVue[] }) {
  const idTitre = useId();
  return (
    <section aria-labelledby={idTitre}>
      <h2 id={idTitre}>Périodes</h2>
      {periodes.length === 0 ? (
        <EtatVide
          titre="Aucune période"
          description="Importez une année scolaire, ou saisissez vos fermetures à la main."
        />
      ) : (
        <ul>
          {periodes.map((p) => (
            <li key={p.id}>
              <strong>{p.libelle}</strong>{' '}
              <span>
                du {formaterJour(p.du)} au {formaterJour(p.au)}
              </span>{' '}
              {/* Le badge n'est pas décoratif : il dit ce qu'un réimport
                  emportera. Une période « saisie » survit, une « importée » est
                  remplacée. */}
              <span className="badge">
                {p.source === 'IMPORT' ? 'importé' : 'saisi'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────── exceptions

const TYPES_EXCEPTION = [
  { valeur: 'JOURNEE_PEDAGOGIQUE', libelle: 'Journée pédagogique' },
  { valeur: 'PONT', libelle: 'Pont' },
  { valeur: 'FERMETURE', libelle: 'Fermeture exceptionnelle' },
  { valeur: 'OUVERTURE', libelle: 'Ouverture exceptionnelle' },
] as const;

function Exceptions({
  foyerId,
  etabId,
  exceptions,
  surErreur,
  surInfo,
  surChangement,
}: {
  foyerId: string;
  etabId: string;
  exceptions: ExceptionCalendrierVue[];
  surErreur: (m: string | null) => void;
  surInfo: (m: string | null) => void;
  surChangement: () => Promise<void>;
}) {
  const idTitre = useId();
  const idJour = useId();
  const idType = useId();
  const idLibelle = useId();
  const [jour, setJour] = useState('');
  const [type, setType] = useState<string>(TYPES_EXCEPTION[0].valeur);
  const [libelle, setLibelle] = useState('');
  const [enCours, setEnCours] = useState(false);

  // Type structurel plutôt que `FormEvent`, déprécié par les typages React.
  async function poser(e: { preventDefault: () => void }): Promise<void> {
    e.preventDefault();
    surErreur(null);
    surInfo(null);
    setEnCours(true);
    try {
      await api.poserExceptionCalendrier(foyerId, etabId, {
        jour,
        type,
        libelle,
      } as never);
      setJour('');
      setLibelle('');
      await surChangement();
      surInfo('Exception ajoutée.');
    } catch (cause) {
      surErreur(messageErreur(cause));
    } finally {
      setEnCours(false);
    }
  }

  async function retirer(id: string): Promise<void> {
    surErreur(null);
    surInfo(null);
    try {
      await api.cloreExceptionCalendrier(foyerId, etabId, id);
      await surChangement();
      surInfo('Exception retirée. Elle reste lisible dans l’historique.');
    } catch (cause) {
      surErreur(messageErreur(cause));
    }
  }

  return (
    <section aria-labelledby={idTitre}>
      <h2 id={idTitre}>Journées particulières</h2>
      <p className="aide">
        Ce que le calendrier officiel ne dit pas : journées pédagogiques, ponts,
        fermetures propres à l’établissement. Un réimport ne les touche jamais.
      </p>

      <form onSubmit={(e) => void poser(e)}>
        <ChampFormulaire id={idJour} libelle="Jour">
        {(controle) => (
          <input
            {...controle}
            type="date"
            value={jour}
            required
            onChange={(e) => {
            setJour(e.target.value);
          }}
          />
        )}
      </ChampFormulaire>
        <ChampFormulaire id={idType} libelle="Nature">
        {(controle) => (
          <select
            {...controle}
            value={type}
            onChange={(e) => {
            setType(e.target.value);
          }}
          >
            {TYPES_EXCEPTION.map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.libelle}
              </option>
            ))}
          </select>
        )}
      </ChampFormulaire>
        <ChampFormulaire id={idLibelle} libelle="Intitulé">
        {(controle) => (
          <input
            {...controle}
            type="text"
            value={libelle}
            required
            maxLength={200}
            onChange={(e) => {
            setLibelle(e.target.value);
          }}
          />
        )}
      </ChampFormulaire>
        <Bouton type="submit" disabled={enCours}>
          Ajouter
        </Bouton>
      </form>

      {exceptions.length === 0 ? (
        <EtatVide
          titre="Aucune journée particulière"
          description="Rien à signaler pour l’instant."
        />
      ) : (
        <ul>
          {exceptions.map((x) => (
            <li key={x.id}>
              <strong>{formaterJour(x.jour)}</strong> — {x.libelle}{' '}
              <span className="badge">{libelleType(x.type)}</span>{' '}
              <Bouton
                type="button"
                variante="secondaire"
                onClick={() => void retirer(x.id)}
              >
                Retirer
              </Bouton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ────────────────────────────────────────────────────────────── semaine type

const JOURS_SEMAINE = [
  'LUNDI',
  'MARDI',
  'MERCREDI',
  'JEUDI',
  'VENDREDI',
] as const;

/**
 * Semaine type, en **lecture** pour ce lot.
 *
 * L'édition de la récurrence est le geste le plus lourd de cet écran (grille
 * jours × services, par régime) et elle n'a de valeur qu'une fois la
 * sélectionnabilité branchée — c'est le lot 5. La montrer ici, en revanche, est
 * indispensable : sans elle, le parent ne comprend pas pourquoi un jour de
 * période scolaire n'ouvre pas les mêmes services qu'un jour de vacances.
 */
function SemaineType({
  recurrences,
}: {
  recurrences: RecurrencesCalendrierVue | null;
}) {
  const idTitre = useId();
  if (recurrences === null) return null;
  const parRegime = (regime: string) =>
    recurrences.recurrences.filter((r) => r.regime === regime);

  return (
    <section aria-labelledby={idTitre}>
      <h2 id={idTitre}>Semaine type</h2>
      {(['SCOLAIRE', 'VACANCES'] as const).map((regime) => {
        const lignes = parRegime(regime);
        return (
          <div key={regime}>
            <h3>{regime === 'SCOLAIRE' ? 'En période scolaire' : 'Pendant les vacances'}</h3>
            {lignes.length === 0 ? (
              <p className="aide">Aucun service ouvert déclaré.</p>
            ) : (
              <ul>
                {JOURS_SEMAINE.map((jour) => {
                  const ligne = lignes.find((r) => r.jourSemaine === jour);
                  if (ligne === undefined) return null;
                  return (
                    <li key={jour}>
                      {libelleJourSemaine(jour)} :{' '}
                      {ligne.services.length === 0
                        ? 'fermé'
                        : ligne.services.join(', ')}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────── libellés

/** `2026-10-17` → `17/10/2026`. Pas d'`Intl` ici : la valeur est déjà une date
 *  calendaire métier, la reformater par un fuseau la décalerait. */
function formaterJour(iso: string): string {
  const [a = '', m = '', j = ''] = iso.split('-');
  return `${j}/${m}/${a}`;
}

function libelleType(type: string): string {
  return (
    TYPES_EXCEPTION.find((t) => t.valeur === type)?.libelle ?? type
  );
}

function libelleJourSemaine(jour: string): string {
  const libelles: Record<string, string> = {
    LUNDI: 'Lundi',
    MARDI: 'Mardi',
    MERCREDI: 'Mercredi',
    JEUDI: 'Jeudi',
    VENDREDI: 'Vendredi',
  };
  return libelles[jour] ?? jour;
}
