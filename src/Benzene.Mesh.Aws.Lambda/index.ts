/**
 * Port of Benzene.Mesh.Aws.Lambda - the AWS-Lambda-Invoke mesh integration. `LambdaMeshServiceSource`
 * interrogates a Lambda-hosted service's spec/health via a synchronous `RequestResponse` invoke (for
 * services with no HTTP surface), and `AwsLambdaMeshServiceDispatcher` dispatches `mesh:dispatch` messages
 * to one, both reusing `@benzenejs/clients-aws-lambda`'s `IAwsLambdaClient` and propagating the active W3C
 * trace context. Wired via `addMeshLambdaSource`/`addMeshLambdaDispatcher`.
 */
export * from './LambdaMeshServiceSource';
export * from './AwsLambdaMeshServiceDispatcher';
export * from './Extensions';
