import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, JWK, KeyLike, SignJWT } from 'jose';

/**
 * A real loopback JWKS endpoint (RFC 7517) backed by locally-generated RSA keys, for exercising
 * `@benzene/auth-oauth2`'s `jwksUri` path end-to-end without depending on a real identity provider.
 * Serves whatever set of keys is currently registered via {@link addKey}. Port of the C# test's
 * `FakeJwksServer` (HttpListener + RSA) onto `node:http` + jose.
 */
export class FakeJwksServer {
  private readonly keys: { kid: string; privateKey: KeyLike; publicJwk: JWK }[] = [];
  private server!: Server;

  /** The JWKS document URL to hand to `OAuth2BearerOptions.jwksUri`. */
  jwksUri!: string;

  private constructor() {}

  /** Starts a loopback JWKS server on an ephemeral port and returns it. */
  static async start(): Promise<FakeJwksServer> {
    const instance = new FakeJwksServer();
    instance.server = createServer((_req, res) => {
      const body = JSON.stringify({ keys: instance.keys.map((k) => k.publicJwk) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });

    await new Promise<void>((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
    const port = (instance.server.address() as AddressInfo).port;
    // Serve the JWKS for any path - this is a single-purpose test double.
    instance.jwksUri = `http://127.0.0.1:${port}/jwks.json`;
    return instance;
  }

  /** Generates and registers a new RSA key under the given key id, returning its private key for signing. */
  async addKey(kid: string): Promise<KeyLike> {
    const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    publicJwk.kid = kid;
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';
    this.keys.push({ kid, privateKey, publicJwk });
    return privateKey;
  }

  /** Mints a JWT signed with the given key, with the given issuer/audience/claims/lifetime. */
  static createToken(
    signingKey: KeyLike,
    kid: string,
    issuer: string,
    audience: string,
    extraClaims: Record<string, unknown> = {},
    lifetime: { expSeconds?: number; nbfSeconds?: number } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(extraClaims)
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setNotBefore(lifetime.nbfSeconds ?? now - 60)
      .setExpirationTime(lifetime.expSeconds ?? now + 300)
      .sign(signingKey);
  }

  /**
   * Mints a JWT signed with an HMAC secret instead of an RSA key - for proving the algorithm allowlist
   * actually rejects a token whose `alg` isn't on it.
   */
  static createHmacSignedToken(issuer: string, audience: string, secret: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt(now)
      .setNotBefore(now - 60)
      .setExpirationTime(now + 300)
      .sign(new TextEncoder().encode(secret));
  }

  /** Stops the loopback server. */
  async dispose(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

/** Runs `body` with a started {@link FakeJwksServer}, disposing it afterward. */
export async function withJwks<T>(body: (jwks: FakeJwksServer) => Promise<T>): Promise<T> {
  const jwks = await FakeJwksServer.start();
  try {
    return await body(jwks);
  } finally {
    await jwks.dispose();
  }
}
