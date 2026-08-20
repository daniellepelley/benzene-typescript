import { Metadata } from '@grpc/grpc-js';
import { BenzeneError } from '@benzenejs/abstractions';

/**
 * The `grpc-status-details-bin` trailer (wire-contracts.md §4.2) — the gRPC binding's home for a failed
 * result's structured `errors`.
 *
 * §1.3's problem document does not travel over gRPC; its information maps onto gRPC's own error model
 * instead. The `benzene-status` trailer already carries `benzeneStatus`; this module carries the rest:
 * a `google.rpc.Status` whose `details` hold a `google.rpc.BadRequest` with **one `FieldViolation` per
 * error**, so a `field`/`code`-bearing validation failure survives a gRPC hop the way it already
 * survives an HTTP one.
 *
 * **The mapping is pinned, and narrow.** `BenzeneError.message` → `FieldViolation.description`,
 * `BenzeneError.field` → `FieldViolation.field`. `BenzeneError.code` is deliberately carried NOWHERE:
 * the spec sentence does not say where it goes, and three ports each inventing a home for it is
 * precisely the divergence the spec exists to prevent. (`FieldViolation` *does* have a third string
 * field, `reason` (field 3), added to `google/rpc/error_details.proto` in 2022 and documented as "a
 * unique identifier for this violation type" — the obvious candidate home for `code`, but not used here
 * until the spec says so. This note is the record that it exists.)
 *
 * The `BadRequest` detail is attached whenever the result carries errors, not only for
 * `validation-error`: §4.2's sentence is unconditional. (.NET's `AddRichErrorDetails` restricts it to
 * `validation-error`; that narrowing is being raised separately — this port implements the spec.)
 *
 * **Why hand-rolled.** `Grpc.Core` hands .NET a generated `Google.Rpc.Status`; `@grpc/grpc-js` ships no
 * `google.rpc` types at all (it has no notion of `grpc-status-details-bin` — see its `StatusObject`),
 * and neither does `@grpc/proto-loader`. The four messages involved are tiny, frozen, and use only two
 * of proto3's five wire types, so they are encoded and decoded here directly rather than by taking a
 * protobuf-runtime dependency plus vendored `.proto` descriptors for four messages:
 *
 * ```proto
 * message Status   { int32 code = 1; string message = 2; repeated google.protobuf.Any details = 3; }
 * message Any      { string type_url = 1; bytes value = 2; }
 * message BadRequest { repeated FieldViolation field_violations = 1; }
 * message FieldViolation { string field = 1; string description = 2; string reason = 3; }
 * ```
 *
 * The reader skips unknown fields by wire type, as every proto3 reader must, so a `Status` produced by
 * .NET, Go or Python — carrying members this port never writes — decodes here without loss of the parts
 * it does understand.
 */

/** The binary trailer key. The `-bin` suffix is what makes gRPC base64 it on the wire. */
export const GRPC_STATUS_DETAILS_TRAILER = 'grpc-status-details-bin';

/** The `google.protobuf.Any.type_url` a `google.rpc.BadRequest` detail carries. */
export const BAD_REQUEST_TYPE_URL = 'type.googleapis.com/google.rpc.BadRequest';

// ── Encoding ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Encodes a `google.rpc.Status` for the `grpc-status-details-bin` trailer: `code` and `message` from the
 * call's outcome, plus — when `errors` is non-empty — one `google.rpc.BadRequest` detail holding one
 * `FieldViolation` per error.
 */
export function encodeRichStatus(
  code: number,
  message: string,
  errors?: readonly BenzeneError[],
): Buffer {
  const out: number[] = [];
  writeInt32(out, 1, code);
  writeString(out, 2, message);

  if (errors !== undefined && errors.length > 0) {
    writeBytes(out, 3, encodeAny(BAD_REQUEST_TYPE_URL, encodeBadRequest(errors)));
  }

  return Buffer.from(out);
}

function encodeBadRequest(errors: readonly BenzeneError[]): Buffer {
  const out: number[] = [];
  for (const error of errors) {
    writeBytes(out, 1, encodeFieldViolation(error));
  }
  return Buffer.from(out);
}

function encodeFieldViolation(error: BenzeneError): Buffer {
  const out: number[] = [];
  // `field` is left UNSET (not empty-string) when the error isn't scoped to a field, per proto3's
  // default-value omission - the same distinction .NET draws.
  writeString(out, 1, error.field ?? '');
  writeString(out, 2, error.message ?? '');
  // Field 3 (`reason`) is deliberately not written - see the module note on `BenzeneError.code`.
  return Buffer.from(out);
}

function encodeAny(typeUrl: string, value: Buffer): Buffer {
  const out: number[] = [];
  writeString(out, 1, typeUrl);
  writeBytes(out, 2, value);
  return Buffer.from(out);
}

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_32BIT = 5;

function writeTag(out: number[], fieldNumber: number, wireType: number): void {
  writeVarint(out, fieldNumber * 8 + wireType);
}

/** Base-128 varint, proto3's universal integer encoding. Non-negative safe integers only. */
function writeVarint(out: number[], value: number): void {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  out.push(remaining);
}

function writeInt32(out: number[], fieldNumber: number, value: number): void {
  if (value === 0) {
    return; // proto3 omits default values
  }
  writeTag(out, fieldNumber, WIRE_VARINT);
  if (value < 0) {
    // proto3 sign-extends a negative int32 to a full 64-bit varint (ten bytes).
    let remaining = BigInt.asUintN(64, BigInt(value));
    while (remaining >= 0x80n) {
      out.push(Number(remaining & 0x7fn) | 0x80);
      remaining >>= 7n;
    }
    out.push(Number(remaining));
    return;
  }
  writeVarint(out, value);
}

function writeString(out: number[], fieldNumber: number, value: string): void {
  if (value === '') {
    return; // proto3 omits default values
  }
  writeBytes(out, fieldNumber, Buffer.from(value, 'utf8'));
}

function writeBytes(out: number[], fieldNumber: number, value: Buffer): void {
  writeTag(out, fieldNumber, WIRE_LENGTH_DELIMITED);
  writeVarint(out, value.length);
  for (const byte of value) {
    out.push(byte);
  }
}

// ── Decoding ────────────────────────────────────────────────────────────────────────────────────────

/**
 * Reads the structured errors back out of a call's trailing metadata: the `grpc-status-details-bin`
 * trailer's `google.rpc.Status` → its `google.rpc.BadRequest` detail → one {@link BenzeneError} per
 * `FieldViolation` (`description` → `message`, `field` → `field` when set).
 *
 * Returns an empty array when the trailer is absent, holds something other than a `Status`, or carries
 * no `BadRequest` detail — the caller then falls back to the call's flat status detail string, which is
 * what a server that attaches no details (or an older Benzene server) produces.
 */
export function readFieldViolations(trailers: Metadata | undefined): BenzeneError[] {
  const values = trailers?.get(GRPC_STATUS_DETAILS_TRAILER);
  const first = values !== undefined && values.length > 0 ? values[0] : undefined;
  return Buffer.isBuffer(first) ? decodeFieldViolations(first) : [];
}

/**
 * Decodes a `google.rpc.Status`'s `BadRequest` field violations. Malformed or truncated bytes yield an
 * empty array rather than throwing: a broken trailer must degrade to the message-only fallback, never
 * fail the caller's result.
 */
export function decodeFieldViolations(statusBytes: Buffer): BenzeneError[] {
  try {
    const errors: BenzeneError[] = [];
    const reader = new Reader(statusBytes);
    while (!reader.done) {
      const field = reader.readTag();
      if (field.number === 3 && field.wireType === WIRE_LENGTH_DELIMITED) {
        collectFromAny(reader.readLengthDelimited(), errors);
      } else {
        reader.skip(field.wireType);
      }
    }
    return errors;
  } catch {
    return [];
  }
}

function collectFromAny(anyBytes: Buffer, errors: BenzeneError[]): void {
  let typeUrl = '';
  let value: Buffer | undefined;

  const reader = new Reader(anyBytes);
  while (!reader.done) {
    const field = reader.readTag();
    if (field.number === 1 && field.wireType === WIRE_LENGTH_DELIMITED) {
      typeUrl = reader.readLengthDelimited().toString('utf8');
    } else if (field.number === 2 && field.wireType === WIRE_LENGTH_DELIMITED) {
      value = reader.readLengthDelimited();
    } else {
      reader.skip(field.wireType);
    }
  }

  // Compare on the type name, not the whole URL: the host part of a type_url is not significant.
  if (value !== undefined && typeUrl.split('/').pop() === 'google.rpc.BadRequest') {
    collectFromBadRequest(value, errors);
  }
}

function collectFromBadRequest(badRequestBytes: Buffer, errors: BenzeneError[]): void {
  const reader = new Reader(badRequestBytes);
  while (!reader.done) {
    const field = reader.readTag();
    if (field.number === 1 && field.wireType === WIRE_LENGTH_DELIMITED) {
      errors.push(readFieldViolation(reader.readLengthDelimited()));
    } else {
      reader.skip(field.wireType);
    }
  }
}

function readFieldViolation(violationBytes: Buffer): BenzeneError {
  let fieldPath = '';
  let description = '';

  const reader = new Reader(violationBytes);
  while (!reader.done) {
    const field = reader.readTag();
    if (field.number === 1 && field.wireType === WIRE_LENGTH_DELIMITED) {
      fieldPath = reader.readLengthDelimited().toString('utf8');
    } else if (field.number === 2 && field.wireType === WIRE_LENGTH_DELIMITED) {
      description = reader.readLengthDelimited().toString('utf8');
    } else {
      // `reason` (field 3) and anything else a future producer adds are skipped, not guessed at.
      reader.skip(field.wireType);
    }
  }

  return fieldPath === '' ? { message: description } : { message: description, field: fieldPath };
}

/** A minimal proto3 wire-format reader — enough to walk the four messages above and skip the rest. */
class Reader {
  private position = 0;

  constructor(private readonly buffer: Buffer) {}

  get done(): boolean {
    return this.position >= this.buffer.length;
  }

  readTag(): { number: number; wireType: number } {
    const tagValue = this.readVarint();
    return { number: Math.floor(tagValue / 8), wireType: tagValue % 8 };
  }

  readVarint(): number {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      if (this.done) {
        throw new Error('truncated varint');
      }
      const byte = this.buffer[this.position++]!;
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return Number(BigInt.asUintN(64, result));
      }
      shift += 7n;
      if (shift > 63n) {
        throw new Error('varint too long');
      }
    }
  }

  readLengthDelimited(): Buffer {
    const length = this.readVarint();
    const end = this.position + length;
    if (!Number.isSafeInteger(end) || end > this.buffer.length) {
      throw new Error('truncated length-delimited field');
    }
    const slice = this.buffer.subarray(this.position, end);
    this.position = end;
    return slice;
  }

  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.readVarint();
        return;
      case WIRE_64BIT:
        this.advance(8);
        return;
      case WIRE_LENGTH_DELIMITED:
        this.readLengthDelimited();
        return;
      case WIRE_32BIT:
        this.advance(4);
        return;
      default:
        // Groups (3/4) were removed in proto3; nothing this reader meets uses them.
        throw new Error(`unsupported wire type ${wireType}`);
    }
  }

  private advance(count: number): void {
    this.position += count;
    if (this.position > this.buffer.length) {
      throw new Error('truncated field');
    }
  }
}
