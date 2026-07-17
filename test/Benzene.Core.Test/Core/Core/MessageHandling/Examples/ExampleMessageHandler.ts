import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler, IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';
import { Defaults } from './Defaults';
import { ExampleRequestPayload, ExampleResponsePayload } from './ExampleRequestPayload';

/** Port of Benzene.Test.Examples.ExampleMessageHandler. */
@message(Defaults.topic, {
  requestType: ExampleRequestPayload,
  responseType: ExampleResponsePayload,
})
export class ExampleMessageHandler
  implements IMessageHandler<ExampleRequestPayload, ExampleResponsePayload>
{
  handleAsync(request: ExampleRequestPayload): Promise<IBenzeneResultOf<ExampleResponsePayload>> {
    const payload = new ExampleResponsePayload();
    payload.greeting = `hello ${request.name}`;
    return Promise.resolve({
      status: 'Ok',
      isSuccessful: true,
      payloadAsObject: payload,
      errors: [],
      payload,
    });
  }
}

/** Port of Benzene.Test.Examples.ExampleNoResponseMessageHandler. */
@message(Defaults.topicNoResponse, { requestType: ExampleRequestPayload })
export class ExampleNoResponseMessageHandler
  implements IMessageHandlerNoResponse<ExampleRequestPayload>
{
  handleAsync(): Promise<void> {
    return Promise.resolve();
  }
}
