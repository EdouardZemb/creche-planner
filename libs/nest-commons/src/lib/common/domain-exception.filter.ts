import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { DomainError } from '@creche-planner/shared-kernel';

/** Sous-ensemble minimal de la réponse Express utilisé ici (évite @types/express). */
interface ReponseHttp {
  status(code: number): { json(corps: unknown): void };
}

/**
 * Traduit toute `DomainError` (invariant métier cassé) en **HTTP 400**. Garde les
 * contrôleurs propres : la validation d'invariants vit dans le domaine, pas dans
 * la couche HTTP.
 */
@Catch(DomainError)
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ReponseHttp>();
    response.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      error: exception.name,
      message: exception.message,
    });
  }
}
