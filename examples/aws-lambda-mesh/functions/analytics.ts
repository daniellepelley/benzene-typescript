/**
 * Lambda entry point for the analytics-api Cloud Service — a pure event consumer (payment:captured / shipment:dispatched over EventBridge).
 *
 * A managed Node runtime needs no custom bootstrap (unlike .NET's provided.al2023): `buildMeshServiceLambda`
 * returns the bound handler directly. The service's behaviour is the shared, transport-agnostic definition
 * from `../src/services`; only the outbound wiring is production (real SDK clients + env-derived targets),
 * supplied by `productionOutbound`. Terraform points this function's `handler` at `analytics.handler`.
 */
import { buildMeshServiceLambda } from '../src/meshService';
import { serviceDefinition } from '../src/services';
import { productionOutbound } from './shared';

const definition = serviceDefinition('analytics-api');

export const handler = buildMeshServiceLambda(definition, productionOutbound(definition));
