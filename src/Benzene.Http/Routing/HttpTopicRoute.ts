/**
 * A matched HTTP route: the topic that identifies its handler plus the route parameters extracted
 * from the URL path.
 * Port of Benzene.Http.Routing.HttpTopicRoute (C# `IDictionary<string, object>` maps to
 * `Record<string, unknown>`).
 */
export class HttpTopicRoute {
  constructor(
    readonly topic: string,
    readonly parameters: Record<string, unknown>,
  ) {}
}
