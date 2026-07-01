import {
  canalSchema,
  typeNotificationSchema,
} from '@creche-planner/contracts-foyer';
import { z } from 'zod';

/**
 * Demande d'**émission** d'un jeton de désabonnement (appel machine interne depuis
 * `svc-notifications`, à la composition du récap). Lie le jeton au triplet
 * `(parent, type, canal)` ; `foyerId` sert à vérifier l'appartenance du parent.
 */
export const emettreJetonSchema = z.object({
  foyerId: z.uuid(),
  parentId: z.uuid(),
  typeNotification: typeNotificationSchema,
  canal: canalSchema,
});
export type EmettreJetonDto = z.infer<typeof emettreJetonSchema>;

/**
 * Corps de l'endpoint public de désabonnement (`POST /api/desabonnement`) : le seul
 * jeton signé opaque. Aucune autre donnée (pas d'e-mail, pas d'id) ⇒ pas
 * d'énumération possible.
 */
export const consommerDesabonnementSchema = z.object({
  token: z.string().min(1),
});
export type ConsommerDesabonnementDto = z.infer<
  typeof consommerDesabonnementSchema
>;
