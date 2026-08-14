/**
 * Stand-in for the downstream services a signup calls. In a real Benzene system each of these methods is
 * a call to another service via an `IBenzeneMessageSender`:
 *
 *     (ctx) => sendMessageAsync<CreateTenant, TenantCreated>(sender, 'tenant:create', { companyName })
 *
 * which already returns `Promise<IBenzeneResultOf<T>>` — exactly what a saga step's `do(...)` wants, so no
 * adapter is needed. Here we back them with an in-memory store so the example runs on its own and you can
 * see the effect of rollback. Port of the .NET `SignupApi`.
 */
import { IBenzeneResult, IBenzeneResultOf } from '@benzenejs/abstractions';
import { BenzeneResult } from '@benzenejs/results';
import { Store } from './store';

export interface TenantCreated {
  tenantId: string;
}
export interface OktaCompanyCreated {
  companyId: string;
}
export interface UserCreated {
  userId: string;
}
export interface RoleCreated {
  roleId: string;
}

export class SignupApi {
  private counter = 0;

  /** Set to a record kind (e.g. `"user"`) to force that create to fail, to demonstrate rollback. */
  failAt: string | undefined;

  /**
   * Where the play-by-play lines go. Defaults to a no-op (so tests stay quiet); the runnable console demo
   * (`index.ts`) passes `console.log`. A small, justified bend from the .NET original's hard-coded
   * `Console.WriteLine`, so the same class is both runnable and cleanly testable.
   */
  constructor(
    private readonly store: Store,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  createTenantAsync(_companyName: string): Promise<IBenzeneResultOf<TenantCreated>> {
    return this.create('tenant', (id) => ({ tenantId: id }));
  }

  createOktaCompanyAsync(_companyName: string): Promise<IBenzeneResultOf<OktaCompanyCreated>> {
    return this.create('okta-company', (id) => ({ companyId: id }));
  }

  createUserAsync(_tenantId: string): Promise<IBenzeneResultOf<UserCreated>> {
    return this.create('user', (id) => ({ userId: id }));
  }

  createRoleAsync(_userId: string): Promise<IBenzeneResultOf<RoleCreated>> {
    return this.create('rbac-role', (id) => ({ roleId: id }));
  }

  deleteTenantAsync(id: string): Promise<IBenzeneResult> {
    return this.delete('tenant', id);
  }
  deleteOktaCompanyAsync(id: string): Promise<IBenzeneResult> {
    return this.delete('okta-company', id);
  }
  deleteUserAsync(id: string): Promise<IBenzeneResult> {
    return this.delete('user', id);
  }
  deleteRoleAsync(id: string): Promise<IBenzeneResult> {
    return this.delete('rbac-role', id);
  }

  private create<T>(kind: string, map: (id: string) => T): Promise<IBenzeneResultOf<T>> {
    if (this.failAt === kind) {
      this.log(`  ✗ create ${kind} FAILED`);
      return Promise.resolve(BenzeneResult.serviceUnavailable<T>());
    }

    const id = `${kind}-${++this.counter}`;
    this.store.add(kind, id);
    this.log(`  ✓ created ${kind} ${id}`);
    return Promise.resolve(BenzeneResult.created(map(id)));
  }

  private delete(kind: string, id: string): Promise<IBenzeneResult> {
    this.store.remove(kind, id);
    this.log(`  ↩ compensated: deleted ${kind} ${id}`);
    return Promise.resolve(BenzeneResult.deleted());
  }
}
