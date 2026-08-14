/**
 * The Cloud Functions Gen2 deploy entry — hosts the exact same `GoogleCloudOrdersStartUp` the component
 * test runs. `GoogleCloudFunctionHost` builds the Functions Framework `HttpFunction`; register it as your
 * function's entry point. Port of the .NET example's `Function.cs`.
 *
 * ```ts
 * import { http } from '@google-cloud/functions-framework';
 * http('benzene', ordersFunction);
 * ```
 */
import { GoogleCloudFunctionHost } from '@benzenejs/google-cloud-functions-http';
import { GoogleCloudOrdersStartUp } from './startUp';

/** The Functions Framework `HttpFunction` for the order service. */
export const ordersFunction = new GoogleCloudFunctionHost(GoogleCloudOrdersStartUp).httpFunction;
