import { describe, expect, it } from 'vitest';
import {
  ISchemaCasters,
  registerPayloadSchemaVersions,
  registerSchemaCastDefinitions,
  SchemaCastDefinitionsExpander,
  SchemaCastersBuilder,
} from '@benzenejs/core-versioning';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/**
 * PROBE for the .NET R15 #226 stack-overflow shape: in C#, `CasterFuncBuilder.CreateCasterFunc`
 * memoized a compiled caster delegate only after `Expression...Compile()` returned, so building the
 * expression tree for a SELF-REFERENTIAL versioned DTO (`Node.Child : Node`) — or a mutually-
 * recursive A↔B pair — recursed into itself for the same `(TFrom,TTo)` pair before anything was
 * memoized, and the registration-time `Upcast<TFrom,TTo>()` call took the whole process down with an
 * uncatchable StackOverflowException.
 *
 * VERDICT — DOES NOT REPRODUCE in the TypeScript port, and this probe pins why: the reflection-based
 * auto-mapper/expression-tree caster builder (`CasterBuilder/CasterFuncBuilder`) was never ported.
 * Casts are explicit user-written functions (`SchemaCastersBuilder.add(..., castFn)`), so the library
 * never walks a DTO's property graph at registration; the only registration-time graph walk is
 * `SchemaCastDefinitionsExpander`'s BFS over the VERSION graph, which carries a `visited` set and
 * terminates on cycles. These tests exercise both shapes through the documented registration API so a
 * future auto-mapper port cannot re-introduce the overflow unnoticed.
 */

/** The self-referential shape from the .NET repro: a linked parent/child DTO. */
class NodeV1 {
  name: string | undefined;
  child: NodeV1 | undefined;
}

class NodeV2 {
  title: string | undefined;
  child: NodeV2 | undefined;
}

function upcastNode(from: NodeV1): NodeV2 {
  const to = new NodeV2();
  to.title = from.name;
  to.child = from.child === undefined ? undefined : upcastNode(from.child);
  return to;
}

function downcastNode(from: NodeV2): NodeV1 {
  const to = new NodeV1();
  to.name = from.title;
  to.child = from.child === undefined ? undefined : downcastNode(from.child);
  return to;
}

describe('RecursiveCasterProbeTest (.NET R15 #226 shape)', () => {
  it('SelfReferentialVersionedDto_RegistersAndCasts_WithoutOverflow', () => {
    // The .NET crash fired at REGISTRATION ("eagerly, at startup"). Here registration + eager
    // expansion is the resolve of the ISchemaCasters singleton.
    const container = new DefaultBenzeneServiceContainer();
    registerSchemaCastDefinitions(container, (builder: SchemaCastersBuilder) =>
      builder
        .add<NodeV1, NodeV2>(NodeV1, NodeV2, 'node', 'V1', 'V2', upcastNode)
        .add<NodeV2, NodeV1>(NodeV2, NodeV1, 'node', 'V2', 'V1', downcastNode),
    );
    registerPayloadSchemaVersions(container, [
      { topic: 'node', fromSchemas: ['V1', 'V2'], toSchemas: ['V1', 'V2'] },
    ]);

    const scope = container.createServiceResolverFactory().createScope();
    const casters = scope.getService(ISchemaCasters);

    // A three-deep linked list round-trips through the registered casters.
    const root = new NodeV1();
    root.name = 'a';
    root.child = new NodeV1();
    root.child.name = 'b';
    root.child.child = new NodeV1();
    root.child.child.name = 'c';

    const up = casters.getSchemaCaster('V1', 'V2', 'node').cast(root) as NodeV2;
    expect(up.title).toBe('a');
    expect(up.child?.child?.title).toBe('c');

    const down = casters.getSchemaCaster('V2', 'V1', 'node').cast(up) as NodeV1;
    expect(down.child?.child?.name).toBe('c');
    scope.dispose();
  });

  it('MutuallyRecursiveCyclicVersionGraph_ExpansionTerminates', () => {
    // The A↔B mutual-recursion shape, aimed at the one registration-time graph walk the port DOES
    // have: the expander's BFS over a cyclic version graph (V1→V2→V3→V1) asked for every pairing.
    const identity = (x: unknown): unknown => x;
    const builder = new SchemaCastersBuilder();
    builder
      .add(NodeV1, NodeV2, 'cyclic', 'V1', 'V2', identity)
      .add(NodeV2, NodeV1, 'cyclic', 'V2', 'V3', identity)
      .add(NodeV1, NodeV1, 'cyclic', 'V3', 'V1', identity);

    const expanded = new SchemaCastDefinitionsExpander().expand(builder.build(), [
      { topic: 'cyclic', fromSchemas: ['V1', 'V2', 'V3'], toSchemas: ['V1', 'V2', 'V3'] },
    ]);

    // All 6 ordered pairs resolve (3 direct, 3 composed around the cycle) — and the BFS terminated.
    expect(expanded).toHaveLength(6);
    const v2ToV1 = expanded.find(
      (c) => c.definition.fromSchema === 'V2' && c.definition.toSchema === 'V1',
    );
    expect(v2ToV1).toBeDefined();
  });
});
