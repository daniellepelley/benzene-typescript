/**
 * Lambda entry point for the shipping-api Cloud Service — consumes shipping:book (SQS); sends shipment:dispatched (EventBridge).
 *
 * A managed Node runtime needs no custom bootstrap (unlike .NET's provided.al2023): `buildMeshServiceLambda`
 * returns the bound handler directly. The service's behaviour is the shared, transport-agnostic definition
 * from `../src/services`; only the outbound wiring is production (real SDK clients + env-derived targets),
 * supplied by `productionOutbound`. Terraform points this function's `handler` at `shipping.handler`.
 */
import { buildMeshServiceLambda } from '../src/meshService';
import { serviceDefinition } from '../src/services';
import { productionOutbound } from './shared';

const definition = serviceDefinition('shipping-api');

export const handler = buildMeshServiceLambda(definition, productionOutbound(definition));
