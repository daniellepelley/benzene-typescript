/**
 * Port of Benzene.Mesh.Dispatch - the opt-in, environment-gated `benzene:mesh:dispatch` handler that invokes ONE
 * registered service's real handler with a caller-supplied payload (the direct-to-consumer test path).
 * Refused in Production unless `MeshDispatchOptions.allowInProduction` is set. Ships the HTTP dispatcher
 * (over an injectable `fetch`); other transports register their own `IMeshServiceDispatcher`.
 */
export * from './MeshDispatchOptions';
export * from './MeshDispatchRequest';
export * from './MeshDispatchEnvelope';
export * from './IMeshDispatchEnvironment';
export * from './IMeshServiceDispatcher';
export * from './MeshDispatchGate';
export * from './HttpMeshServiceDispatcher';
export * from './MeshDispatchMessageHandler';
export * from './Extensions';
