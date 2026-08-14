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
   * The topic include-list: only these topics are in scope. Undefined/empty means "every domain
   * topic" (contract-document.md §5.1), subject to `includeReserved`. A topic named here the
   * document doesn't have fails loud (§5.2) rather than silently generating nothing for it.
   */
  topics?: readonly string[];

  /**
   * When true (and `topics` is not set), every reserved Benzene utility topic (`benzene:spec`,
   * `benzene:healthcheck`, `benzene:mesh`, ...) is admitted too, so a generated client can cover
   * Benzene's own framework surface as well as a service's domain topics. Ignored when `topics`
   * explicitly names a topic: an explicit ask always wins over this default.
   */
  includeReserved?: boolean;
}
