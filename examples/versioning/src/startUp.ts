/**
 * The composition root for the versioning demo, hosted on the BenzeneMessage envelope transport (the
 * version rides in the `benzene-version` header). It dogfoods BOTH versioning axes of versioning.md:
 *
 *  - Mechanism A — handler-version dispatch: `order:create` has two handlers (one per version); the
 *    incoming `benzene-version` selects which runs. No casters are registered for that topic, so the
 *    casting decorators pass it straight through.
 *  - Mechanism B — transparent payload casting: `inventory:adjust` has three payload versions and ONE
 *    handler (on V3). Only ADJACENT casters (V1⇄V2, V2⇄V3) are declared; the `SchemaCastDefinitionsExpander`
 *    composes the missing V1⇄V3 pair by CHAINING at startup, so a V1 producer is upcast V1→V2→V3 to reach
 *    the handler and the response downcast V3→V2→V1 — with no direct V1⇄V3 caster.
 *
 * PORT DIVERGENCE from the .NET example: .NET's `AddPayloadVersioning` auto-synthesises the field-drop
 * DOWNcasters from the declared UPcasters (its reflection + `System.Linq.Expressions` auto-mapper).
 * `@benzene/core-versioning` deliberately does NOT port that auto-mapper (no runtime property reflection
 * in TS — see the package's `index.ts`), so casters are explicit `(from) => to` functions. We therefore
 * declare the adjacent DOWNcasters (V3→V2, V2→V1) too; the expander still CHAINS them (V3→V2→V1), which is
 * the mechanism the example is about.
 */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMessageGetter, IMessageVersionGetter } from '@benzene/abstractions-message-handlers';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  BenzeneMessageGetter,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { VersionAwareMessageGetter } from './versionAwareMessageGetter';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  registerPayloadSchemaVersions,
  registerSchemaCastDefinitions,
  usePayloadVersionCasting,
} from '@benzene/core-versioning';
import {
  InventoryAdjustmentV1,
  InventoryAdjustmentV2,
  InventoryAdjustmentV3,
} from './contracts/inventory';
import {
  AdjustInventoryMessageHandler,
  CreateOrderV1MessageHandler,
  CreateOrderV2MessageHandler,
} from './handlers';
import { IProcessedLog, InMemoryProcessedLog } from './services/processedLog';
import { Topics, Versions } from './topics';

/** The versioning demo booted end-to-end: the BenzeneMessage app + a resolver factory + the shared log. */
export interface VersioningApp {
  readonly app: BenzeneMessageApplication;
  readonly resolverFactory: ReturnType<IBenzeneServiceContainer['createServiceResolverFactory']>;
  readonly log: InMemoryProcessedLog;
}

/**
 * Wires Mechanism B in one place: declare the three inventory versions, the adjacent up/down casters, and
 * the schema-version set. `registerPayloadSchemaVersions` expands these into the full caster set at
 * startup (composing chains) — a missing path would surface here, not on the first message.
 */
function addInventoryVersioning(services: IBenzeneServiceContainer): void {
  registerSchemaCastDefinitions(services, (casters) =>
    casters
      // Upcasts — each seeds the field its version introduces.
      .add<InventoryAdjustmentV1, InventoryAdjustmentV2>(
        InventoryAdjustmentV1,
        InventoryAdjustmentV2,
        Topics.inventoryAdjust,
        Versions.v1,
        Versions.v2,
        (from) => {
          const to = new InventoryAdjustmentV2();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          to.warehouseId = 'wh-main';
          return to;
        },
      )
      .add<InventoryAdjustmentV2, InventoryAdjustmentV3>(
        InventoryAdjustmentV2,
        InventoryAdjustmentV3,
        Topics.inventoryAdjust,
        Versions.v2,
        Versions.v3,
        (from) => {
          const to = new InventoryAdjustmentV3();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          to.warehouseId = from.warehouseId;
          to.reason = 'unspecified';
          return to;
        },
      )
      // Downcasts — each drops the field its higher version added (explicit, per the port divergence above).
      .add<InventoryAdjustmentV3, InventoryAdjustmentV2>(
        InventoryAdjustmentV3,
        InventoryAdjustmentV2,
        Topics.inventoryAdjust,
        Versions.v3,
        Versions.v2,
        (from) => {
          const to = new InventoryAdjustmentV2();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          to.warehouseId = from.warehouseId;
          return to;
        },
      )
      .add<InventoryAdjustmentV2, InventoryAdjustmentV1>(
        InventoryAdjustmentV2,
        InventoryAdjustmentV1,
        Topics.inventoryAdjust,
        Versions.v2,
        Versions.v1,
        (from) => {
          const to = new InventoryAdjustmentV1();
          to.sku = from.sku;
          to.delta = from.delta;
          to.trace = from.trace;
          return to;
        },
      ),
  );

  registerPayloadSchemaVersions(services, [
    {
      topic: Topics.inventoryAdjust,
      fromSchemas: [Versions.v1, Versions.v2, Versions.v3],
      toSchemas: [Versions.v1, Versions.v2, Versions.v3],
    },
  ]);
}

/** Boots the demo the same way a deployed host would, and returns the front door + shared log. */
export function buildVersioningApp(): VersioningApp {
  const container = new DefaultBenzeneServiceContainer();

  const log = new InMemoryProcessedLog();
  container.addSingletonInstance(IProcessedLog, log);

  addBenzene(container);
  addBenzeneMessage(container);
  addInventoryVersioning(container);

  // Key handler-version dispatch off the canonical `benzene-version` header (see
  // `versionAwareMessageGetter.ts`), so both versioning axes read the one metadata header.
  container.addScopedFactory(
    IMessageGetter,
    (resolver) =>
      new VersionAwareMessageGetter(
        resolver.getService(BenzeneMessageGetter) as unknown as IMessageGetter<BenzeneMessageContext>,
        resolver.getService(IMessageVersionGetter) as unknown as IMessageVersionGetter<BenzeneMessageContext>,
      ) as unknown as IMessageGetter<unknown>,
  );

  const pipeline = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(
    pipeline,
    CreateOrderV1MessageHandler,
    CreateOrderV2MessageHandler,
    AdjustInventoryMessageHandler,
  );

  // Apply the casting decorators AFTER the transport's default mappers are registered (by
  // useMessageHandlers → addContextItems), so they win.
  usePayloadVersionCasting<BenzeneMessageContext>(container);

  return {
    app: new BenzeneMessageApplication(pipeline.build()),
    resolverFactory: container.createServiceResolverFactory(),
    log,
  };
}
