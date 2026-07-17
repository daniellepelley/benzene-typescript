import { BenzeneResultStatus } from '@benzene/results';
import { IDefaultStatuses } from './MessageResult';

/** Port of Benzene.Core.MessageHandlers.DefaultStatuses. */
export class DefaultStatuses implements IDefaultStatuses {
  get validationError(): string {
    return BenzeneResultStatus.validationError;
  }

  get notFound(): string {
    return BenzeneResultStatus.notFound;
  }

  get badRequest(): string {
    return BenzeneResultStatus.badRequest;
  }
}
