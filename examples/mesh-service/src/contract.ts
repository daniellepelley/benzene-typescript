/**
 * Wires this service's **Contract Document** (docs/specification/contract-document.md) - the one
 * self-description a Benzene service has. It is served at `GET /benzene/spec` (and the reserved `benzene:spec`
 * topic), it is what a .NET, Go or TypeScript client generator reads, and it is the exact body a mesh-enabled
 * service registers with a collector (mesh.md §2). Nothing here is hand-maintained JSON: `useSpec` derives the
 * document from the running registry.
 *
 * - `requests` come from the `@message`/`@httpEndpoint` handlers (with their HTTP mappings);
 * - their payload schemas come from a `MapTypeJsonSchemaSource` (a Zod/Joi/Yup adapter would supply them the
 *   same way - TypeScript erases types, so the schema is provided rather than reflected);
 * - `sends` comes from an explicit outbound declaration: `order:create` would capture payment downstream
 *   (exactly the orders -> payments chain `examples/k8s-mesh` wires end to end), so it declares a send to
 *   `payments:capture`. Declaring it is what lets a collector draw the `orders -> payments` edge from the
 *   registration alone, before a single message has flowed (mesh.md §4). There are no events, and the empty
 *   declaration of them is complete - so neither list is `degraded`.
 */
import { IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { ITypeJsonSchemaSource, MapTypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { setApplicationInfo, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzenejs/http';
import { addMeshOutbound, MeshOutboundRegistry } from '@benzenejs/mesh-wire';
import { setServiceDeploymentInfo, useSpec } from '@benzenejs/schema-openapi';
import { CreateOrder, CreateOrderHandler, GetOrderHandler, Order, OrderCreated } from './handlers';

/** `payments:capture` request payload (the downstream call `order:create` would make). */
export class CapturePayment {
  orderId?: string;
}

/** The payload schemas the document publishes, keyed by payload class. */
const schemas = new MapTypeJsonSchemaSource()
  .register(CreateOrder, { type: 'object', properties: { customerId: { type: 'string' } } })
  .register(OrderCreated, { type: 'object', properties: { orderId: { type: 'string' } } })
  .register(Order, { type: 'object', properties: { orderId: { type: 'string' }, status: { type: 'string' } } })
  .register(CapturePayment, { type: 'object', properties: { orderId: { type: 'string' } } });

/** What this service puts on the wire: one send, no events (contract-document.md §3.3). */
const outbound = new MeshOutboundRegistry().register({
  kind: 'send',
  topic: 'payments:capture',
  request: CapturePayment,
});

/**
 * Wires the handlers and the Contract Document onto `pipeline`: identity, placement, schemas, outbound
 * declarations, `useSpec` (the `benzene:spec` handler) and its `GET /benzene/spec` route.
 */
export function useOrderService<TContext>(pipeline: IMiddlewarePipelineBuilder<TContext>): void {
  pipeline.register((container) => {
    setApplicationInfo(container, 'orders', '1.0.0', 'Order intake', 'semver');
    setServiceDeploymentInfo(container, { placement: { cloud: 'self-hosted' } });
    container.addSingletonInstance(ITypeJsonSchemaSource, schemas);
    addMeshOutbound(container, outbound);
    container.addSingletonInstance(IHttpEndpointDefinition, HttpEndpointDefinition.createInstance('GET', '/benzene/spec', 'benzene:spec'));
  });
  useSpec(pipeline);
  useMessageHandlers(pipeline, CreateOrderHandler, GetOrderHandler);
}
