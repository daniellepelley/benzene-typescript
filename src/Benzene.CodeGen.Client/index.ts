/**
 * Port of Benzene.CodeGen.Client - the client SDK generator, pivoted from CLR reflection to JSON Schema.
 *
 * The .NET generator derives a typed client by reflecting over the service's CLR request/response types.
 * That can't cross a language boundary. This port generates the client from the service's **mesh
 * ServiceDescriptor** instead (docs/specification/mesh.md §2) - whose per-topic `requestSchema`/
 * `responseSchema` are language-neutral JSON Schema (§2.1). A C# service produces the descriptor; this
 * package turns it into a fully typed TypeScript client, so the same contract yields a client in any
 * language. See the README "Code generation" note for the reflection -> JSON-Schema rationale.
 *
 * `buildBenzeneClient(descriptor)` / `generateBenzeneClientSource(descriptor)` are the entry points;
 * the type/name building blocks (`typeExpression`, `buildInterface`, the `IMethodName` strategies) are
 * exported for custom generators.
 */
export * from './JsonSchema';
export * from './NameFormatter';
export * from './TopicMethodName';
export * from './TypeScriptTypeName';
export * from './TypeScriptPayloadBuilder';
export * from './BenzeneClientBuilder';
