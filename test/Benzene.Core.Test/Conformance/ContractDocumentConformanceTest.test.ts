/**
 * Runs `docs/specification/contract-document.md`'s two fixtures - the TypeScript reference runner for
 * the Contract Document format, its topic-scope/schema-closure generation semantics (§5), and its
 * `contractHash` algorithm (§6). Port of the .NET port's own contract-document conformance test (see
 * `conformance/README.md`'s "Contract Document and contract hash case formats").
 *
 * `expectedTopics`/`expectedComponents` are compared as **sets** (order-independent, no duplicates
 * expected either side) per the fixture format; everything else follows the subset-matching rules
 * `ConformanceFixtures.ts` already implements for the other conformance tests in this directory.
 */
import { describe, expect, it } from 'vitest';
import {
  ContractDocument,
  OpenApiSchemaObject,
  parseContractDocument,
  computeContractHash,
  applyTopicScope,
  UnknownTopicsError,
  reachableSchemaNames,
  isReservedEntry,
} from '@benzenejs/codegen-client';
import { load } from './ConformanceFixtures';

interface ExpectedRequest {
  topic: string;
  versionPresent?: boolean;
  version?: string;
  reserved?: boolean;
}

interface ExpectedEvent {
  topic: string;
  versionPresent?: boolean;
  version?: string;
}

interface ParseCase {
  name: string;
  documentRef: string;
  options?: { topics?: string[] };
  expected?: { openapi?: string; requests?: ExpectedRequest[]; events?: ExpectedEvent[] };
  expectedError?: { unknownTopics: string[]; validTopics: string[] };
}

interface TopicScopeCase {
  name: string;
  documentRef: string;
  options: { topics?: string[]; includeReserved?: boolean };
  expectedTopics: string[];
}

interface SchemaClosureCase {
  name: string;
  documentRef: string;
  topic: string;
  expectedComponents: string[];
}

interface ContractDocumentFixture {
  documents: Record<string, unknown>;
  parseCases: ParseCase[];
  topicScopeCases: TopicScopeCase[];
  schemaClosureCases: SchemaClosureCase[];
}

interface HashCase {
  name: string;
  document: Record<string, unknown>;
  expectedHash: string;
}

interface ContractHashFixture {
  cases: HashCase[];
}

const documentCasesFixture = load<ContractDocumentFixture>('contract-document-cases.json');
const hashCasesFixture = load<ContractHashFixture>('contract-hash-cases.json');

function documentFor(ref: string): ContractDocument {
  return parseContractDocument(documentCasesFixture.documents[ref] as Record<string, unknown>);
}

function assertSetEqual(actual: Iterable<string>, expected: readonly string[], label: string): void {
  const actualSorted = [...new Set(actual)].sort();
  const expectedSorted = [...new Set(expected)].sort();
  expect(actualSorted, label).toEqual(expectedSorted);
}

describe('ContractDocumentConformanceTest', () => {
  describe('parseCases', () => {
    for (const parseCase of documentCasesFixture.parseCases) {
      it(parseCase.name, () => {
        const document = documentFor(parseCase.documentRef);

        if (parseCase.expectedError !== undefined) {
          let caught: unknown;
          try {
            applyTopicScope(document, { topics: parseCase.options?.topics });
          } catch (error) {
            caught = error;
          }
          expect(caught, 'expected UnknownTopicsError to be thrown').toBeInstanceOf(UnknownTopicsError);
          const unknownTopicsError = caught as UnknownTopicsError;
          assertSetEqual(unknownTopicsError.unknownTopics, parseCase.expectedError.unknownTopics, 'unknownTopics');
          assertSetEqual(unknownTopicsError.validTopics, parseCase.expectedError.validTopics, 'validTopics');
          return;
        }

        const expected = parseCase.expected!;
        if (expected.openapi !== undefined) {
          expect(document.openapi).toBe(expected.openapi);
        }

        for (const expectedRequest of expected.requests ?? []) {
          const actual = document.requests.find((request) => request.topic === expectedRequest.topic);
          expect(actual, `requests[] missing topic '${expectedRequest.topic}'`).toBeDefined();
          if (expectedRequest.versionPresent === false) {
            expect(actual!.version, `${expectedRequest.topic}.version should be absent`).toBeUndefined();
          }
          if (expectedRequest.versionPresent === true) {
            expect(actual!.version).toBe(expectedRequest.version);
          }
          if (expectedRequest.reserved !== undefined) {
            expect(isReservedEntry(actual!)).toBe(expectedRequest.reserved);
          }
        }

        for (const expectedEvent of expected.events ?? []) {
          const actual = document.events.find((event) => event.topic === expectedEvent.topic);
          expect(actual, `events[] missing topic '${expectedEvent.topic}'`).toBeDefined();
          if (expectedEvent.versionPresent === false) {
            expect(actual!.version, `${expectedEvent.topic}.version should be absent`).toBeUndefined();
          }
          if (expectedEvent.versionPresent === true) {
            expect(actual!.version).toBe(expectedEvent.version);
          }
        }
      });
    }
  });

  describe('topicScopeCases', () => {
    for (const topicScopeCase of documentCasesFixture.topicScopeCases) {
      it(topicScopeCase.name, () => {
        const document = documentFor(topicScopeCase.documentRef);
        const scoped = applyTopicScope(document, topicScopeCase.options);
        assertSetEqual(
          scoped.requests.map((request) => request.topic),
          topicScopeCase.expectedTopics,
          'expectedTopics',
        );
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

  describe('contract-hash-cases', () => {
    for (const hashCase of hashCasesFixture.cases) {
      it(hashCase.name, () => {
        // Every fixture case is already the exact projection to hash (a whole-service document, or
        // one already topic-scoped per §5.3); `topicScoped` only changes whether a *surviving*
        // reserved entry is stripped entirely (§6.2) - none of these four cases has one that
        // survives, so `false` (the default) is correct for all of them.
        const actual = computeContractHash(hashCase.document);
        expect(actual, hashCase.name).toBe(hashCase.expectedHash);
      });
    }
  });
});
