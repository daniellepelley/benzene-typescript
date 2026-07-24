/** Port of Benzene.Mesh.Contracts.MeshAnnotationRequest. */

/**
 * The `mesh:annotations:add` payload: attach one note to one entity. Plain settable properties
 * (wire-deserialized input) - validation and bounds are the handler's job, not the shape's.
 * C# `{ get; set; }` auto-properties -> mutable fields; `string?` -> `string | undefined`.
 */
export class MeshAnnotationRequest {
  /** The entity to annotate - `"service:<name>"` or `"topic:<topicId>"`. */
  entity: string | undefined;

  /** The author's self-declared display name. */
  author: string | undefined;

  /** The note, plain text. */
  text: string | undefined;
}
