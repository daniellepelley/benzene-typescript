/** Port of Benzene.Aws.Lambda.S3.S3ObjectKeyCodec. */

/**
 * Encodes/decodes the URL-encoded object key S3 puts on an event notification record
 * (`record.s3.object.key`), so handlers see the real key rather than its wire encoding, and so test
 * helpers building a fake record can produce the same wire encoding S3 itself would.
 *
 * S3 event notifications URL-encode the object key (a space becomes `+`, and other reserved/
 * non-ASCII bytes are percent-encoded), matching the encoding S3's own URLs use. Left undecoded, a
 * key containing a space, `+`, `&`, `%`, or non-ASCII character reaches the handler in its raw
 * encoded form, so a `GetObject` call with it returns `NoSuchKey` (.NET R11 #158). The decode MUST
 * turn `+` into a space BEFORE percent-decoding (a bare `decodeURIComponent` — like .NET's
 * `Uri.UnescapeDataString` — does not treat `+` as a space, which is exactly the encoding S3 uses
 * for spaces in keys). `encode` and `decode` are exact inverses of each other, so a key built with
 * `encode` — e.g. by `@benzenejs/aws-lambda-testing`'s `asS3` — decodes back to exactly what was
 * passed in when the real getter (`decode`) reads it. Keep both directions in this one module so
 * the encode and decode sides can never drift apart from each other (.NET R12-13 #191).
 *
 * ADAPTATION: .NET wraps `WebUtility.UrlDecode`/`UrlEncode`; JS has no space-as-`+` codec in the
 * standard library, so `decode` is `+` -> space then `decodeURIComponent`, and `encode` is
 * `encodeURIComponent` then `%20` -> `+`. Divergence notes: a RAW key with a malformed percent
 * sequence (e.g. a bare `100%`) decodes leniently to itself-with-`+`-as-space rather than throwing
 * (`WebUtility.UrlDecode` is equally lenient); `encodeURIComponent`'s unencoded set
 * (`A-Za-z0-9 -_.!~*'()`) differs from `WebUtility.UrlEncode`'s in a few marks, which is
 * invisible to the round-trip contract (`decode` maps them all to themselves).
 */
export const S3ObjectKeyCodec = {
  /**
   * URL-decodes an S3 object key as it appears on the event notification record: `+` -> space,
   * then percent-decode. Returns `undefined` unchanged.
   */
  decode(rawKey: string | undefined): string | undefined {
    if (rawKey === undefined) {
      return undefined;
    }
    const plusDecoded = rawKey.replace(/\+/g, ' ');
    try {
      return decodeURIComponent(plusDecoded);
    } catch {
      // A malformed percent sequence in a raw (non-S3-produced) key: degrade leniently rather than
      // corrupt the whole dispatch, matching WebUtility.UrlDecode's tolerance.
      return plusDecoded;
    }
  },

  /**
   * URL-encodes an object key the way S3 encodes it on an event notification record (space -> `+`,
   * reserved/non-ASCII percent-encoded), so the result round-trips through {@link decode} back to
   * the original key. Returns `undefined` unchanged.
   */
  encode(key: string | undefined): string | undefined {
    if (key === undefined) {
      return undefined;
    }
    return encodeURIComponent(key).replace(/%20/g, '+');
  },
};
