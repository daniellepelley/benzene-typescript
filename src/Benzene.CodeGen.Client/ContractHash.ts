/**
 * The Contract Document hashes as the client generator uses them (contract-document.md §6). The algorithm
 * itself - projection, RFC 8785, SHA-256 - lives in `@benzenejs/codegen-core`, shared with the runtime
 * that stamps both hashes on the document it serves, so a generated client's embedded `contractHash` and
 * the served one are computed by the same code. Port of `Benzene.CodeGen.Core.ContractHash.Compute`.
 */
import { ContractHash } from '@benzenejs/codegen-core';
import { ContractDocument } from './ContractDocument';

/** `contractHash` of `document` (or of whatever projection of one it already is): `{requests, events}`. */
export function computeContractHash(document: ContractDocument | Record<string, unknown>): string {
  return ContractHash.computeContractHash(document);
}

/** `registrationHash` of `document`: `{requests, events, sends}`. */
export function computeRegistrationHash(document: ContractDocument | Record<string, unknown>): string {
  return ContractHash.computeRegistrationHash(document);
}

/**
 * `document` with `contractHash` and `registrationHash` recomputed over it - what a projection carries
 * (contract-document.md §5.2, §5.3: a projection never copies the provider's hashes).
 */
export function withRecomputedHashes(document: ContractDocument): ContractDocument {
  const hashes = ContractHash.compute(document);
  return { ...document, contractHash: hashes.contractHash, registrationHash: hashes.registrationHash };
}
