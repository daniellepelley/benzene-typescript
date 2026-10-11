/**
 * Port of `Benzene.CodeGen.Client.ClientSdkOptions`, scoped to the Contract Document generators
 * (`MessageClientSdkBuilder` / `AtomicClientSdkBuilder`): naming and topic scoping
 * (contract-document.md §5.1-§5.2). A plain interface rather than a class - there is no builder-owned
 * mutable state to wrap, and every consumer here just reads it.
 */
export interface ClientSdkOptions {
  /**
   * The service name used for class/file naming (e.g. `"Payments"` -> `PaymentsServiceClient`).
   * Required by `buildMessageClientSdk`; ignored by `buildAtomicClientSdk`, which derives each topic's
   * client name from the topic itself instead (it still names the aggregate registration function).
   */
  serviceName?: string;

  /**
   * The generated namespace/module label, used exactly - no magic `.{serviceName}` suffix - across
   * the client class, its interface, and its DTOs. Required. `buildAtomicClientSdk` still appends
   * `.{ClientName}` per topic below this root, since each atomic client is self-contained.
   */
  namespace: string;

  /**
   * The topic include-list: only these topics are in scope. Undefined/empty means every topic in the
   * document's `requests[]` (contract-document.md §5.2). A topic named here the document doesn't have
   * fails loud rather than silently generating nothing for it. `benzene:` topics are never in a parsed
   * document, so a generated client covers a service's own topics only (§5.1).
   */
  topics?: readonly string[];
}
