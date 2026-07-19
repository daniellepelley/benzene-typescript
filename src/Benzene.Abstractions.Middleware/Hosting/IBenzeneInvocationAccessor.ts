import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IBenzeneInvocation } from './IBenzeneInvocation';

/**
 * Port of Benzene.Abstractions.Hosting.IBenzeneInvocationAccessor.
 *
 * Scoped mutable holder that carries the current invocation's `IBenzeneInvocation` from the pipeline
 * middleware that creates it (populated once per invocation) to wherever it's injected. Application code
 * should depend on `IBenzeneInvocation` directly; this accessor exists only so hosting-platform
 * middleware has somewhere to put the invocation it builds.
 *
 * C# `IBenzeneInvocation? Invocation { get; set; }` → a mutable `invocation` property (C# `null` →
 * `undefined`).
 */
export interface IBenzeneInvocationAccessor {
  /** The current invocation, or `undefined` before the pipeline middleware has populated it. */
  invocation: IBenzeneInvocation | undefined;
}

export const IBenzeneInvocationAccessor: ServiceToken<IBenzeneInvocationAccessor> =
  serviceToken<IBenzeneInvocationAccessor>('IBenzeneInvocationAccessor');
