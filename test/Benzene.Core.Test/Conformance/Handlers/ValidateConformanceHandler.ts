import { z } from 'zod';
import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { registerZodSchema } from '@benzenejs/zod';
import { conformanceRegistry } from './GreetConformanceHandler';

export class ValidateItem {
  sku = '';
}

export class ValidateRequest {
  name = '';
  items: ValidateItem[] = [];
}

/**
 * The canonical `conformance:validate` rules (README: `name` non-empty, every `items[].sku` present and
 * non-empty), expressed through this port's own validation integration — the Zod adapter — rather than
 * hand-written in the handler, so the fixture pins the adapter's JSON Pointer `field`s (wire-contracts
 * §1.3, D8).
 */
registerZodSchema(
  ValidateRequest,
  z.object({
    name: z.string().min(1),
    items: z.array(z.object({ sku: z.string().min(1) })),
  }) as unknown as z.ZodType<ValidateRequest>,
);

/** Canonical conformance handler `conformance:validate`: returns `ok` once the request validates. */
@message('conformance:validate', {
  registry: conformanceRegistry,
  requestType: ValidateRequest,
  responseType: VoidResult,
})
export class ValidateConformanceHandler implements IMessageHandler<ValidateRequest, VoidResult> {
  handleAsync(): Promise<IBenzeneResultOf<VoidResult>> {
    return Promise.resolve(BenzeneResult.ok());
  }
}
