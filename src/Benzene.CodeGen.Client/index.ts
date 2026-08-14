/**
 * Port of Benzene.CodeGen.Client - the client SDK generator. Two independent input paths share this
 * package (one workspace package per C# project, per the README Structure convention):
 *
 * 1. **Mesh ServiceDescriptor** (docs/specification/mesh.md §2, JSON-Schema-pivoted): the original
 *    port, generating from a *running* service's self-described topics. Entry points
 *    `buildBenzeneClient`/`generateBenzeneClientSource`; see the README "Code generation" note for the
 *    CLR-reflection -> JSON-Schema rationale.
 * 2. **Contract Document** (docs/specification/contract-document.md, OpenAPI-3.0-schema-pivoted, `$ref`
 *    into `components.schemas`): the newer, additional path, generating from a service's *committed*
 *    `.spec.json` build artifact - the same file every language's generator parses, so a Node consumer
 *    of any Benzene service (including a .NET one) gets a typed client with no .NET SDK required. Entry
 *    points `buildMessageClientSdk` (service-level) / `buildAtomicClientSdk` (one self-contained client
 *    per topic, contract-document.md §5.3) / `computeContractHash` / the `codegen-client` CLI (`Cli.ts`,
 *    also this package's `bin`).
 *
 * A few symbols exist in both paths with the same name (each schema model has its own `typeExpression`/
 * `objectProperties`; both builders have a `GeneratedClient` result shape) - re-exported here under a
 * `contract*`-prefixed alias for the Contract Document path so both remain importable from this one
 * package entry point without shadowing each other.
 */
export * from './JsonSchema';
export * from './NameFormatter';
export * from './TopicMethodName';
export * from './TypeScriptTypeName';
export * from './TypeScriptPayloadBuilder';
export * from './BenzeneClientBuilder';

export * from './ContractDocument';
export * from './ContractDocumentParser';
export * from './ClientSdkOptions';
export * from './ContractReservedTopics';
export * from './TopicScope';
export * from './SchemaClosure';
export * from './TopicScopedDocument';
export * from './ContractHash';
export * from './OpenApiPayloadBuilder';
export * from './AtomicClientSdkBuilder';

export type { OpenApiPropertyEntry } from './OpenApiTypeName';
export {
  mergeAllOf,
  objectProperties as contractObjectProperties,
  typeExpression as contractTypeExpression,
} from './OpenApiTypeName';

export type { GeneratedClient as ContractGeneratedClient, MessageClientSdkOptions } from './MessageClientSdkBuilder';
export {
  buildMessageClientSdk,
  generateMessageClientSource,
  namespacedFileName,
  renderClientModule,
} from './MessageClientSdkBuilder';
