import { constants } from 'node:fs';
import { open as openAsync, lstat as statAsync } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertPrivatePath, readPrivateManifest, OperationsError } from './manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const unavailable = new Set(['preflight', 'monitoring-proof', 'incident-drill', 'cleanup']);
/** @param {string} code @returns {never} */
function fail(code) { throw new OperationsError(code); }

/** @param {string} path @param {number} [maximum] */
async function privateBytes(path, maximum = 1_048_576) {
  await assertPrivatePath(path, repositoryRoot);
  const handle = await openAsync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.nlink !== 1 || stat.size > maximum) fail('PRIVATE_FILE_MODE_REQUIRED');
    return await handle.readFile();
  } finally { await handle.close(); }
}
/** @param {string[]} args @param {string[]} names @returns {Record<string,string>} */
function argumentsFor(args, names) {
  /** @type {Record<string,string>} */
  const values = {};
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(arg);
    if (!match || !names.includes(match[1]) || Object.hasOwn(values, match[1])) fail('ARGUMENTS_INVALID');
    values[match[1]] = match[2];
  }
  if (names.some(name => !values[name])) fail('ARGUMENTS_INVALID');
  return values;
}

/** @param {import('./manifest.mjs').Candidate} candidate */
function attestCandidate(candidate) {
  /** @param {string[]} args */
  const git=args=>execFileSync('git',args,{cwd:repositoryRoot,encoding:'utf8',env:{PATH:process.env.PATH},stdio:['ignore','pipe','ignore']}).trim();
  if(git(['rev-parse','HEAD'])!==candidate.sha||git(['rev-parse','HEAD^{tree}'])!==candidate.tree||git(['status','--porcelain']).length)fail('CANDIDATE_MISMATCH');
}

/** @param {string[]} args @returns {Promise<string>} */
export async function runCli(args) {
  const [command, ...rest] = args;
  if (command === '--help' && rest.length === 0) return 'Issue #29 exact-target operations:\n  backup-set --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  restore --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  verify-restore --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  verify-backup --manifest=ABSOLUTE_PATH --backup=ABSOLUTE_PATH --private-key=ABSOLUTE_PATH --descriptor-sha256=HASH\n  validate-receipt --receipt=ABSOLUTE_PATH --sha256=HASH --expected=ABSOLUTE_PATH --evidence=ABSOLUTE_DIRECTORY\nBackup requires current manifest-owned synthetic source and live exact release readback. Remaining hosted transaction commands require their exact integrated provider capabilities.\n';
  if (unavailable.has(command)) fail('HOSTED_EXECUTION_UNAVAILABLE');
  if (command === 'backup-set') {
    const values=argumentsFor(rest,['manifest','settings']);
    const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});
    attestCandidate(manifest.candidate);
    const {executeBackupSet}=await import('./execution.mjs');
    return JSON.stringify(await executeBackupSet({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if(command==='restore'||command==='verify-restore'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeRestore}=await import('./restore-execution.mjs');
    return JSON.stringify(await executeRestore({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate,verifyOnly:command==='verify-restore'}))+'\n';
  }
  if (command === 'verify-backup') {
    const values = argumentsFor(rest, ['manifest', 'backup', 'private-key', 'descriptor-sha256']);
    if (!/^[a-f0-9]{64}$/u.test(values['descriptor-sha256'])) fail('ARGUMENTS_INVALID');
    const manifest = await readPrivateManifest(values.manifest, { repositoryRoot });
    attestCandidate(manifest.candidate);
    if(!manifest.source) fail('SOURCE_IDENTITY_REQUIRED');
    const {executeBackupVerification}=await import('./execution.mjs');
    return JSON.stringify(await executeBackupVerification({manifestPath:values.manifest,repositoryRoot,candidate:manifest.candidate,directory:values.backup,privateKeyPath:values['private-key'],expectedDescriptorSha256:values['descriptor-sha256']}))+'\n';
  }
  if (command === 'validate-receipt') {
    const values = argumentsFor(rest, ['receipt', 'sha256', 'expected', 'evidence']);
    const bytes = await privateBytes(values.receipt);
    if (!/^[a-f0-9]{64}$/u.test(values.sha256) || createHash('sha256').update(bytes).digest('hex') !== values.sha256) fail('RECEIPT_HASH_MISMATCH');
    const expected = JSON.parse((await privateBytes(values.expected)).toString('utf8'));
    await assertPrivatePath(join(values.evidence, 'boundary'), repositoryRoot);
    const directory = await statAsync(values.evidence);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o777) !== 0o700) fail('PRIVATE_FILE_MODE_REQUIRED');
    const { createOperationsEvidenceReader, validateOperationsReadiness } = await import('./readiness.mjs');
    const errors = validateOperationsReadiness(JSON.parse(bytes.toString('utf8')), { expected, requireCurrentBackupRehearsal: true,
      readEvidence: createOperationsEvidenceReader(values.evidence, repositoryRoot) });
    if (errors.length) fail('READINESS_EVIDENCE_INVALID');
    return JSON.stringify({ status: 'RECEIPT_CONTRACT_VALID', receiptSha256: values.sha256 }) + '\n';
  }
  fail('ARGUMENTS_INVALID');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(await runCli(process.argv.slice(2))); }
  catch (error) {
    console.error(error instanceof OperationsError ? error.message : 'Issue #29: VERIFICATION_FAILED');
    process.exitCode = 2;
  }
}
