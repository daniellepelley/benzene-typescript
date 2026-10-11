/**
 * Port of Benzene.CodeGen.Core - the Contract Document's hash pipeline (contract-document.md §6): the
 * projection, RFC 8785 canonicalization and SHA-256 that yield `contractHash` and `registrationHash`.
 *
 * A package of its own, with no Benzene dependency, so that the runtime (`@benzenejs/schema-openapi`, which
 * stamps both hashes on every document it serves) and the client generator (`@benzenejs/codegen-client`,
 * which embeds one in every generated client) share one implementation, and a deployed service never ships
 * the code generator to compute them.
 */
export * from './JsonCanonicalizer';
export * from './ContractHash';
