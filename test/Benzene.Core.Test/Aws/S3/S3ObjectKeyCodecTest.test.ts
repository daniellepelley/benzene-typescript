import { describe, expect, it } from 'vitest';
import { S3Event, S3EventRecord } from 'aws-lambda';
import {
  S3MessageBodyGetter,
  S3MessageHeadersGetter,
  S3ObjectKeyCodec,
  S3RecordContext,
} from '@benzenejs/aws-lambda-s3';
import { asS3 } from '@benzenejs/aws-lambda-testing';

/**
 * Port of test/Benzene.Core.Test/Aws/S3/S3ObjectKeyCodecTest.cs (benzene-dotnet) plus the R11
 * #158-#165 getter half: S3 event notifications URL-encode the object key (space arrives as `+`),
 * so the real getters must decode (`+` -> space, then percent-decode) and the `asS3` test helper
 * must encode with the exact inverse (#191 - both directions live in ONE codec so they can't
 * drift).
 */

function recordWithRawKey(rawKey: string): S3EventRecord {
  return {
    eventSource: 'aws:s3',
    eventName: 'ObjectCreated:Put',
    awsRegion: 'eu-west-1',
    s3: {
      bucket: { name: 'my-bucket' },
      object: { key: rawKey, size: 1, eTag: 'etag' },
    },
  } as unknown as S3EventRecord;
}

function contextWithRawKey(rawKey: string): S3RecordContext {
  const record = recordWithRawKey(rawKey);
  return S3RecordContext.createInstance({ Records: [record] } as S3Event, record);
}

describe('S3ObjectKeyCodec', () => {
  // #191: these keys cover the reserved character set S3's own scheme treats specially
  // (space/'+', '%', and non-ASCII), plus the exact key from the finding.
  it.each([
    'invoice+2024-08-27.pdf',
    'plain-key',
    'key with spaces',
    '100% done.txt',
    'a+b c%d',
    'folder/sub+folder/file&name.txt',
    'café/naïve.txt',
    '日本語.json',
    '',
    '100%',
    '50%+off',
  ])('encode-then-decode round-trips %j to the original key', (rawKey) => {
    expect(S3ObjectKeyCodec.decode(S3ObjectKeyCodec.encode(rawKey))).toBe(rawKey);
  });

  it('round-trips arbitrary keys (property test over the reserved + unicode character set)', () => {
    // A seeded linear-congruential PRNG keeps the property test deterministic while still sweeping
    // a wide sample of the space S3 keys live in.
    let seed = 0xbe27ce11;
    const next = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    const alphabet = [
      ...'abcXYZ019 +%&/=?#[]@!$\'()*,;:.-_~"<>\\`{}|^',
      'é',
      'ß',
      '日',
      '語',
      '🚀',
      ' ',
    ];

    for (let i = 0; i < 250; i++) {
      const length = Math.floor(next() * 24);
      const key = Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
      const encoded = S3ObjectKeyCodec.encode(key);
      expect(S3ObjectKeyCodec.decode(encoded), `key ${JSON.stringify(key)}`).toBe(key);
    }
  });

  it('encodes a space as + (S3\'s own encoding scheme), not %20', () => {
    // A generic encodeURIComponent alone would produce %20 — and a `+` in the real key must be
    // percent-encoded so Decode's '+' -> space rule can't corrupt it.
    expect(S3ObjectKeyCodec.encode('a b')).toBe('a+b');
    expect(S3ObjectKeyCodec.encode('a+b')).toBe('a%2Bb');
  });

  it('decodes a wire + as a space (#158: a key with spaces arrives as +)', () => {
    expect(S3ObjectKeyCodec.decode('invoice+2024-08-27.pdf')).toBe('invoice 2024-08-27.pdf');
    expect(S3ObjectKeyCodec.decode('caf%C3%A9%2Fna%C3%AFve.txt')).toBe('café/naïve.txt');
  });

  it('passes undefined through unchanged in both directions', () => {
    expect(S3ObjectKeyCodec.encode(undefined)).toBeUndefined();
    expect(S3ObjectKeyCodec.decode(undefined)).toBeUndefined();
  });

  it('decodes a malformed percent sequence leniently instead of throwing', () => {
    // A raw '%' not followed by hex can only come from a non-S3-produced event; WebUtility.UrlDecode
    // is lenient there and so is this port — the '+' -> space half still applies.
    expect(S3ObjectKeyCodec.decode('100%')).toBe('100%');
    expect(S3ObjectKeyCodec.decode('100%+done')).toBe('100% done');
  });
});

describe('S3 getters decode the wire key (R11 #158-#165)', () => {
  it('the body getter URL-decodes the object key', () => {
    const body = new S3MessageBodyGetter().getBody(contextWithRawKey('invoice+2024-08-27.pdf'))!;
    expect(JSON.parse(body).key).toBe('invoice 2024-08-27.pdf');
  });

  it('the headers getter URL-decodes the key header', () => {
    const headers = new S3MessageHeadersGetter().getHeaders(
      contextWithRawKey('folder%2Fcaf%C3%A9+menu.pdf'),
    );
    expect(headers['key']).toBe('folder/café menu.pdf');
  });

  it('#191: an asS3-built record reaches the real getter with the key unchanged', () => {
    // asS3 takes the PLAIN key and encodes it with the codec's encode half — the exact inverse of
    // the decode the real getter applies — so a key with reserved characters round-trips byte-exact.
    const plainKey = 'invoice+2024-08-27 (final) 100%.pdf';
    const s3Event = asS3('my-bucket', plainKey);
    const record = s3Event.Records[0]!;

    // The wire form is genuinely encoded (as S3 itself would deliver it)...
    expect(record.s3.object.key).not.toBe(plainKey);

    // ...and the real getters hand the handler back exactly what was passed in.
    const context = S3RecordContext.createInstance(s3Event, record);
    expect(JSON.parse(new S3MessageBodyGetter().getBody(context)!).key).toBe(plainKey);
    expect(new S3MessageHeadersGetter().getHeaders(context)['key']).toBe(plainKey);
  });
});
