import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  type ContexteAssertion,
  executerAvecContexteAssertion,
} from './contexte-assertion.js';
import type { RequeteIdentifiable } from './identite.js';

/**
 * **Interceptor de propagation** de l'identité parent (chantier fondations lot 3).
 *
 * Enregistré en `APP_INTERCEPTOR` (donc exécuté **après** tous les guards), il lit
 * l'identité posée par `IdentiteGuard` (`req.identite`) et le contexte d'appartenance
 * résolu par `AppartenanceGuard` (`req.foyersAutorises`, `req.estAdmin`), puis exécute
 * le handler — et donc les appels sortants qu'il déclenche — dans un scope
 * `AsyncLocalStorage`. `entetesAval()` y lit le contexte pour signer l'assertion
 * **parent** ; hors requête identifiée (et pendant les guards, avant cet interceptor),
 * il retombe sur l'assertion **machine**.
 */
@Injectable()
export class AssertionPropagationInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<RequeteIdentifiable>();
    const email = req.identite?.email;
    if (email === undefined) {
      return next.handle();
    }
    const contexte: ContexteAssertion = {
      email,
      foyers: req.foyersAutorises,
      admin: req.estAdmin,
    };
    // Le scope ALS doit rester actif pendant toute la souscription au handler
    // (les appels sortants du contrôleur s'y exécutent) : on ouvre le scope autour
    // du `subscribe` du flux aval.
    return new Observable((subscriber) => {
      executerAvecContexteAssertion(contexte, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
