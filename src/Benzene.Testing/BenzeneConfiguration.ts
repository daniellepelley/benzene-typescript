/**
 * `BenzeneConfiguration` and its helpers moved to `@benzene/abstractions-middleware` (the neutral
 * hosting-abstractions package) so the production `AwsLambdaHost<TStartUp>` can boot the same
 * `BenzeneStartUp` contract without depending on the testing package. Re-exported here so existing
 * `import { BenzeneConfiguration, configurationFrom, ... } from '@benzene/testing'` keeps working.
 */
export {
  type BenzeneConfiguration,
  emptyConfiguration,
  configurationFrom,
  layerConfiguration,
} from '@benzene/abstractions-middleware';
