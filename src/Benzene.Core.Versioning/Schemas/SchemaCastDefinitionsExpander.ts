/** Port of Benzene.Core.Versioning.Schemas.SchemaCastDefinitionsExpander. */
import { FuncCaster } from '../Casters/FuncCaster';
import { ISchemaCaster } from './ISchemaCaster';
import { PayloadSchemaVersions } from './PayloadSchemaVersions';
import { SchemaCaster } from './SchemaCaster';
import { SchemaCastDefinition } from './SchemaCastDefinition';

/**
 * Expands the individually-registered casters into the full set required by a topic's
 * {@link PayloadSchemaVersions}: reuses a direct caster when one exists, otherwise composes a
 * shortest-path chain (V1 -> V2 -> V3) via BFS.
 *
 * The reflection-based `Compose` of the C# version (which used `MakeGenericMethod` only to keep static
 * typing) collapses in TypeScript to chaining the casters' `cast` methods - types erase, so no runtime
 * generic machinery is needed.
 */
export class SchemaCastDefinitionsExpander {
  expand(
    schemaCastDefinitions: ISchemaCaster[],
    payloadSchemaVersions: PayloadSchemaVersions[],
  ): ISchemaCaster[] {
    const expanded: ISchemaCaster[] = [];
    for (const def of getRequiredCasters(payloadSchemaVersions)) {
      const existing = schemaCastDefinitions.find(
        (x) =>
          x.definition.fromSchema === def.fromSchema &&
          x.definition.toSchema === def.toSchema &&
          x.definition.topic === def.topic,
      );

      if (existing !== undefined) {
        expanded.push(existing);
        continue;
      }

      const chain = getChain(schemaCastDefinitions, def.fromSchema, def.toSchema, def.topic);
      if (chain.length > 1) {
        expanded.push(compose(chain));
      }
    }
    return expanded;
  }
}

function getRequiredCasters(payloadSchemaVersions: PayloadSchemaVersions[]): SchemaCastDefinition[] {
  const required: SchemaCastDefinition[] = [];
  for (const definition of payloadSchemaVersions) {
    for (const fromSchema of definition.fromSchemas) {
      for (const toSchema of definition.toSchemas) {
        if (fromSchema !== toSchema) {
          required.push(new SchemaCastDefinition(definition.topic, fromSchema, toSchema));
        }
      }
    }
  }
  return required;
}

/** BFS shortest path from `fromSchema` to `toSchema` over edges matching `topic`; throws if none exists. */
function getChain(
  schemaCastDefinitions: ISchemaCaster[],
  fromSchema: string,
  toSchema: string,
  topic: string,
): ISchemaCaster[] {
  if (fromSchema === toSchema) {
    return [];
  }

  const edges = schemaCastDefinitions.filter((e) => e.definition.topic === topic);

  const queue: string[] = [fromSchema];
  const visited = new Set<string>([fromSchema]);
  const prev = new Map<string, string>(); // childSchema -> parentSchema
  const via = new Map<string, ISchemaCaster>(); // childSchema -> edge used to reach it

  while (queue.length > 0) {
    const cur = queue.shift() as string;

    for (const edge of edges.filter((e) => e.definition.fromSchema === cur)) {
      const next = edge.definition.toSchema;
      if (visited.has(next)) {
        continue;
      }

      visited.add(next);
      prev.set(next, cur);
      via.set(next, edge);

      if (next === toSchema) {
        // Reconstruct the chain from toSchema back to fromSchema.
        const stack: ISchemaCaster[] = [];
        let walk = toSchema;
        while (walk !== fromSchema) {
          stack.push(via.get(walk) as ISchemaCaster);
          walk = prev.get(walk) as string;
        }
        return stack.reverse();
      }

      queue.push(next);
    }
  }

  throw new Error(`No conversion path found for topic='${topic}' from '${fromSchema}' to '${toSchema}'.`);
}

/** Folds a chain of edges into one composite caster. */
function compose(chain: ISchemaCaster[]): ISchemaCaster {
  if (chain.length === 0) {
    throw new Error('The chain must contain at least one ISchemaCaster.');
  }

  let current = chain[0]!;
  for (let i = 1; i < chain.length; i++) {
    current = composeTwo(current, chain[i]!);
  }
  return current;
}

function composeTwo(first: ISchemaCaster, second: ISchemaCaster): ISchemaCaster {
  return new SchemaCaster<unknown, unknown>(
    first.fromType,
    second.toType,
    new SchemaCastDefinition(first.definition.topic, first.definition.fromSchema, second.definition.toSchema),
    new FuncCaster<unknown, unknown>((from) => second.cast(first.cast(from))),
  );
}
