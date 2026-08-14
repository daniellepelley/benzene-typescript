/**
 * Reserved-topic detection for the Contract Document (contract-document.md §5.1): a topic is reserved
 * when its `reserved` flag is `true`, OR its topic id starts with the `benzene:` prefix - both are
 * checked, because a document from an older producer build may carry a reserved topic with no flag at
 * all. This matches the .NET `Benzene.Abstractions.BenzeneTopic.IsReserved` convention the spec is
 * pinned against.
 *
 * Deliberately separate from `@benzenejs/schema-openapi`'s `ReservedTopics`: that module matches a
 * name-list of short, *unprefixed* topic ids (`"spec"`, `"healthcheck"`, ...) - the TS mesh spec
 * surface's own convention, distinct from and predating the `benzene:`-prefix rename this spec section
 * is pinned to. Reusing it here would misclassify every reserved entry the Contract Document
 * conformance fixtures actually use (`benzene:spec`, `benzene:healthcheck`, ...). See the README
 * Porting-conventions table.
 */
import { ContractRequestResponse } from './ContractDocument';

/** Whether `topic` is reserved purely by the `benzene:` prefix rule (contract-document.md §5.1, part 2). */
export function isReservedTopic(topic: string | undefined): boolean {
  return topic !== undefined && topic.startsWith('benzene:');
}

/** contract-document.md §5.1's full rule: `reserved === true` OR the `benzene:` prefix. */
export function isReservedEntry(request: Pick<ContractRequestResponse, 'topic' | 'reserved'>): boolean {
  return request.reserved === true || isReservedTopic(request.topic);
}
