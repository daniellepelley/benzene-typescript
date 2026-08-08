/**
 * The runnable console demo — port of the .NET `Program.cs`. Runs the signup saga twice: once happy-path,
 * once forcing the final stage to fail so you can watch the whole thing roll back. Run with:
 *
 *     npm start -w @benzene-example/saga
 */
import { SignupApi } from './signupApi';
import { buildSignupSaga } from './signupSaga';
import { Store } from './store';

async function runAsync(title: string, failAt: string | undefined): Promise<void> {
  console.log(`\n${title}`);

  const store = new Store();
  const api = new SignupApi(store, console.log);
  api.failAt = failAt;

  const result = await buildSignupSaga(api, 'Acme Ltd').runAsync();

  const failedSuffix =
    result.failedStageIndex !== undefined ? ` (failed at stage ${result.failedStageIndex + 1})` : '';
  console.log(`  outcome: ${result.outcome}${failedSuffix}`);

  const remaining = store.snapshot();
  console.log(
    remaining.length === 0
      ? '  store: empty - no orphaned records'
      : `  store: ${remaining.join(', ')}`,
  );
}

async function main(): Promise<void> {
  await runAsync('1) Happy path - everything succeeds', undefined);
  await runAsync('2) Stage 3 fails - the whole saga rolls back', 'rbac-role');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
