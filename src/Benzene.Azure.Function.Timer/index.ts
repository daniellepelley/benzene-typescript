/** Port of Benzene.Azure.Function.Timer (barrel). */
export * from './TimerTriggerInfo';
export * from './TimerContext';
export * from './TimerMessageMappers';
export * from './TimerApplication';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// FAITHFUL SHAPE: a timer trigger is a scheduler, not a transport — a tick carries no message payload,
// so `TimerApplication` runs a single-tick `MiddlewareApplication` (not a batch/multi one) and there is
// no egress package (nothing to publish to). Two consumption modes mirror the C#: direct `useTick(...)`
// terminal sugar, or preset-topic message-handler dispatch (`usePresetTopic(...)` + `useMessageHandlers`)
// where the tick's body is the serialized `TimerTriggerInfo`.
//
// DEFERRED: TimerRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck) —
// the same registration-diagnostics surface deferred for the AWS SqsRegistrations. Also deferred: the
// `BenzeneTimerTriggerAttribute` (a source-generator declaration with no TypeScript counterpart), the
// host-neutral `useTimerTrigger(IBenzeneApplicationBuilder, ...)` overload, and the C#
// `UseTick(Func<TimerTriggerInfo, Task>)` convenience overload (collapsed into the `TimerContext` form —
// see `Extensions.ts`; the schedule info is reached via `context.timer`).
