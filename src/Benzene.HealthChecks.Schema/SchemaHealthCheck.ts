/** Port of Benzene.HealthChecks.Schema.SchemaHealthCheck. */
import { IMessageHandlerDefinitionLookUp } from '@benzenejs/abstractions-message-handlers';
import { ITypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import {
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
  SchemaHealthCheckConstants,
} from '@benzenejs/health-checks-core';
import { MeshHashing } from '@benzenejs/mesh-contracts';
import { EventServiceDocumentBuilder, SchemaBuilder } from '@benzenejs/schema-openapi';

/**
 * A provider-side contract health check: it hashes the service's current message contract (every
 * registered handler's topic + request/response schema) and publishes the hash so consumers can tell
 * whether the contract still matches what their client was built against. The consumer side of the loop
 * is `@benzenejs/clients-health-checks`'s `ClientHealthCheckProcessor`.
 *
 * PORTING NOTES:
 * - C#'s `CodeGenHelpers.GenerateHash(handlers)` builds an `EventServiceDocument` from the handlers,
 *   strips the non-contract decoration (generated `example` payloads and the `messageEndpoint`
 *   advertisement), serializes it, and HMAC-hashes the JSON. `@benzenejs/schema-openapi`'s ported document
 *   already omits examples/`messageEndpoint`, so `EventServiceDocumentBuilder.generateJson()` is the
 *   normalized serialization directly; the HMAC is the shared `MeshHashing.computeHash` primitive (C#
 *   keeps it in `CodeGen.Core`, which isn't ported — `MeshHashing` documents itself as deliberately the
 *   same algorithm). The hash *value* differs from .NET (the whole TS spec serialization is hand-rolled,
 *   not `Microsoft.OpenApi`), but it is consistent across every TS component that hashes a contract — the
 *   mesh, the spec endpoint, and this check — which is what the drift loop needs.
 * - PORT DIVERGENCE: C#'s `SchemaBuilder` reflects the CLR type to produce each schema, so the C# check
 *   needs only the handler lookup. The TS `SchemaBuilder` sources schemas from the registered
 *   `ITypeJsonSchemaSource`s (validation-derived / bring-your-own — the runtime replacement for
 *   reflection, the same seam `SpecBuilder` and the mesh descriptor use), so this check additionally
 *   takes them; `addSchemaHealthCheck` resolves them from DI. Without any source the request/response
 *   schemas are empty and the hash captures only the topic set.
 */
export class SchemaHealthCheck implements IHealthCheck {
  /**
   * @param lookUp The lookup used to enumerate the service's registered handlers.
   * @param sources The registered JSON-schema sources used to resolve each handler's request/response
   * schema (see the port divergence above). Defaults to none — a topic-set-only hash.
   */
  constructor(
    private readonly lookUp: IMessageHandlerDefinitionLookUp,
    private readonly sources: readonly ITypeJsonSchemaSource[] = [],
  ) {}

  get type(): string {
    return SchemaHealthCheckConstants.type;
  }

  executeAsync(): Promise<IHealthCheckResult> {
    // Build the document from the handlers only — the message contract, deliberately without the
    // info/transport decoration the spec endpoint adds — so the hash is stable across deploys and
    // transport changes, mirroring C#'s handlers-only GenerateHash.
    const json = new EventServiceDocumentBuilder(new SchemaBuilder(this.sources))
      .addMessageHandlerDefinitions(this.lookUp.getAllHandlers())
      .generateJson();

    const hashCode = MeshHashing.computeHash(json);

    const data: Record<string, unknown> = { [SchemaHealthCheckConstants.hashCodeKey]: hashCode };

    return Promise.resolve(HealthCheckResult.createInstance(true, SchemaHealthCheckConstants.type, data));
  }
}
