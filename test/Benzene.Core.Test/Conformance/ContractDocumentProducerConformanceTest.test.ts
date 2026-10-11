/**
 * Runs the **producer** groups of `contract-document-cases.json` (contract-document.md §8, the R5
 * contract-document producer claim): `derivationCases`, `namingCases`, `specTopicCases` and, since this
 * port ships HTTP bindings, `specHttpCases`. The client-generator groups and the hash cases run in
 * `ContractDocumentConformanceTest`.
 *
 * Derivation runs on **real Zod output**: each canonical payload type (conformance/README.md "Canonical
 * payload types") is a class whose Zod schema is registered the way an adopter registers one
 * (`registerZodSchema`), named by Zod's own declared-name idiom (`.meta({ id })`), so the runner proves the
 * `ZodJsonSchemaSource` → `SchemaBuilder` → `SpecBuilder` path, not a hand-mapped schema. A nullable property
 * is `T | null`, always emitted, so it is `required` (the README's TypeScript note).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Constructor, IBenzeneResultOf, ServiceIdentifier, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler, IMessageHandlerDefinition } from '@benzenejs/abstractions-message-handlers';
import { ITypeJsonSchemaSource, MapTypeJsonSchemaSource } from '@benzenejs/abstractions-validation';
import { ContractHash } from '@benzenejs/codegen-core';
import {
  addBenzene,
  addBenzeneMessage,
  addMessageHandlers,
  BenzeneMessageApplication,
  MessageHandlerDefinition,
  runStartUpChecks,
  setApplicationInfo,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzenejs/http';
import { addMeshOutbound, MeshOutboundRegistry } from '@benzenejs/mesh-wire';
import { BenzeneResult } from '@benzenejs/results';
import {
  ComponentNameCollisionError,
  setServiceDeploymentInfo,
  SpecBuilder,
  SpecRequest,
  useSpec,
} from '@benzenejs/schema-openapi';
import { registerZodSchema, ZodJsonSchemaSource } from '@benzenejs/zod';
import { addApiGateway, ApiGatewayApplication, ApiGatewayContext } from '@benzenejs/aws-lambda-api-gateway';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { httpBuilder } from '@benzenejs/testing';
import { BenzeneTopic } from '@benzenejs/abstractions';
import { findSubsetMismatch, load } from './ConformanceFixtures';

// ---- The canonical payload types (conformance/README.md), each a class with its Zod schema. ----------------

const ShapesChildSchema = z.object({ name: z.string() }).meta({ id: 'ShapesChild' });
const TreeNodeSchema: z.ZodType<TreeNode> = z
  .object({
    name: z.string(),
    get parent() {
      return TreeNodeSchema.nullable();
    },
    get children() {
      return z.array(TreeNodeSchema);
    },
  })
  .meta({ id: 'TreeNode' }) as unknown as z.ZodType<TreeNode>;

class GreetRequest {
  name = '';
}
class GreetResponse {
  greeting = '';
}
class Greeted {
  greeting = '';
}
class LogEntry {
  message = '';
}
class LookupRequest {
  key = '';
}
class LookupResponse {
  value = '';
}
class ShapesChild {
  name = '';
}
class ShapesRequest {
  count = 0;
  ratio = 0;
  active = false;
  tags: string[] = [];
  labels: Record<string, string> = {};
  note: string | null = null;
  child = new ShapesChild();
  nullableChild: ShapesChild | null = null;
}
class TreeNode {
  name = '';
  parent: TreeNode | null = null;
  children: TreeNode[] = [];
}

const objectOf = (id: string, key: string) => z.object({ [key]: z.string() }).meta({ id });
registerZodSchema(GreetRequest, objectOf('GreetRequest', 'name') as unknown as z.ZodType<GreetRequest>);
registerZodSchema(GreetResponse, objectOf('GreetResponse', 'greeting') as unknown as z.ZodType<GreetResponse>);
registerZodSchema(Greeted, objectOf('Greeted', 'greeting') as unknown as z.ZodType<Greeted>);
registerZodSchema(LogEntry, objectOf('LogEntry', 'message') as unknown as z.ZodType<LogEntry>);
registerZodSchema(LookupRequest, objectOf('LookupRequest', 'key') as unknown as z.ZodType<LookupRequest>);
registerZodSchema(LookupResponse, objectOf('LookupResponse', 'value') as unknown as z.ZodType<LookupResponse>);
registerZodSchema(ShapesChild, ShapesChildSchema);
registerZodSchema(
  ShapesRequest,
  z
    .object({
      count: z.number().int(),
      ratio: z.number(),
      active: z.boolean(),
      tags: z.array(z.string()),
      labels: z.record(z.string(), z.string()),
      note: z.string().nullable(),
      child: ShapesChildSchema,
      nullableChild: ShapesChildSchema.nullable(),
    })
    .meta({ id: 'ShapesRequest' }) as unknown as z.ZodType<ShapesRequest>,
);
registerZodSchema(TreeNode, TreeNodeSchema);

const canonicalTypes: Record<string, Constructor<unknown>> = {
  GreetRequest,
  GreetResponse,
  Greeted,
  LogEntry,
  LookupRequest,
  LookupResponse,
  ShapesRequest,
  ShapesChild,
  TreeNode,
};

/** The handler a request registration names; derivation never dispatches to it. */
class NoopHandler implements IMessageHandler<unknown, unknown> {
  handleAsync(): Promise<IBenzeneResultOf<unknown>> {
    return Promise.resolve(BenzeneResult.ok(undefined));
  }
}

// ---- Fixture shapes ------------------------------------------------------------------------------------------

interface Registrations {
  requests?: { topic: string; version?: string; request: string; response?: string }[];
  events?: { topic: string; version?: string; message: string }[];
  sends?: { topic: string; version?: string; request: string; response?: string }[];
}

type Entry = Record<string, unknown> & { topic: string; version?: string };

/** A derivation case's identity and placement (contract-document.md §1), outside both hashes. */
interface ServiceInfo {
  service: string;
  serviceVersion?: string;
  versionScheme?: string;
  placement?: { cloud: string; region?: string };
}

interface DerivationCase {
  name: string;
  serviceInfo?: ServiceInfo;
  registrations: Registrations;
  expected: Record<string, unknown> & {
    requests: Entry[];
    events: Entry[];
    sends: Entry[];
    contractHash: string;
    registrationHash: string;
  };
}

interface NamingCase {
  name: string;
  types: Record<string, Record<string, unknown>>;
  declaredNames?: Record<string, string>;
  registrations: Registrations;
  expected: { error?: string; name?: string; componentNames?: string[] };
}

interface SpecTopicCase {
  name: string;
  request: Record<string, unknown> | null;
  expected: { statusCode: string; document?: unknown };
}

interface SpecHttpCase {
  name: string;
  path: string;
  expected: { httpStatus: number; document?: unknown };
}

interface ProducerFixture {
  derivationCases: DerivationCase[];
  namingCases: NamingCase[];
  specTopicCases: SpecTopicCase[];
  specHttpCases: SpecHttpCase[];
}

const fixture = load<ProducerFixture>('contract-document-cases.json');

// ---- Wiring -------------------------------------------------------------------------------------------------

/** Registers the case's handlers, events and sends in `container`, exactly as an adopter would. */
function register(
  container: DefaultBenzeneServiceContainer,
  registrations: Registrations,
  typeOf: (name: string) => ServiceIdentifier<unknown>,
): void {
  for (const request of registrations.requests ?? []) {
    container.addSingletonInstance(
      IMessageHandlerDefinition,
      MessageHandlerDefinition.createInstance(
        request.topic,
        request.version ?? '',
        typeOf(request.request),
        request.response === undefined ? VoidResult : typeOf(request.response),
        NoopHandler,
      ),
    );
  }
  const outbound = new MeshOutboundRegistry();
  for (const event of registrations.events ?? []) {
    outbound.register({ kind: 'event', topic: event.topic, version: event.version, message: typeOf(event.message) });
  }
  for (const send of registrations.sends ?? []) {
    outbound.register({
      kind: 'send',
      topic: send.topic,
      version: send.version,
      request: typeOf(send.request),
      response: send.response === undefined ? undefined : typeOf(send.response),
    });
  }
  addMeshOutbound(container, outbound);
}

/** The document-level fields a derivation case's `expected` may pin (everything but the members and hashes). */
const identityFields = ['service', 'serviceVersion', 'versionScheme', 'placement'] as const;

function deriveDocument(registrations: Registrations, serviceInfo?: ServiceInfo): Record<string, unknown> {
  const container = new DefaultBenzeneServiceContainer();
  addMessageHandlers(container);
  // The identity the case declares, through the two seams an adopter uses: the application info (service,
  // serviceVersion, versionScheme) and the deployment info (placement).
  setApplicationInfo(
    container,
    serviceInfo?.service ?? 'conformance',
    serviceInfo?.serviceVersion ?? '',
    '',
    serviceInfo?.versionScheme,
  );
  if (serviceInfo?.placement !== undefined) {
    setServiceDeploymentInfo(container, { placement: serviceInfo.placement });
  }
  container.addSingletonInstance(ITypeJsonSchemaSource, new ZodJsonSchemaSource());
  register(container, registrations, (name) => canonicalTypes[name]!);
  const resolver = container.createServiceResolverFactory().createScope();
  try {
    return JSON.parse(new SpecBuilder().createSpec(resolver, new SpecRequest('benzene', 'json'))) as Record<
      string,
      unknown
    >;
  } finally {
    resolver.dispose();
  }
}

/** The comparison form of contract-document.md §6.2 steps 3–4 for one schema of `document`. */
function comparable(schema: unknown, document: Record<string, unknown>): unknown {
  const components = ((document['components'] as Record<string, unknown> | undefined)?.['schemas'] ?? {}) as Record<
    string,
    unknown
  >;
  return ContractHash.normalizeSchema(schema, components);
}

function key(entry: { topic: string; version?: string }): string {
  return `${entry.topic} ${entry.version ?? ''}`;
}

/** Every `$ref` in `value`. */
function refsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => refsIn(item, out));
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      if (k === '$ref' && typeof v === 'string') {
        out.push(v);
      } else {
        refsIn(v, out);
      }
    }
  }
  return out;
}

// ---- The groups ---------------------------------------------------------------------------------------------

describe('ContractDocumentProducerConformanceTest', () => {
  describe('derivationCases', () => {
    for (const derivationCase of fixture.derivationCases) {
      it(derivationCase.name, () => {
        const document = deriveDocument(derivationCase.registrations, derivationCase.serviceInfo);
        const expected = derivationCase.expected;

        // The identity fields `expected` carries, subset-matched against the document (README, derivationCases).
        const expectedIdentity = Object.fromEntries(
          identityFields.filter((field) => field in expected).map((field) => [field, expected[field]]),
        );
        const identityMismatch = findSubsetMismatch(expectedIdentity, document);
        expect(identityMismatch, identityMismatch ?? undefined).toBeNull();

        for (const member of ['requests', 'events', 'sends'] as const) {
          const actualEntries = (document[member] as Entry[]) ?? [];
          expect(actualEntries.map(key).sort(), `${member} entries`).toEqual(expected[member].map(key).sort());
          for (const expectedEntry of expected[member]) {
            const actual = actualEntries.find((entry) => key(entry) === key(expectedEntry))!;
            expect('version' in actual, `${member} ${expectedEntry.topic} version presence`).toBe(
              'version' in expectedEntry,
            );
            for (const field of ['request', 'response', 'message']) {
              expect(field in actual, `${member} ${expectedEntry.topic}.${field} presence`).toBe(field in expectedEntry);
              if (field in expectedEntry) {
                expect(comparable(actual[field], document), `${member} ${expectedEntry.topic}.${field}`).toEqual(
                  expectedEntry[field],
                );
              }
            }
          }
        }

        const schemas = (document['components'] as { schemas: Record<string, unknown> }).schemas;
        for (const name of Object.keys(schemas)) {
          expect(name, 'component key validity').toMatch(/^[A-Za-z0-9._-]+$/);
        }
        for (const ref of refsIn(document)) {
          expect(ref.startsWith('#/components/schemas/'), `ref ${ref}`).toBe(true);
          expect(ref.slice('#/components/schemas/'.length) in schemas, `ref ${ref} resolves`).toBe(true);
        }

        expect(document['schemaDialect']).toBe('openapi-3.0');
        expect(document['contractHash']).toBe(expected.contractHash);
        expect(document['registrationHash']).toBe(expected.registrationHash);
      });
    }
  });

  describe('namingCases', () => {
    for (const namingCase of fixture.namingCases) {
      it(namingCase.name, () => {
        // Each qualified name becomes a class with its simple name (`orders.Item` -> a class named `Item`),
        // the way two modules each declaring `Item` look to the spec builder.
        const types = new Map<string, Constructor<unknown>>();
        const source = new MapTypeJsonSchemaSource();
        for (const [qualified, schema] of Object.entries(namingCase.types)) {
          const simple = qualified.slice(qualified.lastIndexOf('.') + 1);
          const type = { [simple]: class {} }[simple]!;
          types.set(qualified, type);
          source.register(type, schema, { name: namingCase.declaredNames?.[qualified] });
        }

        const container = new DefaultBenzeneServiceContainer();
        addBenzene(container);
        addBenzeneMessage(container);
        setApplicationInfo(container, 'conformance', '', '');
        container.addSingletonInstance(ITypeJsonSchemaSource, source);
        register(container, namingCase.registrations, (name) => types.get(name)!);
        const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
        useSpec(builder);
        useMessageHandlers(builder);
        const factory = container.createServiceResolverFactory();

        if (namingCase.expected.error === 'component-name-collision') {
          // "Before any message is handled": the start-up checks every host runs at initialization.
          let caught: unknown;
          try {
            runStartUpChecks(factory);
          } catch (error) {
            caught = error;
          }
          expect(caught, 'derivation must fail at start-up').toBeDefined();
          const cause = (caught as { cause?: unknown }).cause;
          const errors = cause instanceof AggregateError ? cause.errors : [cause];
          const failure = errors.find((error) => error instanceof ComponentNameCollisionError);
          expect(failure).toBeInstanceOf(ComponentNameCollisionError);
          expect((failure as ComponentNameCollisionError).componentName).toBe(namingCase.expected.name);
          expect((failure as Error).message).toContain(namingCase.expected.name!);
          return;
        }

        runStartUpChecks(factory);
        const resolver = factory.createScope();
        const document = JSON.parse(new SpecBuilder().createSpec(resolver, new SpecRequest())) as {
          components: { schemas: Record<string, unknown> };
        };
        resolver.dispose();
        for (const name of namingCase.expected.componentNames ?? []) {
          expect(Object.keys(document.components.schemas)).toContain(name);
        }
      });
    }
  });

  describe('specTopicCases (benzene:spec over the envelope)', () => {
    for (const specCase of fixture.specTopicCases) {
      it(specCase.name, async () => {
        const container = new DefaultBenzeneServiceContainer();
        addBenzene(container);
        addBenzeneMessage(container);
        setApplicationInfo(container, 'conformance', '', '');
        container.addSingletonInstance(ITypeJsonSchemaSource, new ZodJsonSchemaSource());
        register(container, fixture.derivationCases[0]!.registrations, (name) => canonicalTypes[name]!);
        const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
        useSpec(builder);
        useMessageHandlers(builder);

        const request = new BenzeneMessageRequest();
        request.topic = BenzeneTopic.spec;
        request.headers = {};
        if (specCase.request !== null) {
          request.body = JSON.stringify(specCase.request);
        }
        const response = await new BenzeneMessageApplication(builder.build()).handleAsync(
          request,
          container.createServiceResolverFactory(),
        );

        expect(response.statusCode, specCase.name).toBe(specCase.expected.statusCode);
        if (specCase.expected.document !== undefined) {
          const mismatch = findSubsetMismatch(specCase.expected.document, JSON.parse(response.body) as unknown);
          expect(mismatch, mismatch ?? undefined).toBeNull();
        }
      });
    }
  });

  describe('specHttpCases (GET /benzene/spec through the pipeline)', () => {
    for (const httpCase of fixture.specHttpCases) {
      it(httpCase.name, async () => {
        const container = new DefaultBenzeneServiceContainer();
        addBenzene(container);
        addApiGateway(container);
        setApplicationInfo(container, 'conformance', '', '');
        container.addSingletonInstance(ITypeJsonSchemaSource, new ZodJsonSchemaSource());
        register(container, fixture.derivationCases[0]!.registrations, (name) => canonicalTypes[name]!);
        container.addSingletonFactory(
          IHttpEndpointDefinition,
          () => new HttpEndpointDefinition('GET', '/benzene/spec', BenzeneTopic.spec),
        );
        const builder = new MiddlewarePipelineBuilder<ApiGatewayContext>(container);
        useSpec(builder);
        useMessageHandlers(builder);

        const [path, query] = httpCase.path.split('?');
        const event = asApiGatewayRequest(httpBuilder('GET', path!));
        event.queryStringParameters = query === undefined ? null : Object.fromEntries(new URLSearchParams(query));
        const response = await new ApiGatewayApplication(builder.build()).handleAsync(
          event,
          container.createServiceResolverFactory(),
        );

        expect(response.statusCode, httpCase.name).toBe(httpCase.expected.httpStatus);
        if (httpCase.expected.document !== undefined) {
          const mismatch = findSubsetMismatch(httpCase.expected.document, JSON.parse(response.body) as unknown);
          expect(mismatch, mismatch ?? undefined).toBeNull();
        }
      });
    }
  });
});
