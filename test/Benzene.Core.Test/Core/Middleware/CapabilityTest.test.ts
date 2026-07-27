import { describe, expect, it } from 'vitest';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { capability, isCapability } from '@benzene/abstractions-middleware';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';

/**
 * `builder.use(capability(...))` is the TypeScript-idiomatic answer to .NET's `app.UseXml()` /
 * `app.UseHealthCheck()`. A capability can express BOTH effects a `useX(app, …)` free function does —
 * registering services and/or adding middleware — because its `configure` runs against the builder.
 */

interface Ctx {
  seen: string[];
}

describe('Capability', () => {
  it('isCapability distinguishes a branded capability from a plain function/middleware', () => {
    expect(isCapability(capability<Ctx>(() => {}))).toBe(true);
    expect(isCapability(() => {})).toBe(false);
    expect(isCapability({})).toBe(false);
    expect(isCapability(undefined)).toBe(false);
  });

  it('builder.use(capability) applies the middleware effect', async () => {
    const builder = new MiddlewarePipelineBuilder<Ctx>(new DefaultBenzeneServiceContainer());

    // A capability that adds middleware via the builder it is handed.
    builder.use(capability<Ctx>((b) => b.useFn('tag', async (context, next) => {
      context.seen.push('capability-ran');
      await next();
    })));

    const pipeline = builder.build();
    const context: Ctx = { seen: [] };
    await pipeline.handleAsync(context, new DefaultBenzeneServiceContainer().createServiceResolverFactory().createScope());

    expect(context.seen).toEqual(['capability-ran']);
  });

  it('builder.use(capability) applies the DI-registration effect', () => {
    const builder = new MiddlewarePipelineBuilder<Ctx>(new DefaultBenzeneServiceContainer());
    let registered = false;

    builder.use(capability<Ctx>((b) => b.register((_container: IBenzeneServiceContainer) => {
      registered = true;
    })));

    expect(registered).toBe(true);
  });
});
