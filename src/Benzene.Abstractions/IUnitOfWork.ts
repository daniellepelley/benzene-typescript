import { ServiceToken, serviceToken } from './DI/ServiceToken';

/**
 * A unit of work scoped to one request/message: the boundary around a set of state changes that must
 * commit or roll back together (typically a database transaction). Register it as a **scoped**
 * service so each request gets its own, isolated from every other in-flight request.
 *
 * Drive it with the `UnitOfWorkMiddleware` (commit when the handler succeeds, roll back when it
 * throws), and implement `disposeAsync()` (via `IServiceResolver.disposeAsync()` at scope end) as a
 * safety-net rollback for any unit left neither committed nor rolled back.
 */
export interface IUnitOfWork {
  /** Persists all changes made in this unit atomically. Idempotent: a no-op once completed. */
  commit(): Promise<void>;

  /** Discards all changes made in this unit. Idempotent: a no-op once completed. */
  rollback(): Promise<void>;
}

export const IUnitOfWork: ServiceToken<IUnitOfWork> = serviceToken<IUnitOfWork>('IUnitOfWork');
