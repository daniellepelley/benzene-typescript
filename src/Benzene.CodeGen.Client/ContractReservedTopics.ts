/**
 * Reserved-topic detection for the Contract Document (contract-document.md §5.1): a topic is reserved
 * when its `reserved` flag is `true`, OR its topic id starts with the `benzene:` prefix - both are
 * checked, because a document from an older producer build may carry a reserved topic with no flag at
 * all. The prefix half is `BenzeneTopic.isReserved`, this port's single source of truth for the
 * reserved-topic namespace (and the same rule `@benzenejs/schema-openapi`'s `ReservedTopics` applies
 * when it stamps the `reserved` flag on a derived document).
 */
import { BenzeneTopic } from '@benzenejs/abstractions';
import { ContractRequestResponse } from './ContractDocument';

/** Whether `topic` is reserved purely by the `benzene:` prefix rule (contract-document.md §5.1, part 2). */
export function isReservedTopic(topic: string | undefined): boolean {
  return BenzeneTopic.isReserved(topic);
}

/** contract-document.md §5.1's full rule: `reserved === true` OR the `benzene:` prefix. */
export function isReservedEntry(request: Pick<ContractRequestResponse, 'topic' | 'reserved'>): boolean {
  return request.reserved === true || isReservedTopic(request.topic);
}
