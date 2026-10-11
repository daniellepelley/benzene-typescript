/** Port of Benzene.Schema.OpenApi.EventService.EventServiceDocument. */
import { ContractHash } from '@benzenejs/codegen-core';
import { Event } from './Event';
import { RequestResponse } from './RequestResponse';
import { Send } from './Send';

/** The dialect of every schema in the document (contract-document.md §1). */
export const SchemaDialect = 'openapi-3.0';

/**
 * The Contract Document (contract-document.md §1) — the `benzene` document the `benzene:spec` topic serves:
 *
 * ```
 * { schemaDialect, service, serviceVersion?, versionScheme?, description?, messageEndpoint?, transports?,
 *   contractHash, registrationHash, requests[], events[], sends[], components.schemas }
 * ```
 *
 * Optional fields serialize only when set (and `transports` only when non-empty). `contractHash` and
 * `registrationHash` are always computed from the document itself (§6) at serialization, so they can never
 * be stale. `benzene:` topics are never listed: the reserved topics' shapes are defined once, in the spec.
 */
export class EventServiceDocument {
  service = '';
  serviceVersion?: string;
  versionScheme?: string;
  description?: string;
  messageEndpoint?: string;
  transports: string[] = [];

  constructor(
    readonly requests: RequestResponse[],
    readonly events: Event[],
    readonly components: Record<string, Record<string, unknown>>,
    readonly sends: Send[] = [],
  ) {}

  toJson(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      requests: this.requests.map((request) => request.toJson()),
      events: this.events.map((event) => event.toJson()),
      sends: this.sends.map((send) => send.toJson()),
      components: { schemas: this.components },
    };
    const hashes = ContractHash.compute(body);

    const json: Record<string, unknown> = { schemaDialect: SchemaDialect, service: this.service };
    if (nonEmpty(this.serviceVersion)) {
      json['serviceVersion'] = this.serviceVersion;
    }
    if (nonEmpty(this.versionScheme)) {
      json['versionScheme'] = this.versionScheme;
    }
    if (nonEmpty(this.description)) {
      json['description'] = this.description;
    }
    if (nonEmpty(this.messageEndpoint)) {
      json['messageEndpoint'] = this.messageEndpoint;
    }
    if (this.transports.length > 0) {
      json['transports'] = this.transports;
    }
    json['contractHash'] = hashes.contractHash;
    json['registrationHash'] = hashes.registrationHash;
    return { ...json, ...body };
  }
}

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}
