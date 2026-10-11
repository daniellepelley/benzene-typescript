/**
 * Runs the **client-generator** groups of `contract-document-cases.json` (`parseCases`, `topicScopeCases`,
 * `schemaClosureCases`) and every case of `contract-hash-cases.json` (contract-document.md §5, §6, §8). The
 * producer groups run in `ContractDocumentProducerConformanceTest`.
 *
 * The hash cases run twice over: the cases without a `projection` through `@benzenejs/codegen-core` -
 * the runtime hash every document this port serves carries (the producer claim) - and every case,
 * projections included, through the client generator's own projection functions (`applyTopicScope`,
 * `projectTopicScoped`), whose recomputed `contractHash`/`registrationHash` are what a generated client
 * embeds. Topic, event, send and component lists compare as sets.
 */
import { describe, expect, it } from 'vitest';
import { ContractHash } from '@benzenejs/codegen-core';
import {
  ContractDocument,
  ContractDocumentParseError,
  OpenApiSchemaObject,
  UnknownTopicsError,
  applyTopicScope,
  parseContractDocument,
  projectTopicScoped,
  reachableSchemaNames,
} from '@benzenejs/codegen-client';
import { load } from './ConformanceFixtures';

interface ExpectedEntry {
  topic: string;
  versionPresent?: boolean;
  version?: string;
  responsePresent?: boolean;
}

interface ParseCase {
  name: string;
  documentRef: string;
  options?: { topics?: string[] };
  expected?: {
    schemaDialect?: string;
    service?: string;
    requests?: ExpectedEntry[];
    events?: ExpectedEntry[];
    sends?: ExpectedEntry[];
  };
  expectedError?: { kind: string; unknownTopics?: string[]; validTopics?: string[] };
}

interface TopicScopeCase {
  name: string;
  documentRef: string;
  options: { topics?: string[] };
  expectedTopics: string[];
  expectedEvents?: string[];
  expectedSends?: string[];
}

interface SchemaClosureCase {
  name: string;
  documentRef: string;
  topic: string;
  expectedComponents: string[];
}

interface ContractDocumentFixture {
  documents: Record<string, Record<string, unknown>>;
  parseCases: ParseCase[];
  topicScopeCases: TopicScopeCase[];
  schemaClosureCases: SchemaClosureCase[];
}

interface HashCase {
  name: string;
  document: Record<string, unknown>;
  projection?: { kind: 'topic'; topic: string } | { kind: 'include-list'; topics: string[] };
  expectedContractHash: string;
  expectedRegistrationHash: string;
}

const documentCasesFixture = load<ContractDocumentFixture>('contract-document-cases.json');
const hashCasesFixture = load<{ cases: HashCase[] }>('contract-hash-cases.json');

function documentFor(ref: string): ContractDocument {
  return parseContractDocument(documentCasesFixture.documents[ref]!);
}

function assertSetEqual(actual: Iterable<string>, expected: readonly string[], label: string): void {
  expect([...new Set(actual)].sort(), label).toEqual([...new Set(expected)].sort());
}

/** Asserts per-entry rows keyed by (topic, version) against `entries` (README "parseCases"). */
function assertEntries(
  entries: ReadonlyArray<{ topic: string; version?: string; response?: unknown }>,
  rows: readonly ExpectedEntry[],
  member: string,
): void {
  for (const row of rows) {
    const actual = entries.find(
      (entry) =>
        entry.topic === row.topic &&
        (row.versionPresent === false ? entry.version === undefined : row.version === undefined || entry.version === row.version),
    );
    expect(actual, `${member}[] missing ${row.topic} ${row.version ?? ''}`).toBeDefined();
    if (row.versionPresent === false) {
      expect('version' in actual! && actual!.version !== undefined, `${row.topic}.version must be absent`).toBe(false);
    }
    if (row.versionPresent === true) {
      expect(actual!.version).toBe(row.version);
    }
    if (row.responsePresent !== undefined) {
      expect(actual!.response !== undefined, `${member} ${row.topic} response presence`).toBe(row.responsePresent);
    }
  }
}

describe('ContractDocumentConformanceTest', () => {
  describe('parseCases', () => {
    for (const parseCase of documentCasesFixture.parseCases) {
      it(parseCase.name, () => {
        if (parseCase.expectedError !== undefined) {
          let caught: unknown;
          try {
            applyTopicScope(documentFor(parseCase.documentRef), { topics: parseCase.options?.topics });
          } catch (error) {
            caught = error;
          }
          expect(caught, `expected a '${parseCase.expectedError.kind}' failure`).toBeDefined();
          expect((caught as { kind?: string }).kind).toBe(parseCase.expectedError.kind);
          if (parseCase.expectedError.kind === 'unknown-schema-dialect') {
            expect(caught).toBeInstanceOf(ContractDocumentParseError);
          }
          if (parseCase.expectedError.kind === 'unknown-topics') {
            const error = caught as UnknownTopicsError;
            assertSetEqual(error.unknownTopics, parseCase.expectedError.unknownTopics!, 'unknownTopics');
            assertSetEqual(error.validTopics, parseCase.expectedError.validTopics!, 'validTopics');
          }
          return;
        }

        const document = documentFor(parseCase.documentRef);
        const expected = parseCase.expected!;
        if (expected.schemaDialect !== undefined) {
          expect(document.schemaDialect).toBe(expected.schemaDialect);
        }
        if (expected.service !== undefined) {
          expect(document.service).toBe(expected.service);
        }
        if (expected.requests !== undefined) {
          // A `benzene:` entry is ignored, not listed: the listed rows are exactly the topics there.
          assertSetEqual(
            document.requests.map((r) => r.topic),
            expected.requests.map((r) => r.topic),
            'requests',
          );
          assertEntries(document.requests, expected.requests, 'requests');
        }
        assertEntries(document.events, expected.events ?? [], 'events');
        assertEntries(document.sends, expected.sends ?? [], 'sends');
      });
    }
  });

  describe('topicScopeCases', () => {
    for (const topicScopeCase of documentCasesFixture.topicScopeCases) {
      it(topicScopeCase.name, () => {
        const scoped = applyTopicScope(documentFor(topicScopeCase.documentRef), topicScopeCase.options);
        assertSetEqual(scoped.requests.map((r) => r.topic), topicScopeCase.expectedTopics, 'expectedTopics');
        if (topicScopeCase.expectedEvents !== undefined) {
          assertSetEqual(scoped.events.map((e) => e.topic), topicScopeCase.expectedEvents, 'expectedEvents');
        }
        if (topicScopeCase.expectedSends !== undefined) {
          assertSetEqual(scoped.sends.map((s) => s.topic), topicScopeCase.expectedSends, 'expectedSends');
        }
      });
    }
  });

  describe('schemaClosureCases', () => {
    for (const closureCase of documentCasesFixture.schemaClosureCases) {
      it(closureCase.name, () => {
        const document = documentFor(closureCase.documentRef);
        const request = document.requests.find((entry) => entry.topic === closureCase.topic);
        expect(request, `document has no topic '${closureCase.topic}'`).toBeDefined();

        const reached = reachableSchemaNames(
          document.components.schemas as Record<string, OpenApiSchemaObject>,
          request!.request,
          request!.response,
        );
        assertSetEqual(reached, closureCase.expectedComponents, 'expectedComponents');
      });
    }
  });

  describe('contract-hash-cases (runtime hash: cases without a projection)', () => {
    for (const hashCase of hashCasesFixture.cases.filter((c) => c.projection === undefined)) {
      it(hashCase.name, () => {
        const hashes = ContractHash.compute(hashCase.document);
        expect(hashes.contractHash, 'contractHash').toBe(hashCase.expectedContractHash);
        expect(hashes.registrationHash, 'registrationHash').toBe(hashCase.expectedRegistrationHash);
      });
    }
  });

  describe('contract-hash-cases (client generator: every case)', () => {
    for (const hashCase of hashCasesFixture.cases) {
      it(hashCase.name, () => {
        const document = parseContractDocument(hashCase.document);
        const projection = hashCase.projection;
        const projected =
          projection === undefined
            ? applyTopicScope(document, {})
            : projection.kind === 'topic'
              ? projectTopicScoped(document, projection.topic)
              : applyTopicScope(document, { topics: projection.topics });
        expect(projected.contractHash, 'contractHash').toBe(hashCase.expectedContractHash);
        expect(projected.registrationHash, 'registrationHash').toBe(hashCase.expectedRegistrationHash);
      });
    }
  });
});
