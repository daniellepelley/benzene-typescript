/** Port of Benzene.Mesh.Contracts.MeshServiceSource. */

/**
 * Known values for `MeshServiceRegistryEntry.source` - which mesh service source a registry entry should
 * be fetched with. C# `static class` of `const string`s -> a frozen object; the string VALUES are the
 * wire names.
 */
export const MeshServiceSource = {
  /** Fetch over HTTP, using the entry's `specUrl`/`healthUrl` - the default. */
  http: 'Http',

  /** Fetch via a synchronous AWS Lambda `Invoke`, for services with no public HTTP surface. */
  awsLambdaInvoke: 'AwsLambdaInvoke',
} as const;
