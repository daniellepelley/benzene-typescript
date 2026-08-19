// BenzeneError moved to @benzenejs/abstractions (matching C#, where it lives in
// Benzene.Abstractions.Results) so IBenzeneResult can reference it. Re-exported here so an
// existing `import { BenzeneError } from '@benzenejs/results'` keeps working.
export { BenzeneError } from '@benzenejs/abstractions';
export * from './BenzeneResult';
export * from './BenzeneResultExtensions';
export * from './BenzeneResultStatus';
export * from './ProblemDetails';
export * from './ProblemTypes';
