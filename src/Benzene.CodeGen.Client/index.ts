/**
 * Port of Benzene.CodeGen.Client - the client SDK generator. It reads a service's **Contract Document**
 * (docs/specification/contract-document.md, OpenAPI-3.0-schema-pivoted, `$ref` into `components.schemas`) - the
 * document every Benzene service serves at `benzene:spec`, commits as its `.spec.json` build artifact, and
 * registers with a mesh collector - so a Node consumer of any Benzene service (including a .NET or Go one) gets a
 * typed client with no other SDK required. Entry points `buildMessageClientSdk` (service-level) /
 * `buildAtomicClientSdk` (one self-contained client per topic, contract-document.md §5.3) /
 * `computeContractHash` / the `codegen-client` CLI (`Cli.ts`, also this package's `bin`).
 *
 * The earlier generator over the mesh ServiceDescriptor (`buildBenzeneClient` and its JSON-Schema type mapper)
 * was removed with the descriptor in spec 3b; the Contract Document carries the same contract and more. A few
 * symbols keep their `contract*`-prefixed aliases from when both paths shared this entry point.
 */
export * from './NameFormatter';
export * from './TopicMethodName';

export * from './ContractDocument';
export * from './ContractDocumentParser';
export * from './ClientSdkOptions';
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
