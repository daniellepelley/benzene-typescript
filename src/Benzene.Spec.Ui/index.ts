/**
 * Port of Benzene.Spec.Ui — a Swagger-UI-style explorer for a service's benzene spec (topics,
 * request/response payloads, published events, and the validation rules in their JSON Schemas). `useSpecUi`
 * serves a self-contained HTML page on an HTTP pipeline; the page fetches the spec from a benzene `spec`
 * endpoint (`useSpec`, `@benzene/schema-openapi`) and resolves each `$ref` against `components.schemas`.
 *
 * Divergence: C# embeds the page as an assembly resource; the port inlines it as a string constant
 * (`SpecUiPage`) so a bundled Node/Lambda artifact needs no filesystem/resource access. See README
 * "Porting conventions".
 */
export * from './SpecUiPage';
export * from './SpecUiMiddleware';
export * from './SpecUiExtensions';
