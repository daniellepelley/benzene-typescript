/**
 * `@benzene-example/payments-client` - dogfoods `@benzenejs/codegen-client`'s Contract Document input
 * path (contract-document.md) against a real, committed `.spec.json` build artifact from another
 * language's port (`benzene-dotnet`'s `examples/AwsMesh/Orders/contracts/payments.spec.json`), proving
 * a Node consumer gets a typed client for a .NET service with no .NET SDK involved. See `README.md`.
 */
export * from './generated/PaymentsCapture/PaymentsCaptureServiceClient';
export * from './generated/PaymentsClientsRegistration';
