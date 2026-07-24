/** Port of Benzene.Mesh.Aggregator.AsyncApiCompositor. */

/**
 * Merges each service's own AsyncAPI 3.0 document (fetched from its `spec` endpoint with `type=asyncapi`)
 * into one fleet-wide AsyncAPI 3.0 document loadable in an AsyncAPI editor.
 *
 * Purely JSON-level (C#'s `System.Text.Json.Nodes` mutable DOM -> native `JSON.parse`/`JSON.stringify`,
 * keeping this package dependency-light). AsyncAPI 3.0 keys `channels` and top-level `operations` by
 * identifier and component schemas by bare type name - all collide across services - so each service's
 * content is *namespaced*: channel keys become `<service>_<channel>`, operation keys `<service>_<operation>`,
 * schema keys `<Service>_<Type>`, and every `$ref` (into `components.schemas`, into `#/channels/...`, and
 * into a channel's `.../messages/...`) is rewritten to match before union, so nothing overwrites. Reserved
 * (utility) topics - and the operations referencing them - are dropped, each operation is tagged with the
 * owning service, and component schemas left unreferenced after the merge are pruned.
 */

type JsonObject = Record<string, unknown>;

/** One service's fetched AsyncAPI doc plus what the merge needs to namespace/filter it. */
export interface ServiceDocument {
  /** The service name - the namespace discriminator (channels/operations/schemas/tags). */
  readonly serviceName: string;
  /** The service's raw AsyncAPI 3.0 JSON. */
  readonly asyncApiJson: string;
  /** The service's reserved (utility) topic ids, whose channels/operations are skipped. */
  readonly reservedTopics: ReadonlySet<string>;
}

const SchemaRefPrefix = '#/components/schemas/';
const ChannelRefPrefix = '#/channels/';

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export const AsyncApiCompositor = {
  /**
   * Merges the given services' AsyncAPI 3.0 docs into one composite AsyncAPI 3.0 JSON document. A service
   * whose doc is missing/unparseable is skipped (best-effort); an empty input still produces a valid empty
   * document, so a published `asyncapi.json` is always loadable. `generatedAt` is epoch ms.
   */
  merge(services: readonly ServiceDocument[], generatedAt: number): string {
    const channels: JsonObject = {};
    const operations: JsonObject = {};
    const schemas: JsonObject = {};
    const tags: unknown[] = [];
    const usedOperationKeys = new Set<string>();
    let merged = 0;

    for (const service of services) {
      const doc = tryParse(service.asyncApiJson);
      if (doc === undefined) {
        continue;
      }

      merged++;
      tags.push({ name: service.serviceName });
      const ns = slug(service.serviceName);

      // 1) Namespace + move component schemas (rewriting every schema $ref across the doc first, so
      //    channel-message payload refs and nested inter-schema refs all point at the new keys).
      const schemaRenames = new Map<string, string>();
      if (isObject(doc.components) && isObject(doc.components.schemas)) {
        for (const key of Object.keys(doc.components.schemas)) {
          schemaRenames.set(key, schemaKey(service.serviceName, key));
        }
      }

      rewriteSchemaRefs(doc, schemaRenames);

      if (isObject(doc.components) && isObject(doc.components.schemas)) {
        const serviceSchemas = doc.components.schemas;
        for (const [key, value] of Object.entries(serviceSchemas)) {
          schemas[schemaRenames.get(key)!] = structuredClone(value);
        }
      }

      // 2) Map ALL channel keys old->new (namespaced), capturing each channel's address and a clone.
      //    Channels are emitted below only if a surviving (non-reserved) operation references them - so
      //    reserved request channels AND their reply channels fall away regardless of the reply-suffix a
      //    service happens to use.
      const channelKeyMap = new Map<string, string>();
      const channelAddress = new Map<string, string>();
      const clonedChannels = new Map<string, JsonObject>();
      if (isObject(doc.channels)) {
        for (const [key, value] of Object.entries(doc.channels)) {
          if (!isObject(value)) {
            continue;
          }
          const newKey = `${ns}_${key}`;
          channelKeyMap.set(key, newKey);
          channelAddress.set(key, typeof value.address === 'string' ? value.address : key);
          clonedChannels.set(newKey, structuredClone(value));
        }
      }

      // 3) Namespace operations, dropping any whose channel is a reserved (utility) topic, and rewriting
      //    their channel/message/reply $refs onto the namespaced channel keys. An operation's primary
      //    channel address IS the topic id, so reserved detection needs no suffix knowledge.
      const referencedChannelKeys = new Set<string>();
      if (isObject(doc.operations)) {
        for (const [key, value] of Object.entries(doc.operations)) {
          if (!isObject(value)) {
            continue;
          }
          const operationObj = structuredClone(value);

          const primaryKey = channelKeyOf(operationObj.channel);
          if (
            primaryKey === undefined ||
            !channelKeyMap.has(primaryKey) ||
            service.reservedTopics.has(channelAddress.get(primaryKey)!)
          ) {
            continue; // no resolvable channel, or a reserved/utility operation - drop it
          }

          rewriteChannelRef(operationObj.channel, channelKeyMap);
          rewriteMessageRefs(operationObj.messages, channelKeyMap);
          referencedChannelKeys.add(channelKeyMap.get(primaryKey)!);

          if (isObject(operationObj.reply)) {
            const reply = operationObj.reply;
            const replyKey = channelKeyOf(reply.channel);
            if (replyKey !== undefined && channelKeyMap.has(replyKey)) {
              rewriteChannelRef(reply.channel, channelKeyMap);
              rewriteMessageRefs(reply.messages, channelKeyMap);
              referencedChannelKeys.add(channelKeyMap.get(replyKey)!);
            } else {
              delete operationObj.reply;
            }
          }

          tagOperation(operationObj, service.serviceName);
          operations[uniqueKey(`${ns}_${key}`, usedOperationKeys)] = operationObj;
        }
      }

      // 4) Emit only the channels a surviving operation references.
      for (const referenced of referencedChannelKeys) {
        const channelObj = clonedChannels.get(referenced);
        if (channelObj !== undefined) {
          channels[referenced] = channelObj;
        }
      }
    }

    // Reserved-channel drops can orphan the schemas only those channels' messages referenced; drop any
    // component schema not reachable from a retained channel (validators flag unused components).
    pruneUnusedSchemas(channels, schemas);

    const document: JsonObject = {
      asyncapi: '3.0.0',
      id: 'urn:benzene:mesh:composite',
      defaultContentType: 'application/json',
      info: {
        title: 'Benzene Mesh — Composite AsyncAPI',
        version: new Date(generatedAt).toISOString(),
        description: `Composite of ${merged} service(s)' AsyncAPI specs across the mesh, generated by Benzene Mesh.`,
        tags,
      },
      channels,
      operations,
      components: { schemas },
    };

    return JSON.stringify(document, null, 2);
  },
};

function tryParse(json: string): JsonObject | undefined {
  if (json.trim().length === 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(json);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function channelKeyOf(channelRefNode: unknown): string | undefined {
  if (isObject(channelRefNode) && typeof channelRefNode.$ref === 'string' && channelRefNode.$ref.startsWith(ChannelRefPrefix)) {
    const rest = channelRefNode.$ref.substring(ChannelRefPrefix.length);
    const slash = rest.indexOf('/');
    return slash < 0 ? rest : rest.substring(0, slash);
  }

  return undefined;
}

function rewriteChannelRef(channelRefNode: unknown, channelKeyMap: Map<string, string>): void {
  if (isObject(channelRefNode) && typeof channelRefNode.$ref === 'string') {
    channelRefNode.$ref = rewritePointer(channelRefNode.$ref, channelKeyMap);
  }
}

function rewriteMessageRefs(messagesNode: unknown, channelKeyMap: Map<string, string>): void {
  if (!isArray(messagesNode)) {
    return;
  }

  for (const message of messagesNode) {
    if (isObject(message) && typeof message.$ref === 'string') {
      message.$ref = rewritePointer(message.$ref, channelKeyMap);
    }
  }
}

/** Rewrites the channel-id segment of a `#/channels/<key>[/messages/<msg>]` pointer via the map. */
function rewritePointer(reference: string, channelKeyMap: Map<string, string>): string {
  if (!reference.startsWith(ChannelRefPrefix)) {
    return reference;
  }

  const rest = reference.substring(ChannelRefPrefix.length);
  const slash = rest.indexOf('/');
  const oldKey = slash < 0 ? rest : rest.substring(0, slash);
  const tail = slash < 0 ? '' : rest.substring(slash);
  const newKey = channelKeyMap.get(oldKey);
  return newKey !== undefined ? ChannelRefPrefix + newKey + tail : reference;
}

function tagOperation(operation: JsonObject, serviceName: string): void {
  let tags = operation.tags;
  if (!isArray(tags)) {
    tags = [];
    operation.tags = tags;
  }

  (tags as unknown[]).push({ name: serviceName });
}

function uniqueKey(candidate: string, used: Set<string>): string {
  let unique = candidate;
  let suffix = 2;
  while (used.has(unique)) {
    unique = `${candidate}_${suffix++}`;
  }

  used.add(unique);
  return unique;
}

/** Removes component schemas not reachable from any retained channel (following $refs transitively). */
function pruneUnusedSchemas(channels: JsonObject, schemas: JsonObject): void {
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const name of findSchemaRefNames(channels)) {
    if (!reachable.has(name)) {
      reachable.add(name);
      queue.push(name);
    }
  }

  while (queue.length > 0) {
    const name = queue.shift()!;
    const schema = schemas[name];
    if (schema === undefined) {
      continue;
    }

    for (const nested of findSchemaRefNames(schema)) {
      if (!reachable.has(nested)) {
        reachable.add(nested);
        queue.push(nested);
      }
    }
  }

  for (const key of Object.keys(schemas)) {
    if (!reachable.has(key)) {
      delete schemas[key];
    }
  }
}

function findSchemaRefNames(node: unknown): string[] {
  const results: string[] = [];
  walk(node, results);
  return results;

  function walk(n: unknown, into: string[]): void {
    if (isObject(n)) {
      if (typeof n.$ref === 'string' && n.$ref.startsWith(SchemaRefPrefix)) {
        into.push(n.$ref.substring(SchemaRefPrefix.length));
      }

      for (const [key, value] of Object.entries(n)) {
        if (key !== '$ref') {
          walk(value, into);
        }
      }
    } else if (isArray(n)) {
      for (const item of n) {
        walk(item, into);
      }
    }
  }
}

function rewriteSchemaRefs(node: unknown, renames: Map<string, string>): void {
  if (isObject(node)) {
    if (typeof node.$ref === 'string' && node.$ref.startsWith(SchemaRefPrefix)) {
      const name = node.$ref.substring(SchemaRefPrefix.length);
      const renamed = renames.get(name);
      if (renamed !== undefined) {
        node.$ref = SchemaRefPrefix + renamed;
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key !== '$ref') {
        rewriteSchemaRefs(value, renames);
      }
    }
  } else if (isArray(node)) {
    for (const item of node) {
      rewriteSchemaRefs(item, renames);
    }
  }
}

function schemaKey(serviceName: string, typeName: string): string {
  const prefix = slug(serviceName)
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.substring(1))
    .join('');
  return prefix.length === 0 ? typeName : prefix + '_' + typeName;
}

function slug(value: string): string {
  let lowered = Array.from((value ?? '').trim().toLowerCase())
    .map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : '-'))
    .join('');
  while (lowered.includes('--')) {
    lowered = lowered.replace(/--/g, '-');
  }

  lowered = lowered.replace(/^-+/, '').replace(/-+$/, '');
  return lowered.length === 0 ? 'service' : lowered;
}
