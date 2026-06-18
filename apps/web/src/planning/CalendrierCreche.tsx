import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { EventInput } from '@fullcalendar/core';
import { api } from '../api/client';
import type {
  ContratLocal,
  AbsenceCreche,
  JourSupplementaire,
  CreerContratCreche,
  PlageHoraire,
} from '../types/bff';
import { joursDuMois, jourSemaineDeIso, formaterDateFr } from '../utils/dates';
import { couleurDuMode } from '../utils/couleurs';
import { messageErreur } from '../utils/erreurs';
import { Modale } from '../ui/Modale';
import { ModaleConfirmation } from '../ui/ModaleConfirmation';
import { StatutSauvegarde } from '../ui/StatutSauvegarde';
import { usePersistanceAbsences } from '../hooks/usePersistanceAbsences';
import { useAnnonce } from '../hooks/useAnnonce';
import { usePlanning } from './usePlanning';
import { useSaisieServeur } from './useSaisieServeur';
import { LegendePlanning } from './LegendePlanning';
import { ChoixPortee, type Portee } from './ChoixPortee';
import { couleurAjoute, couleurRetire } from './couleursPlanning';

export interface CalendrierCrecheProps {
  contrat: ContratLocal;
  mois: string;
  simule: boolean;
  onEnregistre: () => void;
  /** Appelé après une modification durable du contrat (recharge nécessaire). */
  onContratModifie?: () => void;
}

// La saisie crèche se fait en heures d'arrivée/départ ; on conserve la plage
// horaire dans l'état (et la persistance) pour un aller-retour fidèle.
interface EtatAbsence extends PlageHoraire {
  date: string;
  preavisJours: number;
  certificatMaladie: boolean;
}

interface EtatJourSup extends PlageHoraire {
  date: string;
}

/** Heures d'arrivée/départ par défaut (à défaut de plage de contrat). */
const ARRIVEE_DEFAUT = '09:00';
const DEPART_DEFAUT = '16:30';

/** `HH:MM` ← heures/minutes. */
function versHhmm(heures: number, minutes: number): string {
  return `${String(heures).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** `HH:MM` → minutes depuis minuit (0 si vide/invalide). */
function minutesDeHhmm(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Plage horaire (API) depuis deux heures `HH:MM`. */
function plageDepuisHeures(arrivee: string, depart: string): PlageHoraire {
  const a = arrivee.split(':').map(Number);
  const d = depart.split(':').map(Number);
  return {
    debutHeures: a[0] ?? 0,
    debutMinutes: a[1] ?? 0,
    finHeures: d[0] ?? 0,
    finMinutes: d[1] ?? 0,
  };
}

/** Vrai si la plage est cohérente (départ strictement après arrivée). */
function plageValide(arrivee: string, depart: string): boolean {
  return (
    arrivee !== '' &&
    depart !== '' &&
    minutesDeHhmm(depart) > minutesDeHhmm(arrivee)
  );
}

/** Calendrier mensuel crèche PSU : jours gardés, absences (retraits), ajouts. */
export function CalendrierCreche({
  contrat,
  mois,
  simule,
  onEnregistre,
  onContratModifie,
}: CalendrierCrecheProps) {
  const { etat, erreur, ecrire } = usePlanning(onEnregistre);

  // AQ-05 : région live annonçant chaque mutation du calendrier aux lecteurs
  // d'écran (la sauvegarde est différée de 800 ms, le retour visuel ne suffit pas).
  const { annoncer, regionLiveProps } = useAnnonce();

  // Persistance locale par (contrat, mois) : brouillon entre deux navigations.
  // La source de vérité reste le serveur (réhydraté ci-dessous).
  const persistAbsences =
    usePersistanceAbsences<EtatAbsence>('creche:absences');
  const persistJoursSup =
    usePersistanceAbsences<EtatJourSup>('creche:joursSup');

  const { saisie: saisieServeur, chargee } = useSaisieServeur(
    contrat.id,
    mois,
    simule,
  );

  const [complementMinutes, setComplementMinutes] = useState<
    number | undefined
  >(undefined);
  const [absences, setAbsences] = useState<EtatAbsence[]>(() =>
    persistAbsences.lire(contrat.id, mois),
  );
  const [joursSup, setJoursSup] = useState<EtatJourSup[]>(() =>
    persistJoursSup.lire(contrat.id, mois),
  );

  useEffect(() => {
    setAbsences(persistAbsences.lire(contrat.id, mois));
    setJoursSup(persistJoursSup.lire(contrat.id, mois));
    setComplementMinutes(undefined);
    setSelection(new Set());
    // Dépendances sur les fonctions (stables), pas les objets : leur identité
    // change quand `indisponible` bascule et rejouerait la réhydratation.
  }, [persistAbsences.lire, persistJoursSup.lire, contrat.id, mois]);

  // À l'arrivée de la saisie serveur : elle devient la source de vérité. Si le
  // serveur ne renvoie rien, on conserve le brouillon local (saisie en cours).
  useEffect(() => {
    if (!chargee || saisieServeur === null) return;
    const abs: EtatAbsence[] = (saisieServeur.absences ?? [])
      .filter(
        (a): a is AbsenceCreche & { date: string } => a.date !== undefined,
      )
      .map((a) => ({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      }));
    const sup: EtatJourSup[] = (saisieServeur.joursSupplementaires ?? []).map(
      (j) => ({
        date: j.date,
        debutHeures: j.debutHeures,
        debutMinutes: j.debutMinutes,
        finHeures: j.finHeures,
        finMinutes: j.finMinutes,
      }),
    );
    setAbsences(abs);
    setJoursSup(sup);
    setComplementMinutes(saisieServeur.complementMinutes);
    persistAbsences.ecrire(contrat.id, mois, abs);
    persistJoursSup.ecrire(contrat.id, mois, sup);
  }, [
    chargee,
    saisieServeur,
    contrat.id,
    mois,
    persistAbsences.ecrire,
    persistJoursSup.ecrire,
  ]);

  const majAbsences = useCallback(
    (nouvelles: EtatAbsence[]) => {
      setAbsences(nouvelles);
      persistAbsences.ecrire(contrat.id, mois, nouvelles);
    },
    [persistAbsences.ecrire, contrat.id, mois],
  );

  const majJoursSup = useCallback(
    (nouveaux: EtatJourSup[]) => {
      setJoursSup(nouveaux);
      persistJoursSup.ecrire(contrat.id, mois, nouveaux);
    },
    [persistJoursSup.ecrire, contrat.id, mois],
  );

  // Modale jour : « absence » (jour gardé) ou « ajout » (jour non gardé).
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [dialogKind, setDialogKind] = useState<'absence' | 'ajout'>('absence');
  const [dialogForm, setDialogForm] = useState<{
    arrivee: string;
    depart: string;
    /** Absence sur toute la journée gardée (utilise la plage du contrat). */
    journeeComplete: boolean;
    preavisJours: number;
    certificatMaladie: boolean;
  }>({
    arrivee: ARRIVEE_DEFAUT,
    depart: DEPART_DEFAUT,
    journeeComplete: true,
    preavisJours: 0,
    certificatMaladie: false,
  });
  const [portee, setPortee] = useState<Portee>('mois');

  // Saisie en lot d'absences (accessible clavier).
  const [lotForm, setLotForm] = useState<{
    arrivee: string;
    depart: string;
    journeeComplete: boolean;
    preavisJours: number;
    certificatMaladie: boolean;
  }>({
    arrivee: ARRIVEE_DEFAUT,
    depart: DEPART_DEFAUT,
    journeeComplete: true,
    preavisJours: 0,
    certificatMaladie: false,
  });
  const [selection, setSelection] = useState<Set<string>>(() => new Set());

  // Confirmation d'une modification durable du contrat.
  // Erreur d'une modification durable (PUT contrat) : affichée sans détruire
  // l'état local. L'opération est atomique côté service (transaction Drizzle) et
  // un 429 est rejeté par la gateway avant tout effet → le contrat reste intact.
  const [erreurDurable, setErreurDurable] = useState<string | null>(null);
  const [confirmationDurable, setConfirmationDurable] = useState<{
    semaineType: ContratLocal['semaineType'];
    message: string;
  } | null>(null);

  const semaineType = contrat.semaineType ?? {};

  const estDansPeriode = useCallback(
    (iso: string): boolean =>
      iso >= contrat.valideDu &&
      (contrat.valideAu === null || iso <= contrat.valideAu),
    [contrat.valideDu, contrat.valideAu],
  );

  // Plage de garde du contrat pour un jour (arrivée du 1er créneau → départ du
  // dernier), pour pré-remplir une absence pleine journée. `null` si non gardé.
  const plageContratJour = useCallback(
    (iso: string): { arrivee: string; depart: string } | null => {
      const plages = semaineType[jourSemaineDeIso(iso)] ?? [];
      const premier = plages[0];
      const dernier = plages[plages.length - 1];
      if (!premier || !dernier) return null;
      return {
        arrivee: versHhmm(premier.debutHeures, premier.debutMinutes),
        depart: versHhmm(dernier.finHeures, dernier.finMinutes),
      };
    },
    [semaineType],
  );

  const joursGardes = useMemo<Set<string>>(() => {
    const gardes = new Set<string>();
    for (const jour of joursDuMois(mois)) {
      if (!estDansPeriode(jour)) continue;
      const jourSemaine = jourSemaineDeIso(jour);
      if ((semaineType[jourSemaine]?.length ?? 0) > 0) {
        gardes.add(jour);
      }
    }
    return gardes;
  }, [mois, semaineType, estDansPeriode]);

  const joursGardesListe = useMemo<string[]>(
    () => Array.from(joursGardes).sort(),
    [joursGardes],
  );

  const joursSupSet = useMemo(
    () => new Set(joursSup.map((j) => j.date)),
    [joursSup],
  );

  const couleurGarde = couleurDuMode('CRECHE_PSU');
  const couleurAbsent = couleurRetire();
  const couleurSup = couleurAjoute();

  const ecartJours = joursSup.length - absences.length;

  const events = useMemo<EventInput[]>(() => {
    const evts: EventInput[] = [];
    for (const jour of joursGardes) {
      const estAbsent = absences.some((a) => a.date === jour);
      const couleur = estAbsent ? couleurAbsent : couleurGarde;
      evts.push({
        id: jour,
        start: jour,
        allDay: true,
        backgroundColor: couleur,
        borderColor: couleur,
        title: estAbsent ? 'Absent' : 'Gardé',
      });
    }
    for (const j of joursSup) {
      evts.push({
        id: `sup-${j.date}`,
        start: j.date,
        allDay: true,
        backgroundColor: couleurSup,
        borderColor: couleurSup,
        title: 'Ajouté',
      });
    }
    return evts;
  }, [
    joursGardes,
    joursSup,
    absences,
    couleurGarde,
    couleurAbsent,
    couleurSup,
  ]);

  const envoyer = useCallback(
    (
      nvAbsences: EtatAbsence[],
      nvJoursSup: EtatJourSup[],
      nvComplementMinutes: number | undefined,
    ) => {
      const absencesApi: AbsenceCreche[] = nvAbsences.map((a) => ({
        date: a.date,
        debutHeures: a.debutHeures,
        debutMinutes: a.debutMinutes,
        finHeures: a.finHeures,
        finMinutes: a.finMinutes,
        preavisJours: a.preavisJours,
        certificatMaladie: a.certificatMaladie,
      }));
      const joursSupApi: JourSupplementaire[] = nvJoursSup.map((j) => ({
        date: j.date,
        debutHeures: j.debutHeures,
        debutMinutes: j.debutMinutes,
        finHeures: j.finHeures,
        finMinutes: j.finMinutes,
      }));
      ecrire(contrat.id, mois, simule, {
        ...(nvComplementMinutes !== undefined
          ? { complementMinutes: nvComplementMinutes }
          : {}),
        ...(joursSupApi.length > 0
          ? { joursSupplementaires: joursSupApi }
          : {}),
        ...(absencesApi.length > 0 ? { absences: absencesApi } : {}),
      });
    },
    [ecrire, contrat.id, mois, simule],
  );

  // Ouvre la modale adaptée au jour cliqué (absence si gardé, ajout sinon).
  const ouvrirSaisie = useCallback(
    (iso: string) => {
      if (!estDansPeriode(iso)) return;
      setPortee('mois');
      if (joursGardes.has(iso)) {
        const existing = absences.find((a) => a.date === iso);
        const plage = plageContratJour(iso);
        const arrivee = existing
          ? versHhmm(existing.debutHeures, existing.debutMinutes)
          : (plage?.arrivee ?? ARRIVEE_DEFAUT);
        const depart = existing
          ? versHhmm(existing.finHeures, existing.finMinutes)
          : (plage?.depart ?? DEPART_DEFAUT);
        // Par défaut « toute la journée » ; pour une absence existante, coché
        // seulement si sa plage couvre toute la garde du contrat ce jour-là.
        const journeeComplete = existing
          ? plage !== null &&
            arrivee === plage.arrivee &&
            depart === plage.depart
          : true;
        setDialogKind('absence');
        setDialogForm({
          arrivee,
          depart,
          journeeComplete,
          preavisJours: existing?.preavisJours ?? 0,
          certificatMaladie: existing?.certificatMaladie ?? false,
        });
      } else {
        const existing = joursSup.find((j) => j.date === iso);
        setDialogKind('ajout');
        setDialogForm({
          arrivee: existing
            ? versHhmm(existing.debutHeures, existing.debutMinutes)
            : ARRIVEE_DEFAUT,
          depart: existing
            ? versHhmm(existing.finHeures, existing.finMinutes)
            : DEPART_DEFAUT,
          journeeComplete: false,
          preavisJours: 0,
          certificatMaladie: false,
        });
      }
      setDialogDate(iso);
    },
    [estDansPeriode, joursGardes, absences, joursSup, plageContratJour],
  );

  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      ouvrirSaisie(arg.dateStr);
    },
    [ouvrirSaisie],
  );

  // Applique la modification durable confirmée (modifie le contrat).
  const appliquerDurable = useCallback(
    (semaineTypeModifiee: ContratLocal['semaineType']) => {
      const corps: CreerContratCreche = {
        mode: 'CRECHE_PSU',
        foyerId: contrat.foyerId,
        enfant: contrat.enfant,
        valideDu: contrat.valideDu,
        valideAu: contrat.valideAu,
        heuresAnnuellesContractualisees:
          contrat.heuresAnnuellesContractualisees ?? 0,
        nbMensualites: contrat.nbMensualites ?? 7,
        semaineType: semaineTypeModifiee ?? {},
      };
      setErreurDurable(null);
      api
        .modifierContrat(contrat.id, corps)
        .then(() => {
          setErreurDurable(null);
          majAbsences([]);
          majJoursSup([]);
          setComplementMinutes(undefined);
          annoncer('Contrat modifié, saisies du mois réinitialisées');
          onContratModifie?.();
        })
        .catch((e: unknown) => {
          // Échec (429, réseau, validation…) : le contrat n'a PAS été modifié
          // (PUT atomique + court-circuit gateway). On signale l'erreur sans
          // toucher à l'état local — l'utilisateur peut réessayer.
          setErreurDurable(messageErreur(e));
        });
    },
    [contrat, majAbsences, majJoursSup, onContratModifie, annoncer],
  );

  const confirmerDialog = useCallback(() => {
    if (dialogDate === null) return;
    if (!plageValide(dialogForm.arrivee, dialogForm.depart)) return;
    const date = dialogDate;
    const jourSemaine = jourSemaineDeIso(date);
    const plage = plageDepuisHeures(dialogForm.arrivee, dialogForm.depart);

    if (portee === 'tous') {
      const nouvelleSemaine = { ...semaineType };
      nouvelleSemaine[jourSemaine] = dialogKind === 'absence' ? [] : [plage];
      setConfirmationDurable({
        semaineType: nouvelleSemaine,
        message:
          dialogKind === 'absence'
            ? `Retirer ce jour de garde tous les ${jourSemaine.toLowerCase()}s modifie le contrat. Les saisies mensuelles existantes seront réinitialisées.`
            : `Ajouter ce jour de garde tous les ${jourSemaine.toLowerCase()}s modifie le contrat. Les saisies mensuelles existantes seront réinitialisées.`,
      });
      setDialogDate(null);
      return;
    }

    if (dialogKind === 'absence') {
      const existait = absences.some((a) => a.date === date);
      const nouvelles = absences.filter((a) => a.date !== date);
      nouvelles.push({
        date,
        ...plage,
        preavisJours: dialogForm.preavisJours,
        certificatMaladie: dialogForm.certificatMaladie,
      });
      majAbsences(nouvelles);
      setDialogDate(null);
      envoyer(nouvelles, joursSup, complementMinutes);
      annoncer(
        `Absence ${existait ? 'modifiée' : 'ajoutée'} le ${formaterDateFr(date)}`,
      );
    } else {
      const existait = joursSup.some((j) => j.date === date);
      const nouveaux = joursSup.filter((j) => j.date !== date);
      nouveaux.push({ date, ...plage });
      majJoursSup(nouveaux);
      setDialogDate(null);
      envoyer(absences, nouveaux, complementMinutes);
      annoncer(
        `Jour supplémentaire ${existait ? 'modifié' : 'ajouté'} le ${formaterDateFr(date)}`,
      );
    }
  }, [
    dialogDate,
    dialogKind,
    dialogForm,
    portee,
    semaineType,
    absences,
    joursSup,
    complementMinutes,
    envoyer,
    majAbsences,
    majJoursSup,
    annoncer,
  ]);

  const supprimerDialog = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    if (dialogKind === 'absence') {
      const nouvelles = absences.filter((a) => a.date !== date);
      majAbsences(nouvelles);
      setDialogDate(null);
      envoyer(nouvelles, joursSup, complementMinutes);
      annoncer(`Absence retirée le ${formaterDateFr(date)}`);
    } else {
      const nouveaux = joursSup.filter((j) => j.date !== date);
      majJoursSup(nouveaux);
      setDialogDate(null);
      envoyer(absences, nouveaux, complementMinutes);
      annoncer(`Jour supplémentaire retiré le ${formaterDateFr(date)}`);
    }
  }, [
    dialogDate,
    dialogKind,
    absences,
    joursSup,
    complementMinutes,
    envoyer,
    majAbsences,
    majJoursSup,
    annoncer,
  ]);

  const basculerSelection = useCallback((iso: string) => {
    setSelection((prev) => {
      const suivante = new Set(prev);
      if (suivante.has(iso)) suivante.delete(iso);
      else suivante.add(iso);
      return suivante;
    });
  }, []);

  const appliquerLot = useCallback(
    (jours: Iterable<string>) => {
      // En « toute la journée », chaque jour prend SA plage de garde du contrat ;
      // sinon, la plage saisie dans le formulaire de lot (qui doit être valide).
      if (
        !lotForm.journeeComplete &&
        !plageValide(lotForm.arrivee, lotForm.depart)
      ) {
        return;
      }
      const cibles = Array.from(jours).filter((j) => joursGardes.has(j));
      if (cibles.length === 0) return;
      const plageLot = plageDepuisHeures(lotForm.arrivee, lotForm.depart);
      const ciblesSet = new Set(cibles);
      const nouvelles = absences.filter((a) => !ciblesSet.has(a.date));
      for (const date of cibles) {
        const plageJour = lotForm.journeeComplete
          ? (plageContratJour(date) ?? null)
          : null;
        const plage =
          plageJour !== null
            ? plageDepuisHeures(plageJour.arrivee, plageJour.depart)
            : plageLot;
        nouvelles.push({
          date,
          ...plage,
          preavisJours: lotForm.preavisJours,
          certificatMaladie: lotForm.certificatMaladie,
        });
      }
      majAbsences(nouvelles);
      envoyer(nouvelles, joursSup, complementMinutes);
      const [premiereCible] = cibles;
      annoncer(
        cibles.length === 1 && premiereCible !== undefined
          ? `Absence ajoutée le ${formaterDateFr(premiereCible)}`
          : `Absences ajoutées sur ${cibles.length} jours`,
      );
    },
    [
      joursGardes,
      absences,
      joursSup,
      lotForm,
      complementMinutes,
      envoyer,
      majAbsences,
      plageContratJour,
      annoncer,
    ],
  );

  const appliquerTousLesJoursGardes = useCallback(() => {
    appliquerLot(joursGardesListe);
  }, [appliquerLot, joursGardesListe]);

  const appliquerSelection = useCallback(() => {
    appliquerLot(selection);
    setSelection(new Set());
  }, [appliquerLot, selection]);

  const handleComplementChange = useCallback(
    (val: number | undefined) => {
      setComplementMinutes(val);
      envoyer(absences, joursSup, val);
    },
    [absences, joursSup, envoyer],
  );

  const etatStatut = etat === 'enregistre' || etat === 'erreur' ? etat : 'idle';
  const initialDate = `${mois}-01`;
  const calKey = useRef(0);
  calKey.current = parseInt(mois.replace('-', ''), 10);

  // En « toute la journée » (absence), les heures viennent du contrat → toujours
  // valides ; sinon on exige une plage cohérente saisie à la main.
  const dialogPlageValide =
    dialogKind === 'absence' && dialogForm.journeeComplete
      ? true
      : plageValide(dialogForm.arrivee, dialogForm.depart);
  const lotPlageValide =
    lotForm.journeeComplete || plageValide(lotForm.arrivee, lotForm.depart);

  return (
    <div>
      {/* AQ-05 : annonce des mutations du calendrier aux lecteurs d'écran. */}
      <p {...regionLiveProps} className="sr-only" />
      <div
        style={{
          marginBottom: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            margin: 0,
          }}
        >
          <span className="muted" style={{ fontSize: '0.9rem' }}>
            Complément (min) :
          </span>
          <input
            type="number"
            min={0}
            style={{ width: '6rem' }}
            value={complementMinutes ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              handleComplementChange(v === '' ? undefined : parseInt(v, 10));
            }}
          />
        </label>
        <StatutSauvegarde etat={etatStatut} />
        {etat === 'erreur' && erreur && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {erreur}
          </span>
        )}
        {erreurDurable && (
          <span
            role="alert"
            className="muted"
            style={{ fontSize: '0.82rem', color: 'var(--erreur, #b00020)' }}
          >
            {erreurDurable}
          </span>
        )}
        {(persistAbsences.indisponible || persistJoursSup.indisponible) && (
          <span role="status" className="muted" style={{ fontSize: '0.82rem' }}>
            Mémorisation locale indisponible : la saisie en cours sera perdue si
            vous changez de mois avant la sauvegarde.
          </span>
        )}
      </div>

      <LegendePlanning
        couleurGarde={couleurGarde}
        libelleGarde="Gardé (contrat)"
        ecartJours={ecartJours}
      />

      <div
        style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}
        className="muted"
      >
        Cliquer sur un jour gardé (bleu) pour saisir une absence, ou sur un
        autre jour pour ajouter un jour de garde. Liste clavier ci-dessous.
      </div>

      <FullCalendar
        key={calKey.current}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        locale="fr"
        initialDate={initialDate}
        headerToolbar={false}
        height="auto"
        events={events}
        dateClick={handleDateClick}
      />

      {/* Saisie en lot d'absences (accessible clavier). */}
      {joursGardesListe.length > 0 && (
        <fieldset style={{ marginTop: '1rem' }}>
          <legend>Saisie en lot (accessible au clavier)</legend>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'flex-end',
              gap: '0.75rem',
            }}
          >
            <label
              style={{
                flexDirection: 'row',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <input
                type="checkbox"
                checked={lotForm.journeeComplete}
                onChange={(e) => {
                  setLotForm((f) => ({
                    ...f,
                    journeeComplete: e.target.checked,
                  }));
                }}
                style={{ width: 'auto', padding: 0 }}
              />
              Toute la journée
            </label>
            {!lotForm.journeeComplete && (
              <>
                <label>
                  Arrivée
                  <input
                    type="time"
                    value={lotForm.arrivee}
                    onChange={(e) => {
                      setLotForm((f) => ({ ...f, arrivee: e.target.value }));
                    }}
                  />
                </label>
                <label>
                  Départ
                  <input
                    type="time"
                    value={lotForm.depart}
                    onChange={(e) => {
                      setLotForm((f) => ({ ...f, depart: e.target.value }));
                    }}
                  />
                </label>
              </>
            )}
            <label>
              Préavis (jours)
              <input
                type="number"
                min={0}
                value={lotForm.preavisJours}
                onChange={(e) => {
                  setLotForm((f) => ({
                    ...f,
                    preavisJours: parseInt(e.target.value, 10) || 0,
                  }));
                }}
              />
            </label>
            <label
              style={{
                flexDirection: 'row',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <input
                type="checkbox"
                checked={lotForm.certificatMaladie}
                onChange={(e) => {
                  setLotForm((f) => ({
                    ...f,
                    certificatMaladie: e.target.checked,
                  }));
                }}
                style={{ width: 'auto', padding: 0 }}
              />
              Certificat médical
            </label>
          </div>
          {!lotPlageValide && (
            <div
              className="muted"
              style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}
            >
              L’heure de départ doit être postérieure à l’arrivée.
            </div>
          )}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              marginTop: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={appliquerSelection}
              disabled={selection.size === 0 || !lotPlageValide}
            >
              Appliquer à la sélection ({selection.size})
            </button>
            <button
              type="button"
              className="btn secondaire"
              onClick={appliquerTousLesJoursGardes}
              disabled={!lotPlageValide}
            >
              Appliquer à tous les jours gardés
            </button>
          </div>
        </fieldset>
      )}

      {/* Alternative clavier : liste des jours gardés (multi-sélection + saisie). */}
      {joursGardesListe.length > 0 && (
        <fieldset style={{ marginTop: '1rem' }}>
          <legend>Saisir une absence (accessible au clavier)</legend>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {joursGardesListe.map((jour) => {
              const estAbsent = absences.some((a) => a.date === jour);
              const libelleJour = formaterDateFr(jour);
              return (
                <li
                  key={jour}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.2rem 0',
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      margin: 0,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selection.has(jour)}
                      onChange={() => {
                        basculerSelection(jour);
                      }}
                      style={{ width: 'auto', padding: 0 }}
                      aria-label={`Sélectionner le ${libelleJour} pour la saisie en lot`}
                    />
                    <span style={{ minWidth: '8rem' }}>{libelleJour}</span>
                  </label>
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {estAbsent ? 'Absent' : 'Gardé'}
                  </span>
                  <button
                    type="button"
                    className="btn secondaire"
                    onClick={() => {
                      ouvrirSaisie(jour);
                    }}
                    aria-label={
                      estAbsent
                        ? `Modifier l’absence du ${libelleJour}`
                        : `Saisir une absence le ${libelleJour}`
                    }
                  >
                    {estAbsent ? 'Modifier' : 'Saisir'}
                  </button>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      {/* Modale jour : absence (jour gardé) ou ajout (jour non gardé). */}
      {dialogDate !== null && (
        <Modale
          titre={
            dialogKind === 'absence'
              ? `Absence du ${formaterDateFr(dialogDate)}`
              : `Ajouter le ${formaterDateFr(dialogDate)}`
          }
          onClose={() => {
            setDialogDate(null);
          }}
        >
          {dialogKind === 'absence' && (
            <label
              style={{
                flexDirection: 'row',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                margin: 0,
              }}
            >
              <input
                type="checkbox"
                checked={dialogForm.journeeComplete}
                onChange={(e) => {
                  setDialogForm((f) => ({
                    ...f,
                    journeeComplete: e.target.checked,
                  }));
                }}
                style={{ width: 'auto', padding: 0 }}
              />
              Absence toute la journée
            </label>
          )}

          {dialogKind === 'absence' && dialogForm.journeeComplete ? (
            <div
              className="muted"
              style={{ fontSize: '0.82rem', marginTop: '0.25rem' }}
            >
              Toute la journée gardée ({dialogForm.arrivee}–{dialogForm.depart}
              ).
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                flexWrap: 'wrap',
                marginTop: '0.25rem',
              }}
            >
              <label>
                Heure d’arrivée
                <input
                  type="time"
                  value={dialogForm.arrivee}
                  onChange={(e) => {
                    setDialogForm((f) => ({ ...f, arrivee: e.target.value }));
                  }}
                />
              </label>
              <label>
                Heure de départ
                <input
                  type="time"
                  value={dialogForm.depart}
                  onChange={(e) => {
                    setDialogForm((f) => ({ ...f, depart: e.target.value }));
                  }}
                />
              </label>
            </div>
          )}
          {!dialogPlageValide && (
            <div
              className="muted"
              style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}
            >
              L’heure de départ doit être postérieure à l’arrivée.
            </div>
          )}

          {dialogKind === 'absence' && (
            <>
              <label>
                Préavis (jours)
                <input
                  type="number"
                  min={0}
                  value={dialogForm.preavisJours}
                  onChange={(e) => {
                    setDialogForm((f) => ({
                      ...f,
                      preavisJours: parseInt(e.target.value, 10) || 0,
                    }));
                  }}
                />
              </label>

              <label
                style={{
                  flexDirection: 'row',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  marginTop: '0.5rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={dialogForm.certificatMaladie}
                  onChange={(e) => {
                    setDialogForm((f) => ({
                      ...f,
                      certificatMaladie: e.target.checked,
                    }));
                  }}
                  style={{ width: 'auto', padding: 0 }}
                />
                Certificat médical
              </label>
            </>
          )}

          <ChoixPortee valeur={portee} onChange={setPortee} nom="creche" />

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button
              type="button"
              className="btn"
              onClick={confirmerDialog}
              disabled={!dialogPlageValide}
            >
              Confirmer
            </button>
            {portee === 'mois' &&
              ((dialogKind === 'absence' &&
                absences.some((a) => a.date === dialogDate)) ||
                (dialogKind === 'ajout' && joursSupSet.has(dialogDate))) && (
                <button
                  type="button"
                  className="btn secondaire"
                  onClick={supprimerDialog}
                >
                  Supprimer
                </button>
              )}
            <button
              type="button"
              className="btn secondaire"
              onClick={() => {
                setDialogDate(null);
              }}
            >
              Annuler
            </button>
          </div>
        </Modale>
      )}

      {/* Confirmation d'une modification durable du contrat. */}
      <ModaleConfirmation
        ouvert={confirmationDurable !== null}
        titre="Modifier le contrat ?"
        message={confirmationDurable?.message ?? ''}
        libelleConfirmer="Modifier le contrat"
        destructif
        onConfirmer={() => {
          if (confirmationDurable) {
            appliquerDurable(confirmationDurable.semaineType);
          }
          setConfirmationDurable(null);
        }}
        onAnnuler={() => {
          setConfirmationDurable(null);
        }}
      />
    </div>
  );
}
