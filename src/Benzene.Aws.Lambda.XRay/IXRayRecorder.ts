/** The AWS X-Ray recorder seam used by {@link XRayMiddlewareDecorator}. */
import * as AWSXRay from 'aws-xray-sdk-core';

/**
 * The subset of AWS X-Ray recorder operations {@link XRayMiddlewareDecorator} needs, over the *current*
 * (ambient) X-Ray entity — the TypeScript twin of .NET's `IAWSXRayRecorder` usage.
 *
 * PORTING BEND: .NET talks to the concrete `AWSXRayRecorder.Instance` (which implements an interface).
 * `aws-xray-sdk-core` exposes module-level functions instead, and its "current entity" lives in a CLS
 * async-context namespace rather than a mockable singleton. This explicit seam keeps the decorator (a) a
 * faithful begin/annotate/record-exception/end shape and (b) unit-testable with a fake recorder, without
 * standing up a real X-Ray context. The default implementation is {@link XRayRecorder.instance}.
 */
export interface IXRayRecorder {
  /**
   * Opens a subsegment named `name` under the current X-Ray segment and makes it the current entity.
   * Returns `false` when there is no active X-Ray segment in context (off Lambda, or on Lambda with
   * active tracing off), in which case nothing is opened — the decorator then traces nothing and just
   * runs the inner middleware (the no-op case, mirroring `ActivitySource.StartActivity` returning null).
   */
  beginSubsegment(name: string): boolean;

  /** Best-effort: annotates the current subsegment (a no-op if the X-Ray context has since vanished). */
  addAnnotation(key: string, value: string): void;

  /** Best-effort: records `error` as a fault on the current subsegment. */
  addException(error: unknown): void;

  /** Best-effort: closes the current subsegment and restores its parent as the current entity. */
  endSubsegment(): void;
}

/** A subsegment/segment as exposed by `aws-xray-sdk-core` (only the members this package uses). */
interface XRayEntity {
  addNewSubsegment(name: string): XRayEntity;
  addAnnotation(key: string, value: string | number | boolean): void;
  addError(error: Error | string): void;
  close(error?: Error | string | null): void;
  parent?: XRayEntity;
}

/**
 * The default {@link IXRayRecorder}, bridging to `aws-xray-sdk-core`'s CLS-based context. `beginSubsegment`
 * reads the current entity, opens a child subsegment (`addNewSubsegment`) and pushes it as current
 * (`setSegment`); `endSubsegment` closes it and restores the parent — the same push/pop the .NET SDK's
 * `BeginSubsegment`/`EndSubsegment` do, so the middleware breakdown nests under the Lambda's segment.
 *
 * The current entity is read straight from the context namespace (rather than `getSegment()`), so a
 * missing context is a silent `undefined` — the SDK's context-missing strategy (which logs) is never
 * triggered, keeping the decorator a truly silent no-op off Lambda.
 */
export class XRayRecorder implements IXRayRecorder {
  static readonly instance = new XRayRecorder();

  beginSubsegment(name: string): boolean {
    const parent = this.currentEntity();
    if (parent === undefined) {
      return false;
    }
    const subsegment = parent.addNewSubsegment(name);
    AWSXRay.setSegment(subsegment as unknown as AWSXRay.Subsegment);
    return true;
  }

  addAnnotation(key: string, value: string): void {
    this.currentEntity()?.addAnnotation(key, value);
  }

  addException(error: unknown): void {
    this.currentEntity()?.addError(error instanceof Error ? error : String(error));
  }

  endSubsegment(): void {
    const subsegment = this.currentEntity();
    if (subsegment === undefined) {
      return;
    }
    subsegment.close();
    if (subsegment.parent !== undefined) {
      AWSXRay.setSegment(subsegment.parent as unknown as AWSXRay.Subsegment);
    }
  }

  /** Reads the ambient X-Ray entity from the context namespace without triggering the missing-context strategy. */
  private currentEntity(): XRayEntity | undefined {
    try {
      const namespace = AWSXRay.getNamespace() as { get(key: string): unknown } | undefined;
      const entity = namespace?.get('segment');
      return (entity ?? undefined) as XRayEntity | undefined;
    } catch {
      return undefined;
    }
  }
}
