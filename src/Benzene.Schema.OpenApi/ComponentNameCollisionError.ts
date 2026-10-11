/** One side of a component-name collision: the type that claimed the name and the topics that use it. */
export interface ComponentNameClaimant {
  readonly type: string;
  readonly usages: readonly string[];
}

/**
 * Thrown when two payload schemas that differ claim one component name (contract-document.md §4.1 rule 4).
 * Derivation fails rather than suffixing a name or letting the first registration win: the service's spec
 * start-up check raises it before any message is handled. The message names both types, the topics that
 * use them, and the remedy — declare a schema name for one of them.
 */
export class ComponentNameCollisionError extends Error {
  constructor(
    readonly componentName: string,
    readonly first: ComponentNameClaimant,
    readonly second: ComponentNameClaimant,
  ) {
    super(
      `Component name '${componentName}' is claimed by two different schemas: ${describe(first)} and ` +
        `${describe(second)}. Declare a distinct schema name for one of them - ` +
        "MapTypeJsonSchemaSource.register(type, schema, { name }), Zod .meta({ id }), Joi .id(), or Yup " +
        '.meta({ id }) (contract-document.md §4.1).',
    );
    this.name = 'ComponentNameCollisionError';
  }
}

function describe(claimant: ComponentNameClaimant): string {
  const used = claimant.usages.length === 0 ? '' : ` (used by ${claimant.usages.join(', ')})`;
  return `type ${claimant.type}${used}`;
}
