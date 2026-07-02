import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { EventInput } from '@fullcalendar/core';

export interface CalendrierMoisProps {
  /** Mois affiché « YYYY-MM ». */
  mois: string;
  events: EventInput[];
  onDateClick: (arg: DateClickArg) => void;
}

/**
 * Vue mensuelle FullCalendar commune aux calendriers (`CalendrierCreche`,
 * `CalendrierAbcm`) : mêmes plugins, locale et options ; la `key` dérivée du
 * mois force un remontage au changement de mois (FullCalendar ne suit pas
 * `initialDate`).
 */
export function CalendrierMois({
  mois,
  events,
  onDateClick,
}: CalendrierMoisProps) {
  return (
    <FullCalendar
      key={parseInt(mois.replace('-', ''), 10)}
      plugins={[dayGridPlugin, interactionPlugin]}
      initialView="dayGridMonth"
      locale="fr"
      initialDate={`${mois}-01`}
      headerToolbar={false}
      height="auto"
      events={events}
      dateClick={onDateClick}
    />
  );
}
