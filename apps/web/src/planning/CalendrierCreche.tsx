import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { ContratLocal, PlageHoraire } from '../types/bff';
import { jourSemaineDeIso, formaterDateFr } from '../utils/dates';
import { couleurDuMode } from '../utils/couleurs';
import {
  couleurAjoute,
  couleurAjuste,
  couleurRetire,
} from './couleursPlanning';
import { SocleCalendrier } from './SocleCalendrier';
import { ListeJoursClavier, type LigneJourClavier } from './ListeJoursClavier';
import { SaisieLotAbsences } from './SaisieLotAbsences';
import { ModaleJourCreche, type NatureSaisieJour } from './ModaleJourCreche';
import { useSaisieCreche } from './useSaisieCreche';
import {
  etatsJoursGardes,
  evenementsCreche,
  joursGardesDuMois,
  type CouleursCreche,
} from './etatsJoursCreche';
import { plageDepuisHeures, plageValide, versHhmm } from './heures';
import {
  FORM_ABSENCE_VIDE,
  fenetreAbsence,
  plageGardeDuJour,
  saisieAbsenceValide,
  typeAbsenceDepuisFenetre,
  type FormAbsence,
} from './saisieAbsence';

export interface CalendrierCrecheProps {
  contrat: ContratLocal;
  mois: string;
  simule: boolean;
  onEnregistre: () => void;
  /** Appelé après une modification durable du contrat (recharge nécessaire). */
  onContratModifie?: () => void;
}

/** Calendrier mensuel crèche PSU : jours gardés, absences (retraits), ajouts. */
export function CalendrierCreche({
  contrat,
  mois,
  simule,
  onEnregistre,
  onContratModifie,
}: CalendrierCrecheProps) {
  // Saisie du mois (brouillon local, réhydratation serveur, écriture debouncée)
  // et enveloppe commune du calendrier (statut, portée, PUT durable).
  const {
    calendrier,
    absences,
    joursSup,
    ajustements,
    complementMinutes,
    majAbsences,
    majJoursSup,
    envoyer,
    majComplementMinutes,
    persistanceIndisponible,
  } = useSaisieCreche({
    contrat,
    mois,
    simule,
    onEnregistre,
    onContratModifie,
  });
  const {
    annoncer,
    estDansPeriode,
    portee,
    setPortee,
    demanderConfirmationDurable,
  } = calendrier;

  const [selection, setSelection] = useState<Set<string>>(() => new Set());

  // Modale jour : « absence » (jour gardé) ou « ajout » (jour non gardé).
  const [dialogDate, setDialogDate] = useState<string | null>(null);
  const [dialogNature, setDialogNature] = useState<NatureSaisieJour>('absence');
  const [dialogForm, setDialogForm] = useState<FormAbsence>(FORM_ABSENCE_VIDE);

  // Saisie en lot d'absences (accessible clavier).
  const [lotForm, setLotForm] = useState<FormAbsence>(FORM_ABSENCE_VIDE);

  // La sélection porte sur les jours du mois affiché : elle ne survit pas à un
  // changement de mois ou de contrat.
  useEffect(() => {
    setSelection(new Set());
  }, [contrat.id, mois]);

  // Mémorisé : la valeur par défaut `{}` créerait sinon une nouvelle référence à
  // chaque rendu et invaliderait les hooks qui en dépendent.
  const semaineType = useMemo(
    () => contrat.semaineType ?? {},
    [contrat.semaineType],
  );

  // Plage de garde du contrat pour un jour (arrivée du 1er créneau → départ du
  // dernier), pour pré-remplir une absence pleine journée. `null` si non gardé.
  const plageContratJour = useCallback(
    (iso: string) => plageGardeDuJour(semaineType, iso),
    [semaineType],
  );

  const joursGardes = useMemo(
    () => joursGardesDuMois(mois, semaineType, estDansPeriode),
    [mois, semaineType, estDansPeriode],
  );

  const joursGardesListe = useMemo<string[]>(
    () => Array.from(joursGardes).sort(),
    [joursGardes],
  );

  const joursSupSet = useMemo(
    () => new Set(joursSup.map((j) => j.date)),
    [joursSup],
  );

  const couleurs = useMemo<CouleursCreche>(
    () => ({
      garde: couleurDuMode('CRECHE_PSU'),
      absent: couleurRetire(),
      ajustement: couleurAjuste(),
      ajoute: couleurAjoute(),
    }),
    [],
  );

  const etatsJours = useMemo(
    () =>
      etatsJoursGardes(
        joursGardes,
        absences,
        ajustements,
        plageContratJour,
        couleurs,
      ),
    [joursGardes, absences, ajustements, plageContratJour, couleurs],
  );

  const events = useMemo(
    () => evenementsCreche(joursGardes, joursSup, etatsJours, couleurs),
    [joursGardes, joursSup, etatsJours, couleurs],
  );

  // Ouvre la modale adaptée au jour cliqué (absence si gardé, ajout sinon).
  const ouvrirSaisie = useCallback(
    (iso: string) => {
      if (!estDansPeriode(iso)) return;
      setPortee('mois');
      if (joursGardes.has(iso)) {
        const garde = plageContratJour(iso);
        const existante = absences.find((a) => a.date === iso);
        setDialogNature('absence');
        if (existante) {
          // Reconstruit le type d'ajustement depuis la fenêtre stockée (la
          // fenêtre d'absence redevient une présence saisie) pour un aller-retour
          // fidèle dans la modale.
          const { typeAbsence, heure } = typeAbsenceDepuisFenetre(
            existante,
            garde,
          );
          setDialogForm({
            arrivee: versHhmm(existante.debutHeures, existante.debutMinutes),
            depart: versHhmm(existante.finHeures, existante.finMinutes),
            heure,
            typeAbsence,
            preavisJours: existante.preavisJours,
            certificatMaladie: existante.certificatMaladie,
          });
        } else {
          setDialogForm({
            ...FORM_ABSENCE_VIDE,
            arrivee: garde?.arrivee ?? FORM_ABSENCE_VIDE.arrivee,
            depart: garde?.depart ?? FORM_ABSENCE_VIDE.depart,
          });
        }
      } else {
        const existant = joursSup.find((j) => j.date === iso);
        setDialogNature('ajout');
        setDialogForm({
          ...FORM_ABSENCE_VIDE,
          arrivee: existant
            ? versHhmm(existant.debutHeures, existant.debutMinutes)
            : FORM_ABSENCE_VIDE.arrivee,
          depart: existant
            ? versHhmm(existant.finHeures, existant.finMinutes)
            : FORM_ABSENCE_VIDE.depart,
        });
      }
      setDialogDate(iso);
    },
    [
      estDansPeriode,
      joursGardes,
      absences,
      joursSup,
      plageContratJour,
      setPortee,
    ],
  );

  const handleDateClick = useCallback(
    (arg: DateClickArg) => {
      ouvrirSaisie(arg.dateStr);
    },
    [ouvrirSaisie],
  );

  const confirmerDialog = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    const jourSemaine = jourSemaineDeIso(date);

    // Ajout d'un jour de garde : on saisit une plage de PRÉSENCE (arrivée/départ).
    if (dialogNature === 'ajout') {
      if (!plageValide(dialogForm.arrivee, dialogForm.depart)) return;
      const plage = plageDepuisHeures(dialogForm.arrivee, dialogForm.depart);
      if (portee === 'tous') {
        const nouvelleSemaine = { ...semaineType };
        nouvelleSemaine[jourSemaine] = [plage];
        demanderConfirmationDurable(
          nouvelleSemaine,
          `Tous les ${jourSemaine.toLowerCase()}s deviendront des jours de garde, de ${dialogForm.arrivee} à ${dialogForm.depart}.`,
        );
        setDialogDate(null);
        return;
      }
      const existait = joursSupSet.has(date);
      const nouveaux = joursSup.filter((j) => j.date !== date);
      nouveaux.push({ date, ...plage });
      majJoursSup(nouveaux);
      setDialogDate(null);
      envoyer(absences, nouveaux, complementMinutes);
      annoncer(
        `Jour supplémentaire ${existait ? 'modifié' : 'ajouté'} le ${formaterDateFr(date)}`,
      );
      return;
    }

    // Absence sur un jour gardé. Portée « tous » : le jour est retiré de la
    // semaine type (la fenêtre d'absence n'a pas de sens ici).
    if (portee === 'tous') {
      const nouvelleSemaine = { ...semaineType };
      nouvelleSemaine[jourSemaine] = [];
      demanderConfirmationDurable(
        nouvelleSemaine,
        `Les ${jourSemaine.toLowerCase()}s ne seront plus des jours de garde.`,
      );
      setDialogDate(null);
      return;
    }

    // Fenêtre d'absence dérivée du type d'ajustement et de la garde du jour.
    const plage = fenetreAbsence(
      dialogForm.typeAbsence,
      dialogForm,
      plageContratJour(date),
    );
    if (plage === null) return;
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
  }, [
    dialogDate,
    dialogNature,
    dialogForm,
    portee,
    semaineType,
    absences,
    joursSup,
    joursSupSet,
    complementMinutes,
    envoyer,
    majAbsences,
    majJoursSup,
    annoncer,
    plageContratJour,
    demanderConfirmationDurable,
  ]);

  const supprimerDialog = useCallback(() => {
    if (dialogDate === null) return;
    const date = dialogDate;
    if (dialogNature === 'absence') {
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
    dialogNature,
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
      // Validité indépendante du jour (la cohérence avec la garde de chaque jour
      // est vérifiée ci-dessous, jour par jour).
      if (!saisieAbsenceValide(lotForm.typeAbsence, lotForm)) return;
      const cibles = Array.from(jours).filter((j) => joursGardes.has(j));
      if (cibles.length === 0) return;
      // Chaque jour dérive SA fenêtre depuis sa propre plage de garde. Un jour
      // dont l'heure pivot tombe hors de sa garde (départ avancé / arrivée
      // retardée) est ignoré plutôt que de créer une absence incohérente.
      const aAppliquer: { date: string; plage: PlageHoraire }[] = [];
      for (const date of cibles) {
        const plage = fenetreAbsence(
          lotForm.typeAbsence,
          lotForm,
          plageContratJour(date),
        );
        if (plage !== null) aAppliquer.push({ date, plage });
      }
      if (aAppliquer.length === 0) return;
      const appliqueSet = new Set(aAppliquer.map((x) => x.date));
      const nouvelles = absences.filter((a) => !appliqueSet.has(a.date));
      for (const { date, plage } of aAppliquer) {
        nouvelles.push({
          date,
          ...plage,
          preavisJours: lotForm.preavisJours,
          certificatMaladie: lotForm.certificatMaladie,
        });
      }
      majAbsences(nouvelles);
      envoyer(nouvelles, joursSup, complementMinutes);
      const ignores = cibles.length - aAppliquer.length;
      const [premiere] = aAppliquer;
      const base =
        aAppliquer.length === 1 && premiere !== undefined
          ? `Absence ajoutée le ${formaterDateFr(premiere.date)}`
          : `Absences ajoutées sur ${aAppliquer.length} jours`;
      annoncer(
        ignores > 0
          ? `${base} (${ignores} jour${ignores > 1 ? 's' : ''} ignoré${
              ignores > 1 ? 's' : ''
            } : horaire hors garde)`
          : base,
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

  const lignesClavier = useMemo<LigneJourClavier[]>(
    () =>
      joursGardesListe.map((jour) => {
        const etat = etatsJours.get(jour);
        const aAbsence = etat?.aAbsence ?? false;
        const libelle = formaterDateFr(jour);
        return {
          date: jour,
          libelle,
          etat: etat?.libelle ?? 'Gardé',
          action: aAbsence ? 'Modifier' : 'Saisir',
          actionAriaLabel: aAbsence
            ? `Modifier l’absence du ${libelle}`
            : `Saisir une absence le ${libelle}`,
        };
      }),
    [joursGardesListe, etatsJours],
  );

  // « Supprimer » n'a de sens que sur une saisie du mois déjà posée.
  const saisieJourExistante =
    dialogDate !== null &&
    portee === 'mois' &&
    (dialogNature === 'absence'
      ? absences.some((a) => a.date === dialogDate)
      : joursSupSet.has(dialogDate));

  return (
    <SocleCalendrier
      calendrier={calendrier}
      legende={{
        couleur: couleurs.garde,
        libelle: 'Gardé (contrat)',
        ecartJours: joursSup.length - absences.length,
      }}
      mois={mois}
      events={events}
      onDateClick={handleDateClick}
      barre={
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            margin: 0,
          }}
        >
          <span className="muted" style={{ fontSize: '0.9rem' }}>
            {/* Espace insécable avant « : » : sinon il passe seul à la ligne à 375 px. */}
            {'Temps de garde en plus (minutes) :'}
          </span>
          <input
            type="number"
            min={0}
            style={{ width: '6rem' }}
            value={complementMinutes ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              majComplementMinutes(v === '' ? undefined : parseInt(v, 10));
            }}
          />
        </label>
      }
      barreApres={
        persistanceIndisponible && (
          <span role="status" className="muted" style={{ fontSize: '0.82rem' }}>
            Mémorisation locale indisponible : la saisie en cours sera perdue si
            vous changez de mois avant la sauvegarde.
          </span>
        )
      }
      consigne="Cliquer sur un jour gardé (bleu) pour saisir une absence, ou sur un autre jour pour ajouter un jour de garde. Liste clavier ci-dessous."
    >
      {joursGardesListe.length > 0 && (
        <SaisieLotAbsences
          form={lotForm}
          setForm={setLotForm}
          nbSelection={selection.size}
          onAppliquerSelection={appliquerSelection}
          onAppliquerTous={appliquerTousLesJoursGardes}
        />
      )}

      {lignesClavier.length > 0 && (
        <ListeJoursClavier
          legende="Saisir une absence (accessible au clavier)"
          jours={lignesClavier}
          onAction={ouvrirSaisie}
          retourLigne
          selection={{
            estSelectionne: (date) => selection.has(date),
            onBasculer: basculerSelection,
            ariaLabel: (ligne) =>
              `Sélectionner le ${ligne.libelle} pour la saisie en lot`,
          }}
        />
      )}

      {dialogDate !== null && (
        <ModaleJourCreche
          date={dialogDate}
          nature={dialogNature}
          form={dialogForm}
          setForm={setDialogForm}
          garde={plageContratJour(dialogDate)}
          portee={portee}
          onChangePortee={setPortee}
          onConfirmer={confirmerDialog}
          onSupprimer={saisieJourExistante ? supprimerDialog : undefined}
          onFermer={() => {
            setDialogDate(null);
          }}
        />
      )}
    </SocleCalendrier>
  );
}
