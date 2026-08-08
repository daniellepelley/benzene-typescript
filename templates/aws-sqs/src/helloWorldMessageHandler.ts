import { IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { IGreeter } from './greeter';

export class HelloWorldMessage {
  name?: string;
}

// This is a starter handler — replace it with your own, or add more alongside it.
//
// This is a fire-and-forget handler (`IMessageHandlerNoResponse`, no response type) — the right shape
// for a queue, topic, or stream consumer, since nothing is written back. Benzene routes each incoming
// message to a handler by matching its topic against `@message('...')`. The handler takes its
// collaborators (here `IGreeter`) via the constructor — they're resolved from the container, and a test
// can swap them for a stand-in (see `test/`). Keeping side effects behind an injected service like this
// is what makes the handler straightforward to test.
//
// Because TypeScript erases constructor parameter types, the container can only inject what the static
// `inject` array lists — it is the port's counterpart to C# constructor injection.
@message('hello:world', { requestType: HelloWorldMessage })
export class HelloWorldMessageHandler implements IMessageHandlerNoResponse<HelloWorldMessage> {
  static readonly inject = [IGreeter] as const;

  constructor(private readonly greeter: IGreeter) {}

  handleAsync(message: HelloWorldMessage): Promise<void> {
    this.greeter.greet(message.name ?? 'World');
    return Promise.resolve();
  }
}
