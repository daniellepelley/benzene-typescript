/**
 * Matches a URL path against a route pattern and extracts route parameters (e.g. `123` from
 * `/users/123` matched against `/users/{id}`). Case-insensitive, supporting literal + parameter
 * segments.
 * Port of Benzene.Http.Routing.UrlMatcher (C# `IDictionary<string, object>` -> `Record<string, unknown>`;
 * C# `null` "no match" -> `undefined`).
 */
export class UrlMatcher {
  /**
   * Matches `path` against `routerPath`, returning the extracted parameters, or `undefined` if the
   * path does not match. Port of C# `MatchUrl`.
   */
  matchUrl(path: string, routerPath: string): Record<string, unknown> | undefined {
    const routerPathParts = UrlMatcher.splitPath(routerPath);
    const pathParts = UrlMatcher.splitPath(path);

    if (routerPathParts.length !== pathParts.length) {
      return undefined;
    }

    const output: Record<string, unknown> = {};

    for (let i = 0; i < routerPathParts.length; i++) {
      const routeParts = UrlMatcher.splitRouterPath(routerPathParts[i]);

      const parameterKeys = routeParts.filter((x) => x.startsWith('{'));
      const nonParameterKeys = routeParts.filter((x) => !x.startsWith('{'));

      const value = UrlMatcher.removeParts(pathParts[i], nonParameterKeys);

      if (value === undefined) {
        return undefined;
      }

      if (value === '') {
        continue;
      }

      if (parameterKeys.length > 0) {
        output[parameterKeys[0].replace('{', '').replace('}', '')] = value;
        continue;
      }

      return undefined;
    }

    return output;
  }

  private static removeParts(input: string, removeParts: string[]): string | undefined {
    let s: string | undefined = input;
    for (const s1 of removeParts) {
      if (s === undefined) {
        return undefined;
      }
      if (s.split(s1).filter((x) => x !== '').length > 1) {
        return undefined;
      }
      s = s.split(s1).join('');
    }
    return s;
  }

  private static splitPath(path: string): string[] {
    const first = path.split('?').filter((x) => x !== '')[0] ?? '';
    return first
      .toLowerCase()
      .split('/')
      .filter((x) => x !== '');
  }

  private static splitRouterPath(routerPath: string): string[] {
    return routerPath
      .replace(/\//g, '')
      .split(/(?<=\})|(?=\{)/)
      .filter((x) => x !== '');
  }
}
