/** Port of Benzene.Clients.Aws.StepFunctions.StepFunctionsClient. */
import { ExecutionAlreadyExists, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ILogger, ISerializer, IBenzeneResultOf } from '@benzene/abstractions';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { IStepFunctionsClient } from './IStepFunctionsClient';

/** The characters Step Functions rejects in an execution name (whitespace/control handled separately). */
const DISALLOWED_NAME_CHARS = '<>{}[]?*"#%\\^|~`$&,;:/';

/**
 * Starts executions of an AWS Step Functions state machine.
 *
 * PORTING NOTE: `IAmazonStepFunctions.StartExecutionAsync` → `@aws-sdk/client-sfn`'s
 * `SFNClient.send(new StartExecutionCommand(...))`; the `ExecutionAlreadyExistsException` idempotency
 * catch maps to the v3 `ExecutionAlreadyExists` error class. `ILogger<StepFunctionsClient>` → an
 * `ILogger` supplied by the factory.
 */
export class StepFunctionsClient implements IStepFunctionsClient {
  private readonly serializer: ISerializer = new JsonSerializer();

  constructor(
    private readonly stateMachineArn: string,
    private readonly amazonStepFunctions: SFNClient,
    private readonly logger: ILogger,
  ) {}

  async startExecutionAsync<TMessage, TResponse>(
    message: TMessage,
    executionName?: string,
  ): Promise<IBenzeneResultOf<TResponse>> {
    const name = StepFunctionsClient.sanitizeExecutionName(executionName);

    try {
      await this.amazonStepFunctions.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          input: this.serializer.serialize(message),
          // Undefined name lets AWS generate a UUID (the original behaviour); a supplied name makes the
          // start idempotent for the same (state machine, name, input).
          name,
        }),
      );

      return BenzeneResult.accepted<TResponse>();
    } catch (error) {
      if (error instanceof ExecutionAlreadyExists) {
        // The idempotency name was already used: a prior attempt (e.g. before a lost response) already
        // started this execution. Treat the retry as success rather than a failure.
        return BenzeneResult.accepted<TResponse>();
      }
      this.logger.logError(error, `Sending message to ${this.stateMachineArn} failed`);
      return BenzeneResult.serviceUnavailable<TResponse>(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Sanitizes an idempotency token into a valid Step Functions execution name: Step Functions rejects
   * whitespace, control characters, and the set `< > { } [ ] ? * " # % \ ^ | ~ \` $ & , ; : /`, and caps
   * the name at 80 characters. Disallowed characters are replaced with `-`. Returns `undefined` for a
   * null/empty token so AWS generates a UUID name.
   */
  private static sanitizeExecutionName(executionName?: string): string | undefined {
    if (executionName === undefined || executionName === '') {
      return undefined;
    }

    let sanitized = '';
    for (const c of executionName) {
      const isWhitespace = /\s/.test(c);
      const isControl = c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f;
      const allowed = !isWhitespace && !isControl && !DISALLOWED_NAME_CHARS.includes(c);
      sanitized += allowed ? c : '-';
    }

    return sanitized.length > 80 ? sanitized.substring(0, 80) : sanitized;
  }
}
