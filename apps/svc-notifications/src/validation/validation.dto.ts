import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodType } from 'zod';
import type { StatutNotification } from '../database/schema.js';
import type { DeltaModifs } from './validation.diff.js';
import { estSemaineIso } from '@creche-planner/shared-semaine';

/**
 * Vue d'une semaine **à valider** (liste in-app). Volontairement réduite à ce que
 * l'écran a besoin d'afficher : le contrat, la semaine, le statut et la date de
 * notification. Le snapshot et le delta restent internes au service.
 */
export interface NotificationAValiderVue {
  readonly contratId: string;
  readonly foyerId: string;
  readonly semaineIso: string;
  readonly statut: StatutNotification;
  readonly notifieeLe: string;
}

/**
 * Résultat d'une validation (`POST /validations/:contratId/:semaineIso`). `statut`
 * passe à `VALIDEE` ou `VALIDEE_AVEC_MODIFS` selon le diff ; `deltaModifs` n'est
 * présent que dans le second cas. Idempotent : revalider renvoie le même résultat.
 */
export interface ValidationResultat {
  readonly contratId: string;
  readonly semaineIso: string;
  readonly statut: StatutNotification;
  readonly deltaModifs: DeltaModifs | null;
}

/**
 * Pipe de validation du paramètre de chemin `semaineIso` (`YYYY-Www`). Rejette une
 * forme invalide en `400` au format homogène `[{ champ, message }]`, avant tout accès
 * base — symétrique du `ParseUUIDPipe` appliqué aux identifiants.
 */
@Injectable()
export class SemaineIsoPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!estSemaineIso(value)) {
      throw new BadRequestException([
        {
          champ: 'semaineIso',
          message: `semaine ISO invalide (attendu YYYY-Www) : ${value}`,
        },
      ]);
    }
    return value;
  }
}

/** Pipe générique : valide le corps de requête contre un schéma Zod (→ 400). */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const resultat = this.schema.safeParse(value);
    if (!resultat.success) {
      throw new BadRequestException(
        resultat.error.issues.map((i) => ({
          champ: i.path.join('.'),
          message: i.message,
        })),
      );
    }
    return resultat.data;
  }
}
