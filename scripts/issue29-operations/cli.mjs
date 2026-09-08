import { constants } from 'node:fs';
import { open as openAsync, lstat as statAsync } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensure, assertPrivatePath, readPrivateManifest, OperationsError } from './manifest.mjs';

const repositoryRoot = resolve(import.meta.dirname, '../..');
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
  if (command === '--help' && rest.length === 0) return 'Issue #29 exact-target operations:\n  preflight | create-source | seed-source | verify-source | create-target --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  prepare-worker | deploy-worker | cleanup-worker | update-worker --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  implementation-verified | adopt-merged-release | generate-receipt --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  authorize-maintenance | pause-source | resume-source | verify-source-resumed --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  synthetic-jobs --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  cleanup --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  configure-monitoring | monitoring-proof | incident-drill | maintenance-silence | maintenance-unsilence --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  capture-source-session --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  copy-backup --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  backup-set --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  restore --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  verify-restore --manifest=ABSOLUTE_PATH --settings=ABSOLUTE_PATH\n  verify-backup --manifest=ABSOLUTE_PATH --backup=ABSOLUTE_PATH --private-key=ABSOLUTE_PATH --descriptor-sha256=HASH\n  validate-receipt --receipt=ABSOLUTE_PATH --sha256=HASH --expected=ABSOLUTE_PATH --evidence=ABSOLUTE_DIRECTORY\nBackup requires current manifest-owned synthetic source and live exact release readback. All provider mutations require exact scoped private capabilities and persisted intent; no command claims hosted acceptance from local fixtures.\n';
  if(command==='generate-receipt'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeGenerateOperationsReceipt}=await import('./verification-execution.mjs');
    return JSON.stringify(await executeGenerateOperationsReceipt({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if(command==='implementation-verified'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeImplementationVerification}=await import('./verification-execution.mjs');
    return JSON.stringify(await executeImplementationVerification({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if(command==='adopt-merged-release'){
    const values=argumentsFor(rest,['manifest','settings']);const value=JSON.parse((await privateBytes(values.settings)).toString());
    ensure(value?.schemaVersion===1&&value.operation===command&&Object.keys(value).every(k=>['schemaVersion','operation','settings','evidenceDirectory'].includes(k))&&value.settings&&typeof value.evidenceDirectory==='string','PRIVATE_SETTINGS_INVALID');
    const {executeAdoptMergedRelease}=await import('./worker-adapter.mjs');
    const proof=await executeAdoptMergedRelease({manifestPath:values.manifest,repositoryRoot,settings:value.settings,evidenceDirectory:value.evidenceDirectory});
    return JSON.stringify({status:'PROTECTED_MERGE_READBACK_VERIFIED',mergeSha:proof.mergeSha,treeSha:proof.treeSha})+'\n';
  }
  if(['configure-monitoring','monitoring-proof','incident-drill','maintenance-silence','maintenance-unsilence'].includes(command)){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const settings=JSON.parse((await privateBytes(values.settings)).toString());ensure(settings?.operation===command,'SETTINGS_OPERATION_MISMATCH');
    const {executeMonitoringAction}=await import('./monitoring-execution.mjs');
    const result=await executeMonitoringAction({manifestPath:values.manifest,repositoryRoot,candidate:manifest.candidate,settings});
    return JSON.stringify({status:result.status??'MONITORING_COMMAND_COMPLETED',runId:manifest.runId,operation:command,phase:result.phase,state:result.state,evidenceSha256:result.evidenceSha256})+'\n';
  }
  if(command==='capture-source-session'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeSourceSessionCapture}=await import('./auth-execution.mjs');
    return JSON.stringify(await executeSourceSessionCapture({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if (['preflight','create-source','create-target','verify-source'].includes(command)) {
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeHostedLifecycle}=await import('./hosted-execution.mjs');
    return JSON.stringify(await executeHostedLifecycle({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate,operation:command}))+'\n';
  }
  if(command==='synthetic-jobs'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeSyntheticJobsCommand}=await import('./synthetic-jobs.mjs');
    const proof=await executeSyntheticJobsCommand({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate,operation:'synthetic-jobs'});
    return JSON.stringify({status:'SYNTHETIC_JOBS_READBACK_VERIFIED',runId:manifest.runId,role:proof.role,mode:proof.mode,evidenceSha256:proof.evidenceSha256})+'\n';
  }
  if(command==='seed-source'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeSeedSource}=await import('./source-execution.mjs');
    return JSON.stringify(await executeSeedSource({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if(['prepare-worker','deploy-worker','cleanup-worker','update-worker'].includes(command)){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const value=JSON.parse((await privateBytes(values.settings)).toString());
    ensure(value?.schemaVersion===1&&value.operation===command&&Object.keys(value).every(k=>['schemaVersion','operation','settings','secrets','privateDirectory','readToken','deployToken','cleanupToken','deployCapabilityId','cleanupCapabilityId','previousPrivateDirectory'].includes(k)),'PRIVATE_SETTINGS_INVALID');
    const {prepareIssue29Worker,executeDeployWorker,executeCleanupWorker,executeUpdateSourceWorker}=await import('./worker-adapter.mjs');
    if(command==='prepare-worker'){
      ensure(value.settings&&value.secrets&&typeof value.privateDirectory==='string','PRIVATE_SETTINGS_INVALID');
      const result=await prepareIssue29Worker({manifest,repositoryRoot,settings:value.settings,secrets:value.secrets,privateDirectory:value.privateDirectory});
      return JSON.stringify({status:'PRIVATE_WORKER_BUILD_PREPARED',workerName:result.workerName,configSha256:result.configSha256,buildSha256:result.buildSha256})+'\n';
    }
    ensure(value.secrets===undefined,'PRIVATE_SETTINGS_INVALID');
    const {schemaVersion:_,operation:__,...settings}=value;
    if(command==='update-worker')ensure(typeof settings.previousPrivateDirectory==='string','PRIVATE_SETTINGS_INVALID');
    const result=await(command==='update-worker'?executeUpdateSourceWorker:command==='deploy-worker'?executeDeployWorker:executeCleanupWorker)({...settings,manifestPath:values.manifest,repositoryRoot});
    return JSON.stringify(result)+'\n';
  }
  if(['authorize-maintenance','pause-source','resume-source','verify-source-resumed'].includes(command)){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeMaintenanceCommand}=await import('./maintenance-execution.mjs');
    return JSON.stringify(await executeMaintenanceCommand({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate,operation:command}))+'\n';
  }
  if(command==='cleanup'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const settings=JSON.parse((await privateBytes(values.settings)).toString());
    if(settings.action==='finalize'){const {executeFinalizeCleanup}=await import('./verification-execution.mjs');return JSON.stringify(await executeFinalizeCleanup({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';}
    const {executeProjectCleanup}=await import('./cleanup-execution.mjs');
    return JSON.stringify(await executeProjectCleanup({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if(command==='copy-backup'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    const {executeBackupCopy}=await import('./execution.mjs');
    return JSON.stringify(await executeBackupCopy({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if (command === 'backup-set') {
    const values=argumentsFor(rest,['manifest','settings']);
    const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});
    attestCandidate(manifest.candidate);
    const {executeBackupSet}=await import('./execution.mjs');
    return JSON.stringify(await executeBackupSet({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';
  }
  if(command==='restore'||command==='verify-restore'){
    const values=argumentsFor(rest,['manifest','settings']);const manifest=await readPrivateManifest(values.manifest,{repositoryRoot});attestCandidate(manifest.candidate);
    if(command==='verify-restore'){const settings=JSON.parse((await privateBytes(values.settings)).toString());if(settings.operation==='verify-isolation'){const {executeIsolationVerification}=await import('./hosted-execution.mjs');return JSON.stringify(await executeIsolationVerification({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate,operation:'verify-isolation'}))+'\n';}if(settings.operation==='verify-application'){const {executeApplicationProof}=await import('./application-execution.mjs');return JSON.stringify(await executeApplicationProof({manifestPath:values.manifest,settingsPath:values.settings,repositoryRoot,candidate:manifest.candidate}))+'\n';}}
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
