/**
 * Test host abstraction for sending transport events end-to-end in tests.
 * Port of Benzene.Abstractions.IBenzeneTestHost.
 */
export interface IBenzeneTestHost {
  /** Port of C# `Task<TResponse> SendEventAsync<TResponse>(object awsEvent)`. */
  sendEventAsync<TResponse>(event: unknown): Promise<TResponse>;
}
