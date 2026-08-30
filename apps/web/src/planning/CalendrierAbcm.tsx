import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DateClickArg } from '@fullcalendar/interaction';
import type {
  ContratLocal,
  JourAlsh,
  ExceptionAbcm,
  CreerContratAbcm,
  LienEtablissementSaisie,
} from '../types/bff';
import { joursDuMois, jourSemaineDeIso, formaterDateFr } from '../utils/dates';
import { libelleAlsh } from '../notifications/besoinsSemaine';
import { couleurDuMode } from '../utils/couleurs';
import { couleurAjoute, couleurRetire } from './couleursPlanning';
import { SocleCalendrier } from './SocleCalendrier';
import { ListeJoursClavier, type LigneJourClavier } from './ListeJoursClavier';
import { ModaleAjustementAbcm } from './ModaleAjustementAbcm';
import { ModaleJourneeAlsh, type FormuleAlsh } from './ModaleJourneeAlsh';
import {
  socleContratDurable,
  useCalendrierContrat,
} from './useCalendrierContrat';
import { ecartJoursAbcm, evenementsAbcm } from './evenementsAbcm';
import {
  alshEffectifDe,
  effectifActif,
  effectifJour,
  exceptionDe,
  exceptionPourDate,
  inscriptionsTemplate,
  alshRecurrent,
  type ContexteAbcm,
  type Effectif,
  type EtatAlsh,
  type ModeAbcm,
} from './inscriptionsAbcm';

export interface CalendrierAbcmProps {
  contrat: ContratLocal;
  mois: string;
  simule: boolean;
  onEnregistre: () => void;
  /** Appelé après une modification durable du contrat (recharge nécessaire). */
  onContratModifie?: () => void;
}

/** Calendrier mensuel ABCM (CANTINE, PERISCOLAIRE, ALSH). */
export function CalendrierAbcm({
  contrat,
  mois,
  simule,
  onEnregistre,
  onContratModifie,
}: CalendrierAbcmProps) {
  const mode = contrat.mode as ModeAbcm;

  const [pai, setPai] = useState<boolean | undefined>(undefined);
  const [joursAlsh, setJoursAlsh] = useState<EtatAlsh[]>([]);
  // Ajustements ponctuels par date (CANTINE / PERISCOLAIRE).
  const [exceptions, setExceptions] = useState<ExceptionAbcm[]>([]);

  // Remplacement complet du contrat (PUT) pour la portée « tous les X » : la
  // semaine ABCM modifiée est le payload, le reste du contrat est reconduit.
  const construireCorpsDurable = useCallback(
    (
      semaineModifiee: ContratLocal['semaineAbcm'],
    ): CreerContratAbcm & LienEtablissementSaisie => ({
      mode,
      semaineAbcm: semaineModifiee ?? {},
      ...socleContratDurable(contrat),
    }),
    [mode, contrat],
  );

  const reinitialiserSaisie = useCallback(() => {
    setExceptions([]);
    setPai(undefined);
    setJoursAlsh([]);
  }, []);

  // Enveloppe commune : écriture debouncée + statut, réhydratation serveur,
  // annonces (AQ-05), portée et flux de modification durable du contrat.
  const calendrier = useCalendrierContrat<ContratLocal['semaineAbcm']>({
    contrat,
    mois,
    simule,
    onEnregistre,
    onContratModifie,
    construireCorpsDurable,
    reinitialiserSaisie,
  });
  const {
    ecrire,
    saisieServeur,
    chargee,
    marquerSaisieLocale,
    saisieServeurObsolete,
    annoncer,
    estDansPeriode,
    portee,
    setPortee,
    demanderConfirmationDurable,
  } = calendrier;

  // Changement de (contrat, mois, simulation) : la saisie du mois précédent
  // n'a plus de sens ; le serveur la remplacera à la réhydratation suivante.
  useEffect(() => {
    setPai(undefined);
    setJoursAlsh([]);
    setExceptions([]);
  }, [contrat.id, mois, simule]);

  // Si le serveur ne renvoie aucune saisie, on conserve l'état local (brouillon
  // ou saisie en cours) plutôt que de l'effacer.
  useEffect(() => {
    if (!chargee || saisieServeur === null) return;
    // Anti-clobber : une édition locale survenue PENDANT le chargement rend ce
    // GET périmé — on l'ignore pour ne pas écraser la saisie récente du parent.
    if (saisieServeurObsolete()) return;
    setPai(saisieServeur.pai);
    setExceptions(saisieServeur.exceptions ?? []);
    setJoursAlsh(
      (saisieServeur.joursAlsh ?? []).map((j) => ({
        date: j.date,
        type: j.type,
        repas: j.repas ?? false,
      })),
    );
  }, [chargee, saisieServeur, saisieServeurObsolete]);

  // Modale ALSH.
  const [dateAlsh, setDateAlsh] = useState<string | null>(null);
  const [formuleAlsh, setFormuleAlsh] = useState<FormuleAlsh>({
    type: 'COMPLETE',
    repas: false,
  });

  // Modale ajustement cantine/péri.
  const [dateAjustement, setDateAjustement] = useState<string | null>(null);
  const [choixAjustement, setChoixAjustement] = useState<Effectif>({
    cantine: false,
    matin: false,
    soir: false,
  });

  // Tout ce dont dépend la lecture d'un jour : la récurrence du contrat et les
  // deux couches de saisie du mois. Un seul objet mémoïsé — les dérivations de
  // `inscriptionsAbcm` s'appellent entre elles et n'ont ainsi qu'UNE dépendance.
  const ctx = useMemo<ContexteAbcm>(
    () => ({
      semaine: contrat.semaineAbcm ?? {},
      exceptions,
      joursAlsh,
    }),
    [contrat.semaineAbcm, exceptions, joursAlsh],
  );

  // Jours du mois compris dans la période de validité du contrat.
  const joursPeriode = useMemo<string[]>(
    () => joursDuMois(mois).filter(estDansPeriode),
    [mois, estDansPeriode],
  );

  const couleurs = useMemo(
    () => ({
      mode: couleurDuMode(mode),
      ajout: couleurAjoute(),
      retrait: couleurRetire(),
    }),
    [mode],
  );

  const events = useMemo(
    () => evenementsAbcm(ctx, mode, joursPeriode, couleurs),
    [ctx, mode, joursPeriode, couleurs],
  );

  const ecartJours = useMemo(
    () => ecartJoursAbcm(ctx, mode, joursPeriode),
    [ctx, mode, joursPeriode],
  );

  const envoyer = useCallback(
    (
      nvJoursAlsh: EtatAlsh[],
      nvPai: boolean | undefined,
      nvExceptions: ExceptionAbcm[],
    ) => {
      // Toute édition locale passe par ici : on marque la divergence pour qu'un
      // GET de réhydratation encore en vol ne vienne pas l'écraser à son retour.
      marquerSaisieLocale();
      if (mode === 'CANTINE') {
        ecrire(contrat.id, mois, simule, {
          ...(nvPai !== undefined ? { pai: nvPai } : {}),
          ...(nvExceptions.length > 0 ? { exceptions: nvExceptions } : {}),
        });
      } else if (mode === 'PERISCOLAIRE') {
        ecrire(contrat.id, mois, simule, {
          ...(nvExceptions.length > 0 ? { exceptions: nvExceptions } : {}),
        });
      } else {
        const joursApi: JourAlsh[] = nvJoursAlsh.map((j) => ({
          date: j.date,
          type: j.type,
          ...(j.repas ? { repas: j.repas } : {}),
        }));
        // Les exceptions ALSH (`alsh:false`/`true`) portent les retraits/ajouts
        // ponctuels de la récurrence hebdomadaire → elles doivent partir aussi.
        ecrire(contrat.id, mois, simule, {
          ...(joursApi.length > 0 ? { joursAlsh: joursApi } : {}),
          ...(nvExceptions.length > 0 ? { exceptions: nvExceptions } : {}),
        });
      }
    },
    [ecrire, contrat.id, mois, simule, mode, marquerSaisieLocale],
  );

  // --- Ajustement cantine / périscolaire ------------------------------------

  const ouvrirAjustement = useCallback(
    (iso: string) => {
      if (mode === 'ALSH') return;
      // Cf. `CalendrierCreche` : un jour hors période refusait le clic en silence.
      if (!estDansPeriode(iso)) {
        annoncer(
          'Ce jour est en dehors de la période de ce contrat : il n’y a rien à y saisir.',
        );
        return;
      }
      setPortee('mois');
      setChoixAjustement(effectifJour(ctx, iso));
      setDateAjustement(iso);
    },
    [mode, annoncer, estDansPeriode, ctx, setPortee],
  );

  const confirmerAjustement = useCallback(() => {
    if (dateAjustement === null || mode === 'ALSH') return;
    const date = dateAjustement;
    const jourSemaine = jourSemaineDeIso(date);

    if (portee === 'tous') {
      const nouvelle = { ...ctx.semaine };
      nouvelle[jourSemaine] =
        mode === 'CANTINE'
          ? {
              ...inscriptionsTemplate(ctx, date),
              cantine: choixAjustement.cantine,
            }
          : {
              ...inscriptionsTemplate(ctx, date),
              periMatin: choixAjustement.matin,
              periSoir: choixAjustement.soir,
            };
      // Message en conséquences concrètes : ce que devient ce jour de semaine,
      // chaque semaine (le rappel des effets communs vit dans la modale).
      const nouvelEtat =
        mode === 'CANTINE'
          ? choixAjustement.cantine
            ? 'la cantine sera réservée'
            : 'la cantine ne sera plus réservée'
          : choixAjustement.matin && choixAjustement.soir
            ? 'l’accueil périscolaire du matin et du soir sera réservé'
            : choixAjustement.matin
              ? 'seul l’accueil périscolaire du matin sera réservé'
              : choixAjustement.soir
                ? 'seul l’accueil périscolaire du soir sera réservé'
                : 'l’accueil périscolaire ne sera plus réservé';
      demanderConfirmationDurable(
        nouvelle,
        `Tous les ${jourSemaine.toLowerCase()}s, ${nouvelEtat}.`,
      );
      setDateAjustement(null);
      return;
    }

    const exc = exceptionPourDate(ctx, mode, date, choixAjustement);
    const avaitException = exceptionDe(ctx, date) !== undefined;
    const reste = exceptions.filter((e) => e.date !== date);
    const nouvelles = exc !== null ? [...reste, exc] : reste;
    setExceptions(nouvelles);
    setDateAjustement(null);
    envoyer(joursAlsh, pai, nouvelles);
    if (exc !== null) {
      annoncer(`Jour ajusté le ${formaterDateFr(date)}`);
    } else if (avaitException) {
      annoncer(`Ajustement retiré le ${formaterDateFr(date)}`);
    }
  }, [
    dateAjustement,
    choixAjustement,
    portee,
    mode,
    ctx,
    exceptions,
    joursAlsh,
    pai,
    envoyer,
    annoncer,
    demanderConfirmationDurable,
  ]);

  const reinitialiserJour = useCallback(() => {
    if (dateAjustement === null) return;
    const nouvelles = exceptions.filter((e) => e.date !== dateAjustement);
    setExceptions(nouvelles);
    setDateAjustement(null);
    envoyer(joursAlsh, pai, nouvelles);
    annoncer(`Ajustement retiré le ${formaterDateFr(dateAjustement)}`);
  }, [dateAjustement, exceptions, joursAlsh, pai, envoyer, annoncer]);

  // --- ALSH -----------------------------------------------------------------

  const ouvrirSaisieAlsh = useCallback(
    (iso: string) => {
      if (mode !== 'ALSH' || !iso.startsWith(mois)) return;
      if (!estDansPeriode(iso)) {
        annoncer(
          'Ce jour est en dehors de la période de ce contrat : il n’y a rien à y saisir.',
        );
        return;
      }
      // Prérempli depuis l'état EFFECTIF (explicite > exception > récurrence).
      const eff = alshEffectifDe(ctx, iso);
      setPortee('mois');
      setFormuleAlsh(
        eff
          ? { type: eff.type, repas: eff.repas ?? false }
          : { type: 'COMPLETE', repas: false },
      );
      setDateAlsh(iso);
    },
    [mode, mois, annoncer, estDansPeriode, ctx, setPortee],
  );

  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      if (mode === 'ALSH') ouvrirSaisieAlsh(arg.dateStr);
      else ouvrirAjustement(arg.dateStr);
    },
    [mode, ouvrirSaisieAlsh, ouvrirAjustement],
  );

  const confirmerAlsh = useCallback(() => {
    if (dateAlsh === null) return;
    const date = dateAlsh;
    const jourSemaine = jourSemaineDeIso(date);

    // Portée durable : la formule devient la récurrence hebdomadaire du contrat.
    if (portee === 'tous') {
      const nouvelle = { ...ctx.semaine };
      nouvelle[jourSemaine] = {
        ...inscriptionsTemplate(ctx, date),
        alsh: {
          type: formuleAlsh.type,
          ...(formuleAlsh.repas ? { repas: true } : {}),
        },
      };
      const detail =
        formuleAlsh.type === 'DEMI'
          ? 'une demi-journée sera réservée'
          : formuleAlsh.repas
            ? 'une journée avec repas sera réservée'
            : 'une journée sera réservée';
      demanderConfirmationDurable(
        nouvelle,
        `Tous les ${jourSemaine.toLowerCase()}s, ${detail}.`,
      );
      setDateAlsh(null);
      return;
    }

    // Ponctuel : un jour explicite prime et lève une éventuelle exception `alsh:false`.
    const existait = alshEffectifDe(ctx, date) !== null;
    const nouveaux = joursAlsh.filter((j) => j.date !== date);
    nouveaux.push({ date, type: formuleAlsh.type, repas: formuleAlsh.repas });
    const nvExceptions = exceptions.filter((e) => e.date !== date);
    setJoursAlsh(nouveaux);
    setExceptions(nvExceptions);
    setDateAlsh(null);
    envoyer(nouveaux, pai, nvExceptions);
    annoncer(
      `Journée ALSH ${existait ? 'modifiée' : 'ajoutée'} le ${formaterDateFr(date)}`,
    );
  }, [
    dateAlsh,
    formuleAlsh,
    portee,
    ctx,
    demanderConfirmationDurable,
    joursAlsh,
    exceptions,
    pai,
    envoyer,
    annoncer,
  ]);

  const supprimerAlsh = useCallback(() => {
    if (dateAlsh === null) return;
    const date = dateAlsh;
    // Retire le jour effectif : lève le jour explicite, puis neutralise la
    // récurrence hebdomadaire par une exception `alsh:false` si elle réserverait
    // encore ce jour ; sinon nettoie l'exception résiduelle.
    const nouveaux = joursAlsh.filter((j) => j.date !== date);
    const reste = exceptions.filter((e) => e.date !== date);
    const nvExceptions = alshRecurrent(ctx, date)
      ? [...reste, { date, alsh: false }]
      : reste;
    setJoursAlsh(nouveaux);
    setExceptions(nvExceptions);
    setDateAlsh(null);
    envoyer(nouveaux, pai, nvExceptions);
    annoncer(`Journée ALSH retirée le ${formaterDateFr(date)}`);
  }, [dateAlsh, joursAlsh, exceptions, ctx, pai, envoyer, annoncer]);

  const handlePaiChange = useCallback(
    (val: boolean) => {
      setPai(val);
      envoyer(joursAlsh, val, exceptions);
      annoncer(val ? 'PAI activé' : 'PAI désactivé');
    },
    [joursAlsh, exceptions, envoyer, annoncer],
  );

  // --- Listes clavier -------------------------------------------------------

  // ALSH : le mois ENTIER est listé (la garde de période est portée par
  // `ouvrirSaisieAlsh`) ; les autres modes ne listent que la période.
  const lignesClavier = useMemo<LigneJourClavier[]>(() => {
    const jours = mode === 'ALSH' ? joursDuMois(mois) : joursPeriode;
    return jours.map((jour) => {
      const libelle = formaterDateFr(jour);
      if (mode === 'ALSH') {
        const eff = alshEffectifDe(ctx, jour);
        return {
          date: jour,
          libelle,
          etat: eff ? libelleAlsh(eff) : '—',
          action: eff ? 'Modifier' : 'Saisir',
          actionAriaLabel: eff
            ? `Modifier la journée ALSH du ${libelle}`
            : `Saisir une journée ALSH le ${libelle}`,
        };
      }
      const actif = effectifActif(mode, effectifJour(ctx, jour));
      return {
        date: jour,
        libelle,
        etat: actif ? 'Réservé' : '—',
        action: 'Ajuster',
        actionAriaLabel: `Ajuster le ${libelle} (${
          actif ? 'réservé' : 'non réservé'
        })`,
      };
    });
  }, [mode, mois, joursPeriode, ctx]);

  return (
    <SocleCalendrier
      calendrier={calendrier}
      legende={{
        couleur: couleurs.mode,
        libelle:
          mode === 'CANTINE'
            ? 'Cantine (contrat)'
            : mode === 'PERISCOLAIRE'
              ? 'Périscolaire (contrat)'
              : 'ALSH (contrat)',
        ecartJours,
      }}
      mois={mois}
      events={events}
      onDateClick={handleDateClick}
      barre={
        mode === 'CANTINE' ? (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              margin: 0,
              fontSize: '0.9rem',
            }}
          >
            <input
              type="checkbox"
              checked={pai ?? false}
              onChange={(e) => {
                handlePaiChange(e.target.checked);
              }}
            />
            PAI (Projet d&apos;accueil individualisé)
          </label>
        ) : mode === 'ALSH' ? (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Cliquer sur un jour pour ajouter, modifier ou retirer une journée
            ALSH, ou utiliser la liste ci-dessous au clavier.
          </span>
        ) : undefined
      }
      // Le mode ALSH place sa consigne dans la barre de statut ci-dessus.
      consigne={
        mode === 'ALSH'
          ? undefined
          : 'Cliquer sur un jour pour ajouter ou retirer la prestation, ou utiliser la liste ci-dessous au clavier.'
      }
    >
      {lignesClavier.length > 0 && (
        <ListeJoursClavier
          legende={
            mode === 'ALSH'
              ? 'Saisir une journée ALSH (accessible au clavier)'
              : 'Ajuster un jour (accessible au clavier)'
          }
          jours={lignesClavier}
          onAction={mode === 'ALSH' ? ouvrirSaisieAlsh : ouvrirAjustement}
        />
      )}

      {dateAjustement !== null && mode !== 'ALSH' && (
        <ModaleAjustementAbcm
          date={dateAjustement}
          mode={mode}
          valeurs={choixAjustement}
          onChangeValeurs={setChoixAjustement}
          portee={portee}
          onChangePortee={setPortee}
          onConfirmer={confirmerAjustement}
          onReinitialiser={
            portee === 'mois' && exceptionDe(ctx, dateAjustement) !== undefined
              ? reinitialiserJour
              : undefined
          }
          onFermer={() => {
            setDateAjustement(null);
          }}
        />
      )}

      {dateAlsh !== null && (
        <ModaleJourneeAlsh
          date={dateAlsh}
          valeurs={formuleAlsh}
          onChangeValeurs={setFormuleAlsh}
          portee={portee}
          onChangePortee={setPortee}
          onConfirmer={confirmerAlsh}
          onSupprimer={
            portee === 'mois' && alshEffectifDe(ctx, dateAlsh) !== null
              ? supprimerAlsh
              : undefined
          }
          onFermer={() => {
            setDateAlsh(null);
          }}
        />
      )}
    </SocleCalendrier>
  );
}
