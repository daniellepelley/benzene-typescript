/**
 * The reserved-style topic the dispatch handler is served on. Its own module (rather than living
 * only in `Extensions.ts`, where C# keeps it on the Extensions class) so `MeshDispatchGuardOptions`
 * can reference it without a circular import; `Extensions.ts` re-exports it, keeping the public
 * surface identical.
 */
export const DispatchTopic = 'benzene:mesh:dispatch';
