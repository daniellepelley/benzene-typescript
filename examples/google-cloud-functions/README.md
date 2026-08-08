# `@benzene-example/google-cloud-functions`

> **Experimental / community-supported.** Google Cloud is out of scope for the Benzene 1.0 support
> commitment — it works but receives less testing and no API-stability guarantee than the AWS / Azure /
> self-hosted surfaces.

One platform-neutral `StartUp` hosting an order domain on **Google Cloud Functions Gen2 (HTTP)**, via
[`@benzene/google-cloud-functions-http`](../../src/Benzene.GoogleCloud.Functions.Http). Ported from the
.NET `Benzene.Examples.Google`.

The handlers in [`src/handlers.ts`](src/handlers.ts) are written once and know nothing about the Functions
Framework; each declares its HTTP route with `@httpEndpoint` alongside its Benzene `@message` topic:

| Route | Handler | Effect |
|---|---|---|
| `POST /orders` | `CreateOrderHandler` | create an order → `201` |
| `GET /orders` | `ListOrdersHandler` | list every order created |

[`src/startUp.ts`](src/startUp.ts) is the only file that touches request handling — it wires the handlers
onto HTTP with `useHttp(...)` and never references the Functions Framework. [`src/function.ts`](src/function.ts)
is the deploy entry: `GoogleCloudFunctionHost` turns that `StartUp` into a Functions Framework
`HttpFunction` you register with `http('benzene', ordersFunction)`.

## Deploy

```bash
gcloud functions deploy benzene-google-example \
  --gen2 --runtime=nodejs22 --trigger-http --allow-unauthenticated \
  --entry-point=benzene
```

(Register the entry point in your function module with `http('benzene', ordersFunction)`.)

## Verify it

`test/Benzene.Core.Test/Examples/GoogleCloudFunctionsExampleTest.test.ts` boots the real `StartUp` with
`buildGoogleCloudFunctionHost(benzeneTestHost(...))` and dispatches native Functions Framework requests
(`asGoogleCloudHttpRequest(httpBuilder(...))`) through the full pipeline with `host.sendHttpAsync(...)` —
no live Functions Framework server or credentials. It creates orders over `POST /orders` and reads them
back over `GET /orders`.
