/** Port of Benzene.Http.BenzeneMessage.IBenzeneMessageHttpEndpointInfo (and BenzeneMessageHttpEndpointInfo). */
import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Describes the BenzeneMessage-over-HTTP endpoint a service exposes. Registered in DI by
 * {@link useBenzeneMessage} so other components — notably the `benzene` spec builder, which advertises
 * the endpoint as the top-level `messageEndpoint` field — can discover it.
 *
 * Resolved from the container, so it carries a merged `ServiceToken` constant (the porting convention
 * for interfaces resolved via DI).
 */
export interface IBenzeneMessageHttpEndpointInfo {
  /** The path the endpoint listens on (for example `/benzene-message`). */
  readonly path: string;
}

export const IBenzeneMessageHttpEndpointInfo: ServiceToken<IBenzeneMessageHttpEndpointInfo> =
  serviceToken<IBenzeneMessageHttpEndpointInfo>('IBenzeneMessageHttpEndpointInfo');

/** Default {@link IBenzeneMessageHttpEndpointInfo} implementation. */
export class BenzeneMessageHttpEndpointInfo implements IBenzeneMessageHttpEndpointInfo {
  constructor(readonly path: string) {}
}
