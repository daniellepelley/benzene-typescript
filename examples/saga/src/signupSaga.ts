/**
 * The user-signup distributed transaction, expressed as a saga:
 *   Stage 1 (parallel): create the tenant AND create the company in Okta.
 *   Stage 2:            create the user, using the tenant ID from stage 1.
 *   Stage 3:            create the RBAC role, using the user ID from stage 2.
 * Every step carries the compensation that undoes it. If any step fails, the orchestrator rolls the whole
 * thing back in reverse order, leaving no orphaned records — then it can be retried. Port of the .NET
 * `SignupSaga`.
 *
 * PORT NOTE (context keys): .NET keys a step's published result by its result TYPE (`ctx.Get<TenantCreated>()`).
 * TypeScript erases generics, so a later stage reads an earlier result by an EXPLICIT string key — declared
 * with `.key(...)` and read with `ctx.get<T>(key)`. The keys below are the only added ceremony.
 */
import { Saga, SagaBuilder } from '@benzenejs/saga';
import {
  OktaCompanyCreated,
  RoleCreated,
  SignupApi,
  TenantCreated,
  UserCreated,
} from './signupApi';

/** Context keys the cross-stage steps publish/read their results under. */
export const SagaKeys = {
  tenant: 'tenant-created',
  user: 'user-created',
} as const;

export function buildSignupSaga(api: SignupApi, companyName: string): Saga {
  return new SagaBuilder()
    .stage((stage) =>
      stage
        .step<TenantCreated>((step) =>
          step
            .do(() => api.createTenantAsync(companyName))
            .compensate((_ctx, tenant) => api.deleteTenantAsync(tenant.tenantId))
            .key(SagaKeys.tenant),
        )
        .step<OktaCompanyCreated>((step) =>
          step
            .do(() => api.createOktaCompanyAsync(companyName))
            .compensate((_ctx, company) => api.deleteOktaCompanyAsync(company.companyId)),
        ),
    )
    .stage((stage) =>
      stage.step<UserCreated>((step) =>
        step
          .do((ctx) => api.createUserAsync(ctx.get<TenantCreated>(SagaKeys.tenant).tenantId))
          .compensate((_ctx, user) => api.deleteUserAsync(user.userId))
          .key(SagaKeys.user),
      ),
    )
    .stage((stage) =>
      stage.step<RoleCreated>((step) =>
        step
          .do((ctx) => api.createRoleAsync(ctx.get<UserCreated>(SagaKeys.user).userId))
          .compensate((_ctx, role) => api.deleteRoleAsync(role.roleId)),
      ),
    )
    .build();
}
