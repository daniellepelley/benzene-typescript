import { IBenzeneResult, ServiceIdentifier } from '@benzene/abstractions';
import { ITopic } from '@benzene/abstractions-messages';
import { ResponseEventPublication } from './ResponseEventPublication';

/**
 * One rule for turning a handler's response into a follow-up event. Registered per pipeline via
 * {@link ResponseEventsBuilder} and evaluated by {@link ResponseEventsMiddleware} after the handler
 * runs; every mapping that resolves a publication publishes (fan-out is allowed). The metadata
 * properties exist so mappings are introspectable as plain data - via {@link IResponseEventCatalog} at
 * runtime and spec generation at build time. Convention-based rules that derive topics at runtime
 * return `undefined` metadata; explicit mappings should populate it.
 * Port of Benzene.ResponseEvents.IResponseEventMapping.
 *
 * The C# interface gives `Covers` a default implementation; TypeScript interfaces cannot, so every
 * implementer supplies `covers` (the explicit mappings replicate the C# default - a case-insensitive
 * `sourceTopic` match).
 */
export interface IResponseEventMapping {
  /** Human-readable summary of the rule, for diagnostics and introspection. */
  readonly description: string;

  /** The source topic id this mapping listens on, or `undefined` for convention rules that match dynamically. */
  readonly sourceTopic: string | undefined;

  /** The event topic id this mapping publishes on, or `undefined` for convention rules that derive it at runtime. */
  readonly eventTopic: string | undefined;

  /** The declared event payload type (used for spec generation), or `undefined` when undeclared. */
  readonly payloadType: ServiceIdentifier<unknown> | undefined;

  /**
   * Decides whether this mapping fires for the given handled message, and with what.
   * @returns The event to publish, or `undefined` if this mapping does not apply.
   */
  resolve(sourceTopic: ITopic, result: IBenzeneResult): ResponseEventPublication | undefined;

  /**
   * Whether this mapping *could* publish an event for a successful response on `topic` - a static
   * coverage check for diagnostics (the unmapped-response handler warning), independent of any runtime
   * result, status, or payload.
   */
  covers(topic: ITopic): boolean;
}
