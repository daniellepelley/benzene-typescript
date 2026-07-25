/** Port of Benzene.CodeGen.Client.TopicMethodName / TopicReversedMethodName (the `IMethodName` strategies). */
import { toIdentifierSegment } from './NameFormatter';

/**
 * Turns a topic into the PascalCase base name a generated method/type is built from. The C# strategies
 * take an (unused) request schema too; that argument is dropped here.
 */
export interface IMethodName {
  create(topic: string): string;
}

/** `order:create` -> `OrderCreate` (segments in source order). */
export class TopicMethodName implements IMethodName {
  create(topic: string): string {
    return topic.split(':').map(toIdentifierSegment).join('');
  }
}

/**
 * `order:create` -> `CreateOrder` (segments reversed) - the default the C# SDK builder uses, so the
 * verb reads first (`createOrderAsync`, not `orderCreateAsync`).
 */
export class TopicReversedMethodName implements IMethodName {
  create(topic: string): string {
    return topic.split(':').reverse().map(toIdentifierSegment).join('');
  }
}
