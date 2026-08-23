import { pathToFileURL } from 'node:url';

/**
 * @typedef {{
 *   argv?: readonly string[],
 *   environment?: Record<string, string | undefined>,
 *   createClientImpl?: (...args: any[]) => any,
 *   output?: (line: string) => void,
 *   errorOutput?: (line: string) => void
 * }} RecoveryCliOptions
 */

/**
 * Minimal fail-closed CLI shell for abandoned Gate 3 recovery.
 *
 * The actual hosted dry-run/cleanup remains unreachable unless the future
 * orchestration layer supplies the required operator material securely.
 *
 * @param {RecoveryCliOptions} [options]
 * @returns {Promise<number>}
 */
export async function runAbandonedRecoveryCli({
  argv = process.argv.slice(2),
  environment = process.env,
  createClientImpl,
  output = console.log,
  errorOutput = console.error
} = {}) {
  const mode = argv[0];

  if (mode !== 'dry-run' && mode !== 'cleanup') {
    errorOutput('Recovery runner failed safely.');
    return 1;
  }

  const requiredOperatorInputs = [
    'SUPABASE_SECRET_KEY',
    'EXPECTED_SUPABASE_PROJECT_REF',
    'E2E_REAL_REPORT_EVIDENCE_MANIFEST_PATH'
  ];

  const operatorReady = requiredOperatorInputs.every((name) => {
    const value = environment[name];
    return typeof value === 'string' && value.trim().length > 0;
  });

  if (!operatorReady || typeof createClientImpl !== 'function') {
    errorOutput('Recovery runner failed safely.');
    return 1;
  }

  // Intentionally not wired to stateful execution yet.
  // The orchestration phase will supply the secure operator client and
  // explicit checkpoint/approval flow after this recovery change is merged.
  errorOutput('Recovery runner failed safely.');
  return 1;
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const exitCode = await runAbandonedRecoveryCli();
  process.exitCode = exitCode;
}
