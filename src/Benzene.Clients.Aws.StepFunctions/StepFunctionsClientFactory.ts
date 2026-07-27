/** Port of Benzene.Clients.Aws.StepFunctions.StepFunctionsClientFactory. */
import { SFNClient } from '@aws-sdk/client-sfn';
import { ILogger, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IStepFunctionsClient } from './IStepFunctionsClient';
import { StepFunctionsClient } from './StepFunctionsClient';

/** Creates {@link IStepFunctionsClient} instances for a specific state machine. */
export interface IStepFunctionsClientFactory {
  /** Creates a new Step Functions client. */
  create(): IStepFunctionsClient;
}

export const IStepFunctionsClientFactory: ServiceToken<IStepFunctionsClientFactory> =
  serviceToken<IStepFunctionsClientFactory>('IStepFunctionsClientFactory');

/** Creates {@link StepFunctionsClient} instances for a specific state machine. */
export class StepFunctionsClientFactory implements IStepFunctionsClientFactory {
  constructor(
    private readonly stateMachineArn: string,
    private readonly amazonStepFunctions: SFNClient,
    private readonly logger: ILogger,
  ) {}

  create(): IStepFunctionsClient {
    return new StepFunctionsClient(this.stateMachineArn, this.amazonStepFunctions, this.logger);
  }
}
