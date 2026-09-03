import { describe, expect, it } from 'vitest';
import {
  getVersionedTopic,
  IMessageTopicGetter,
  IMessageVersionGetter,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter, ITopic } from '@benzenejs/abstractions-messages';
import { MessageGetter } from '@benzenejs/core-message-handlers';
import { Topic } from '@benzenejs/core-messages';

/**
 * Port of test/Benzene.Core.Test/Core/Core/MessageHandling/MessageGetterVersionJoinTest.cs (.NET task
 * #98): the `MessageGetter` facade combines the topic getter's answer with the optionally-injected
 * `IMessageVersionGetter` itself — via the shared `getVersionedTopic` free function — so EVERY
 * consumer of `IMessageGetter.getTopic` (diagnostics, schema validation, mesh tracing), not just the
 * router, sees a version-resolved topic.
 *
 * PORTING NOTE: the C# suite additionally covers a scoped `ResolvedTopicCache` (topic joined once per
 * message); the port has no such cache, so those cases collapse into the join-on-every-call ones —
 * see `MessageGetter`'s doc comment.
 */

class TestContext {}

class CountingTopicGetter implements IMessageTopicGetter<TestContext> {
  calls = 0;

  constructor(private readonly topic: ITopic | undefined) {}

  getTopic(_context: TestContext): ITopic | undefined {
    this.calls++;
    return this.topic;
  }
}

class CountingVersionGetter implements IMessageVersionGetter<TestContext> {
  calls = 0;

  constructor(private readonly version: string | undefined) {}

  getVersion(_context: TestContext): string | undefined {
    this.calls++;
    return this.version;
  }
}

const stubBodyGetter: IMessageBodyGetter<TestContext> = { getBody: () => undefined };
const stubHeadersGetter: IMessageHeadersGetter<TestContext> = { getHeaders: () => ({}) };

function getter(
  topicGetter: CountingTopicGetter,
  versionGetter: CountingVersionGetter | undefined,
): MessageGetter<TestContext> {
  return new MessageGetter(topicGetter, stubBodyGetter, stubHeadersGetter, versionGetter);
}

describe('MessageGetterVersionJoinTest', () => {
  it('GetTopic_VersionGetterRegistered_JoinsTheVersionIntoTheTopic', () => {
    const topicGetter = new CountingTopicGetter(new Topic('order:create'));
    const versionGetter = new CountingVersionGetter('v3');

    const topic = getter(topicGetter, versionGetter).getTopic(new TestContext());

    expect(topic?.id).toBe('order:create');
    expect(topic?.version).toBe('v3');
  });

  it('GetTopic_NoVersionGetterRegistered_ReturnsTheVersionlessTopic_DoesNotThrow', () => {
    const topicGetter = new CountingTopicGetter(new Topic('order:create'));

    const topic = getter(topicGetter, undefined).getTopic(new TestContext());

    expect(topic?.id).toBe('order:create');
    expect(topic?.version).toBe('');
  });

  it('GetTopic_TopicGetterAlreadySuppliedAVersion_PresetWinsOverVersionGetter', () => {
    // An explicit preset (e.g. a preset topic with a version) is a deliberate override; the
    // message's own version signal must not replace it.
    const topicGetter = new CountingTopicGetter(new Topic('order:create', 'preset-version'));
    const versionGetter = new CountingVersionGetter('v3');

    const topic = getter(topicGetter, versionGetter).getTopic(new TestContext());

    expect(topic?.version).toBe('preset-version');
    expect(versionGetter.calls).toBe(0);
  });

  it('GetTopic_TopicIdMissing_NeverConsultsTheVersionGetter', () => {
    const topicGetter = new CountingTopicGetter(undefined);
    const versionGetter = new CountingVersionGetter('v3');

    const topic = getter(topicGetter, versionGetter).getTopic(new TestContext());

    expect(topic).toBeUndefined();
    expect(versionGetter.calls).toBe(0);
  });

  it('GetTopic_JoinsTheVersion_OnEveryCall', () => {
    // The port has no ResolvedTopicCache (see the porting note above): the .NET no-cache path — the
    // join happens on each call, and always produces the joined answer.
    const topicGetter = new CountingTopicGetter(new Topic('order:create'));
    const versionGetter = new CountingVersionGetter('v3');
    const g = getter(topicGetter, versionGetter);

    g.getTopic(new TestContext());
    const topic = g.getTopic(new TestContext());

    expect(topic?.version).toBe('v3');
    expect(topicGetter.calls).toBe(2);
    expect(versionGetter.calls).toBe(2);
  });

  it('getVersionedTopic_EmptyVersionSignal_ReturnsTheTopicUnaugmented', () => {
    // The free function itself: an empty/undefined version signal means "the topic's default
    // version" — the topic getter's answer passes through untouched.
    const topicGetter = new CountingTopicGetter(new Topic('order:create'));

    const topic = getVersionedTopic(topicGetter, new TestContext(), new CountingVersionGetter(undefined));

    expect(topic?.id).toBe('order:create');
    expect(topic?.version).toBe('');
  });
});
