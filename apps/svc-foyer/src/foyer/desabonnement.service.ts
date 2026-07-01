import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  PREFERENCES_NOTIF_MODIFIEES_TYPE,
  type Canal,
  type TypeNotification,
} from '@creche-planner/contracts-foyer';
import { DRIZZLE, traceIdCourant } from '@creche-planner/nest-commons';
import type { Database } from '../database/database.types.js';
import {
  desabonnementToken,
  outbox,
  parent,
  preferenceNotification,
} from '../database/schema.js';
import { signerJeton, verifierJeton } from './desabonnement.jeton.js';
import {
  fusionnerDefauts,
  payloadPreferences,
  typeServiceInjoignable,
} from './preferences.util.js';
import {
  OPTIONS_DESABONNEMENT,
  type OptionsDesabonnement,
} from './desabonnement.options.js';

/** Paramètres d'émission d'un jeton, liés au triplet `(parent, type, canal)`. */
export interface EmettreJetonParams {
  readonly foyerId: string;
  readonly parentId: string;
  readonly typeNotification: TypeNotification;
  readonly canal: Canal;
}

/** Jeton signé + son expiration (ISO), renvoyés à l'appelant (svc-notifications). */
export interface JetonEmis {
  readonly token: string;
  readonly expireLe: string;
}

const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/**
 * Désabonnement one-click **RFC 8058** (PR5). Gère le cycle de vie du jeton
 * `desabonnement_token` (§9.5, jeton **en table** auditable et one-shot) :
 *
 * - `emettreJeton` — appelé par `svc-notifications` à la composition du récap :
 *   insère une ligne `(jti, parent, type, canal, expire_le, utilise_le NULL)` et
 *   renvoie le jeton **signé** (HMAC) qui la référence.
 * - `consommer` — appelé par l'endpoint **public** de la gateway : vérifie la
 *   signature + la ligne (non-expirée, non-utilisée), pose `desabonne_at` +
 *   `actif=false` sur la préférence ciblée et émet `PreferencesNotifModifiees.v1`,
 *   le tout dans **une** transaction. **Refuse (409)** de couper le **dernier canal
 *   actif** d'un type de service (invariant §5.3) — sans consommer le jeton.
 *
 * Sécurité (§7) : aucune donnée de compte dans le jeton, erreurs **génériques**
 * pour tout jeton invalide/expiré/déjà utilisé (pas de fuite d'existence de
 * compte), usage **one-shot** garanti par une prise atomique
 * (`utilise_le IS NULL` dans le `WHERE` de l'update).
 */
@Injectable()
export class DesabonnementService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(OPTIONS_DESABONNEMENT)
    private readonly options: OptionsDesabonnement,
  ) {}

  /** Émet et persiste un jeton one-shot pour `(parent, type, canal)` du foyer. */
  async emettreJeton(params: EmettreJetonParams): Promise<JetonEmis> {
    const lignes = await this.db
      .select({ id: parent.id })
      .from(parent)
      .where(
        and(eq(parent.id, params.parentId), eq(parent.foyerId, params.foyerId)),
      );
    if (!lignes[0]) {
      throw new NotFoundException(`parent introuvable : ${params.parentId}`);
    }
    const jti = randomUUID();
    const emisLe = new Date();
    const expireLe = new Date(
      emisLe.getTime() + this.options.ttlJours * MS_PAR_JOUR,
    );
    await this.db.insert(desabonnementToken).values({
      jti,
      parentId: params.parentId,
      typeNotification: params.typeNotification,
      canal: params.canal,
      emisLe,
      expireLe,
      utiliseLe: null,
    });
    const token = signerJeton(
      { jti, exp: Math.floor(expireLe.getTime() / 1000) },
      this.options.secret,
    );
    return { token, expireLe: expireLe.toISOString() };
  }

  /**
   * Valide et **consomme** un jeton (one-shot) : coupe le canal ciblé et émet
   * l'événement d'état. Lève `400` (générique) si le jeton est invalide, expiré ou
   * déjà utilisé, `409` si couper ce canal rendrait un type de service injoignable.
   */
  async consommer(token: string): Promise<void> {
    const maintenant = new Date();
    const charge = verifierJeton(token, this.options.secret, maintenant);
    if (!charge) {
      throw new BadRequestException('lien de désabonnement invalide ou expiré');
    }
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(desabonnementToken)
        .where(eq(desabonnementToken.jti, charge.jti));
      const row = rows[0];
      if (!row) {
        throw new BadRequestException(
          'lien de désabonnement invalide ou expiré',
        );
      }
      if (
        row.utiliseLe !== null ||
        row.expireLe.getTime() <= maintenant.getTime()
      ) {
        throw new BadRequestException(
          'lien de désabonnement invalide ou expiré',
        );
      }
      const parents = await tx
        .select({ foyerId: parent.foyerId })
        .from(parent)
        .where(eq(parent.id, row.parentId));
      const parentRow = parents[0];
      if (!parentRow) {
        // Parent supprimé entre l'émission et l'usage : lien devenu caduc.
        throw new BadRequestException(
          'lien de désabonnement invalide ou expiré',
        );
      }

      // Invariant service (§5.3) : simuler l'opt-out du canal ciblé et refuser
      // (409) s'il ne resterait aucun canal actif — **sans** consommer le jeton
      // (l'utilisateur pourra gérer ses préférences depuis l'écran).
      const prefRows = await tx
        .select()
        .from(preferenceNotification)
        .where(eq(preferenceNotification.parentId, row.parentId));
      const simule = fusionnerDefauts(prefRows).map((p) =>
        p.typeNotification === row.typeNotification && p.canal === row.canal
          ? { ...p, actif: false }
          : p,
      );
      if (typeServiceInjoignable(simule)) {
        throw new ConflictException(
          'ce canal ne peut pas être coupé : au moins un canal doit rester actif',
        );
      }

      // Prise **atomique** one-shot : `utilise_le IS NULL` dans le WHERE garantit
      // qu'un rejeu concurrent (ou une 2ᵉ requête) ne consomme pas deux fois.
      const pris = await tx
        .update(desabonnementToken)
        .set({ utiliseLe: maintenant })
        .where(
          and(
            eq(desabonnementToken.jti, row.jti),
            isNull(desabonnementToken.utiliseLe),
          ),
        )
        .returning({ jti: desabonnementToken.jti });
      if (!pris[0]) {
        throw new BadRequestException(
          'lien de désabonnement invalide ou expiré',
        );
      }

      // Opt-out de la préférence ciblée : pose `desabonne_at` + `actif=false`,
      // origine `LIEN_DESABO`. On ne touche pas `consentement_at` (trace historique).
      await tx
        .insert(preferenceNotification)
        .values({
          id: randomUUID(),
          parentId: row.parentId,
          typeNotification: row.typeNotification,
          canal: row.canal,
          actif: false,
          consentementAt: null,
          desabonneAt: maintenant,
          sourceDernier: 'LIEN_DESABO',
          updatedAt: maintenant,
        })
        .onConflictDoUpdate({
          target: [
            preferenceNotification.parentId,
            preferenceNotification.typeNotification,
            preferenceNotification.canal,
          ],
          set: {
            actif: false,
            desabonneAt: maintenant,
            sourceDernier: 'LIEN_DESABO',
            updatedAt: maintenant,
          },
        });

      // Événement d'état complet (les consommateurs projettent sans relire).
      const effectives = fusionnerDefauts(
        await tx
          .select()
          .from(preferenceNotification)
          .where(eq(preferenceNotification.parentId, row.parentId)),
      );
      await tx.insert(outbox).values({
        id: randomUUID(),
        type: PREFERENCES_NOTIF_MODIFIEES_TYPE,
        payload: payloadPreferences(
          parentRow.foyerId,
          row.parentId,
          effectives,
        ),
        traceId: traceIdCourant(),
      });
    });
  }
}
