import {
  Client,
  credentials,
  Metadata,
  Server,
  ServerCredentials,
  ServiceDefinition,
  status,
} from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BenzeneError, IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { MessageHandlersRegistry, message, useMessageHandlers } from '@benzenejs/core-message-handlers';
import {
  BAD_REQUEST_TYPE_URL,
  decodeFieldViolations,
  encodeRichStatus,
  grpcMethod,
  GRPC_STATUS_DETAILS_TRAILER,
  useGrpc,
} from '@benzenejs/grpc';
import { GrpcBenzeneMessageClient, GrpcClientRouteRegistry } from '@benzenejs/grpc-client';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';

/**
 * wire-contracts.md §4.2's rich error details, over a REAL in-process gRPC server and client.
 *
 * "There is no JSON problem document over gRPC; the problem's information (§1.3) maps onto gRPC's own
 * error model instead - the `benzene-status` trailer already carries `benzeneStatus`, and structured
 * `errors` map onto `google.rpc.BadRequest` in the `grpc-status-details-bin` trailer, one
 * `FieldViolation` per error."
 *
 * The point of driving a real `@grpc/grpc-js` `Server` + `Client` over a loopback socket - rather than
 * calling the encoder and decoder against each other - is that the bytes make a genuine round trip:
 * grpc-js base64s the `-bin` trailer onto the wire and parses it back, so a trailer this port writes but
 * gRPC would reject or mangle fails here rather than passing a unit test.
 */

const PLACE_ORDER = '/benzene.test.OrderService/PlaceOrder';
const REJECT_ORDER = '/benzene.test.OrderService/RejectOrder';
const BREAK_ORDER = '/benzene.test.OrderService/BreakOrder';

const PLACE_TOPIC = 'grpc-rich-place-order';
const REJECT_TOPIC = 'grpc-rich-reject-order';
const BREAK_TOPIC = 'grpc-rich-break-order';

class PlaceOrder {
  customerId = '';
}
class OrderPlaced {
  id = '';
}

const registry = new MessageHandlersRegistry();

/** Fails with two field-scoped validation errors - the §1.3 `errors` shape the adapters produce. */
@grpcMethod(PLACE_ORDER)
@message(PLACE_TOPIC, { registry, requestType: PlaceOrder, responseType: OrderPlaced })
class PlaceOrderMessageHandler implements IMessageHandler<PlaceOrder, OrderPlaced> {
  handleAsync(): Promise<IBenzeneResultOf<OrderPlaced>> {
    return Promise.resolve(
      BenzeneResult.validationError<OrderPlaced>(
        { message: 'customerId must not be empty', field: '/customerId', code: 'required' },
        { message: 'lines must contain at least one item', field: '/lines', code: 'minItems' },
      ),
    );
  }
}

/**
 * Fails with a NON-validation status that still carries errors. The spec sentence is unconditional, so
 * this must carry field violations too (.NET restricts its own attachment to `validation-error`; that
 * divergence is being raised separately).
 */
@grpcMethod(REJECT_ORDER)
@message(REJECT_TOPIC, { registry, requestType: PlaceOrder, responseType: OrderPlaced })
class RejectOrderMessageHandler implements IMessageHandler<PlaceOrder, OrderPlaced> {
  handleAsync(): Promise<IBenzeneResultOf<OrderPlaced>> {
    return Promise.resolve(
      BenzeneResult.setErrors<OrderPlaced>(BenzeneResultStatus.conflict, {
        message: 'that order already exists',
        field: '/id',
      }),
    );
  }
}

/** Fails with no structured errors at all - the message-only fallback path. */
@grpcMethod(BREAK_ORDER)
@message(BREAK_TOPIC, { registry, requestType: PlaceOrder, responseType: OrderPlaced })
class BreakOrderMessageHandler implements IMessageHandler<PlaceOrder, OrderPlaced> {
  handleAsync(): Promise<IBenzeneResultOf<OrderPlaced>> {
    return Promise.resolve(BenzeneResult.notFound<OrderPlaced>());
  }
}

/**
 * A hand-built grpc-js `ServiceDefinition` with the same JSON codec `jsonGrpcMarshaller` uses, so no
 * `.proto` or generated stub is needed - the payloads here are POCOs, exactly as `JsonGrpcMessageAdapter`
 * expects.
 */
const jsonCodec = {
  serialize: (value: unknown): Buffer => Buffer.from(JSON.stringify(value ?? null), 'utf8'),
  deserialize: (bytes: Buffer): unknown => JSON.parse(bytes.toString('utf8')) as unknown,
};

function unaryMethod(path: string): ServiceDefinition[string] {
  return {
    path,
    requestStream: false,
    responseStream: false,
    requestSerialize: jsonCodec.serialize,
    requestDeserialize: jsonCodec.deserialize,
    responseSerialize: jsonCodec.serialize,
    responseDeserialize: jsonCodec.deserialize,
  } as ServiceDefinition[string];
}

const orderService: ServiceDefinition = {
  placeOrder: unaryMethod(PLACE_ORDER),
  rejectOrder: unaryMethod(REJECT_ORDER),
  breakOrder: unaryMethod(BREAK_ORDER),
};

describe('gRPC rich error details (wire-contracts.md §4.2)', () => {
  let server: Server;
  let rawClient: Client;
  let benzeneClient: GrpcBenzeneMessageClient;

  beforeAll(async () => {
    const bridge = useGrpc((pipeline) =>
      useMessageHandlers(
        pipeline,
        PlaceOrderMessageHandler,
        RejectOrderMessageHandler,
        BreakOrderMessageHandler,
      ),
    );

    server = new Server();
    server.addService(orderService, {
      placeOrder: bridge.toUnaryHandler(PLACE_ORDER),
      rejectOrder: bridge.toUnaryHandler(REJECT_ORDER),
      breakOrder: bridge.toUnaryHandler(BREAK_ORDER),
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) =>
        error ? reject(error) : resolve(bound),
      );
    });

    rawClient = new Client(`127.0.0.1:${port}`, credentials.createInsecure());
    benzeneClient = new GrpcBenzeneMessageClient(
      rawClient,
      new GrpcClientRouteRegistry()
        .add(PLACE_TOPIC, PLACE_ORDER)
        .add(REJECT_TOPIC, REJECT_ORDER)
        .add(BREAK_TOPIC, BREAK_ORDER),
    );
  });

  afterAll(async () => {
    rawClient.close();
    await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  });

  /** Makes a raw unary call, returning the trailing metadata gRPC actually delivered. */
  function callRaw(path: string): Promise<{ code: status; details: string; trailers?: Metadata }> {
    return new Promise((resolve) => {
      rawClient.makeUnaryRequest(
        path,
        jsonCodec.serialize,
        jsonCodec.deserialize,
        { customerId: '' },
        new Metadata(),
        {},
        (error) => {
          if (error) {
            resolve({ code: error.code, details: error.details, trailers: error.metadata });
          } else {
            resolve({ code: status.OK, details: '' });
          }
        },
      );
    });
  }

  it('a validation failure crosses the wire as one BadRequest FieldViolation per error', async () => {
    const outcome = await callRaw(PLACE_ORDER);

    expect(outcome.code).toBe(status.INVALID_ARGUMENT);
    expect(outcome.trailers?.get('benzene-status')).toEqual([BenzeneResultStatus.validationError]);

    const detailsTrailer = outcome.trailers?.get(GRPC_STATUS_DETAILS_TRAILER)[0];
    expect(Buffer.isBuffer(detailsTrailer)).toBe(true);

    expect(decodeFieldViolations(detailsTrailer as Buffer)).toEqual([
      { message: 'customerId must not be empty', field: '/customerId' },
      { message: 'lines must contain at least one item', field: '/lines' },
    ]);
  });

  it('the client recovers the structured errors, field and all', async () => {
    const result = await benzeneClient.sendMessageAsync<PlaceOrder, OrderPlaced>({
      topic: PLACE_TOPIC,
      message: { customerId: '' },
      headers: {},
    });

    expect(result.status).toBe(BenzeneResultStatus.validationError);
    expect(result.isSuccessful).toBe(false);
    expect(result.errors).toEqual([
      { message: 'customerId must not be empty', field: '/customerId' },
      { message: 'lines must contain at least one item', field: '/lines' },
    ]);
  });

  it('attaches the violations for any errored result, not only validation-error', async () => {
    const result = await benzeneClient.sendMessageAsync<PlaceOrder, OrderPlaced>({
      topic: REJECT_TOPIC,
      message: { customerId: '' },
      headers: {},
    });

    expect(result.status).toBe(BenzeneResultStatus.conflict);
    expect(result.errors).toEqual([{ message: 'that order already exists', field: '/id' }]);
  });

  it('falls back to the flat status detail when the result carries no errors', async () => {
    const outcome = await callRaw(BREAK_ORDER);
    // The Status is still attached (one place for a client to look), but with no BadRequest detail.
    expect(decodeFieldViolations(outcome.trailers?.get(GRPC_STATUS_DETAILS_TRAILER)[0] as Buffer)).toEqual([]);

    const result = await benzeneClient.sendMessageAsync<PlaceOrder, OrderPlaced>({
      topic: BREAK_TOPIC,
      message: { customerId: '' },
      headers: {},
    });

    expect(result.status).toBe(BenzeneResultStatus.notFound);
    expect(result.errors).toEqual([{ message: BenzeneResultStatus.notFound }]);
  });
});

describe('the google.rpc codec', () => {
  it('round-trips message and field, and leaves an unscoped error without a field', () => {
    const errors: BenzeneError[] = [
      { message: 'scoped', field: '/a', code: 'ignored-on-purpose' },
      { message: 'unscoped' },
    ];

    expect(decodeFieldViolations(encodeRichStatus(3, 'scoped; unscoped', errors))).toEqual([
      { message: 'scoped', field: '/a' },
      { message: 'unscoped' },
    ]);
  });

  it('carries `code` nowhere - the spec does not say where it goes', () => {
    const encoded = encodeRichStatus(3, 'nope', [{ message: 'm', field: '/f', code: 'SECRET-RULE-ID' }]);

    expect(encoded.includes(Buffer.from('SECRET-RULE-ID', 'utf8'))).toBe(false);
    expect(decodeFieldViolations(encoded)).toEqual([{ message: 'm', field: '/f' }]);
  });

  it('writes the canonical Any type_url', () => {
    const encoded = encodeRichStatus(3, 'x', [{ message: 'm' }]);

    expect(encoded.includes(Buffer.from(BAD_REQUEST_TYPE_URL, 'utf8'))).toBe(true);
  });

  it('degrades to no errors rather than throwing on a foreign or corrupt Status', () => {
    // A Status with no details at all.
    expect(decodeFieldViolations(encodeRichStatus(13, 'boom'))).toEqual([]);
    // Truncated bytes.
    expect(decodeFieldViolations(encodeRichStatus(3, 'x', [{ message: 'm' }]).subarray(0, 7))).toEqual([]);
    // Not protobuf at all.
    expect(decodeFieldViolations(Buffer.from('definitely not a protobuf', 'utf8'))).toEqual([]);
    expect(decodeFieldViolations(Buffer.alloc(0))).toEqual([]);
  });

  it('skips fields it does not know, so a richer producer still decodes', () => {
    // A Status carrying an unknown varint field 7, an unknown string field 9, and an ErrorInfo-shaped
    // detail alongside the BadRequest - all of which a future/other-language producer may send.
    // One length-delimited protobuf field, for payloads under 128 bytes (all of them here).
    const lenDelim = (fieldNumber: number, payload: Buffer): Buffer =>
      Buffer.concat([Buffer.from([(fieldNumber << 3) | 2, payload.length]), payload]);

    const badRequest = encodeRichStatus(3, 'x', [{ message: 'kept', field: '/k' }]);
    // Status.details holding an Any whose type_url is some OTHER google.rpc type.
    const foreignDetail = lenDelim(
      3,
      lenDelim(1, Buffer.from('type.googleapis.com/google.rpc.ErrorInfo', 'utf8')),
    );
    // Status field 7 as a varint, field 9 as a string - neither is anything this reader knows.
    const unknownFields = Buffer.from([(7 << 3) | 0, 0x2a, (9 << 3) | 2, 0x02, 0x68, 0x69]);

    expect(decodeFieldViolations(Buffer.concat([unknownFields, badRequest, foreignDetail]))).toEqual([
      { message: 'kept', field: '/k' },
    ]);
  });
});
