/** Port of Benzene.Mesh.Dispatch.IMeshDispatchEnvironment (+ EnvironmentVariableMeshDispatchEnvironment). */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

/** Tells the dispatch gate whether the process is running in a Production environment. */
export interface IMeshDispatchEnvironment {
  /** Whether this process considers itself to be running in Production. */
  readonly isProduction: boolean;
}

/** Container token: the gate resolves the environment by this interface. */
export const IMeshDispatchEnvironment: ServiceToken<IMeshDispatchEnvironment> =
  serviceToken<IMeshDispatchEnvironment>('IMeshDispatchEnvironment');

/**
 * Default {@link IMeshDispatchEnvironment} reading the environment from process env vars. An UNSET
 * environment is treated as Production - the safe default, so dispatch is off unless the host is
 * explicitly non-production (or `MeshDispatchOptions.allowInProduction` is set).
 *
 * DIVERGENCE: C# reads `ASPNETCORE_ENVIRONMENT`/`DOTNET_ENVIRONMENT`; the Node port reads `NODE_ENV` first
 * (the Node convention) then falls back to those two for teams migrating from .NET. Production when the
 * resolved value is empty/unset or equals `production`/`Production` (case-insensitive).
 */
export class EnvironmentVariableMeshDispatchEnvironment implements IMeshDispatchEnvironment {
  get isProduction(): boolean {
    const environment =
      process.env.NODE_ENV ??
      process.env.ASPNETCORE_ENVIRONMENT ??
      process.env.DOTNET_ENVIRONMENT;
    return (
      environment === undefined ||
      environment.trim() === '' ||
      environment.toLowerCase() === 'production'
    );
  }
}
