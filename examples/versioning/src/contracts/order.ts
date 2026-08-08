/**
 * Payloads for the handler-version-dispatch demo (Mechanism A — versioning.md §3).
 *
 * The topic `order:create` has TWO live payload versions, each served by its OWN handler
 * (`CreateOrderV1MessageHandler` / `CreateOrderV2MessageHandler`). The incoming `benzene-version` header
 * selects which handler runs — no casting is involved, the two shapes are genuinely different
 * implementations. Each version's request/response is its own class (constructor identity is what the
 * router and serializer key on).
 */

/** V1 of the create-order request: a flat customer name. */
export class CreateOrderV1 {
  customerName: string | undefined;
  quantity = 0;
}

export class OrderAcceptedV1 {
  orderId: string | undefined;
  handledBy: string | undefined;
}

/**
 * V2 split the single customer name into first/last and added a currency — a genuinely different request
 * shape, which is exactly when a second handler (rather than a caster) is the right tool.
 */
export class CreateOrderV2 {
  firstName: string | undefined;
  lastName: string | undefined;
  quantity = 0;
  currency: string | undefined;
}

export class OrderAcceptedV2 {
  orderId: string | undefined;
  handledBy: string | undefined;
  currency: string | undefined;
}
