import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ensure, OperationsError, readPrivateManifest } from './manifest.mjs';
import { readPrivateBytes } from './execution.mjs';
import { canonicalJson } from './recovery-set.mjs';
import { createSupabaseOperationsAdapter } from './supabase-adapter.mjs';
import { executeProjectLifecycleStep } from './operator.mjs';
import { captureManagedBaseline, validateDatabaseConnection } from './logical-recovery.mjs';
import { readSeededSourceEvidence } from './source-execution.mjs';
import { verifySyntheticSource } from './synthetic-source.mjs';
import { readSourceReleaseBinding } from './source-binding.mjs';
const secret=z.string().min(10).max(4096).regex(/^[^\r\n]+$/u);
const databaseCoordinates=z.strictObject({host:z.string().min(1).max(255),port:z.literal(5432),database:z.literal('postgres'),user:z.string().min(1).max(128),sslmode:z.literal('verify-full'),sslRootCert:z.enum(['system','supabase-prod-2021']).optional()});
const schema=z.strictObject({schemaVersion:z.literal(1),operation:z.enum(['preflight','create-source','create-target','verify-source']),providerToken:secret,
 capability:z.strictObject({role:z.enum(['source-read','restore-write']),id:z.string().min(1).max(128)}),
 twoSlotAuthorization:z.strictObject({schemaVersion:z.literal(1),policy:z.literal('supabase-free-two-active-projects'),organizationId:z.string(),preservedStagingRef:z.string().regex(/^[a-z]{20}$/u),authorizedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),maximumActiveProjects:z.literal(2),maximumCost:z.literal(0),evidenceSha256:z.string().regex(/^[a-f0-9]{64}$/u)}).optional(),databasePasswords:z.strictObject({source:secret.optional(),target:secret.optional()}).optional(),
 databaseConnections:z.strictObject({source:databaseCoordinates.optional(),target:databaseCoordinates.optional()}).optional(),
 ownerSourceAuthorization:z.strictObject({schemaVersion:z.literal(1),policy:z.literal('issue29-owner-authorized-pending-source-readback'),runId:z.string().uuid(),operationId:z.string().uuid(),organizationId:z.string().min(1).max(63),projectRef:z.string().regex(/^[a-z]{20}$/u),region:z.string().min(1).max(63),sourceName:z.string().min(1).max(128),observedCreatedAt:z.iso.datetime(),authorizedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),evidenceSha256:z.string().regex(/^[a-f0-9]{64}$/u),originalIntentSha256:z.string().regex(/^[a-f0-9]{64}$/u)}).optional(),
 verification:z.strictObject({seedSettingsPath:z.string(),bindingSettingsPath:z.string()}).optional()});
/** @param {unknown} value */
const digest=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
/** @param {string} path @param {string} repositoryRoot */
export async function readLifecycleSettings(path,repositoryRoot){
 try{const parsed=schema.safeParse(JSON.parse((await readPrivateBytes(path,repositoryRoot)).toString()));ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');return parsed.data;}
 catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('PRIVATE_SETTINGS_INVALID');}
}
/** Select one exact supported hosted database endpoint; the recovery engine validates the
 * direct or session-pooler host/user pair against the manifest-bound project ref. */
/** @param {{runId:string,ref:string,sourceRef:string,preservedRefs:string[],createdResourceEvidenceSha256:string,url:string}} project @param {'source'|'target'} purpose @param {string} password @param {{host:string,port:5432,database:'postgres',user:string,sslmode:'verify-full',sslRootCert?:'system'|'supabase-prod-2021'}|undefined} configured */
export function lifecycleDatabaseConnection(project, purpose, password, configured) {
 const scope={mode:/** @type {const} */('hosted'),role:purpose,runId:project.runId,projectRef:project.ref,sourceRef:project.sourceRef,preservedRefs:project.preservedRefs,createdResourceEvidenceSha256:project.createdResourceEvidenceSha256,apiUrl:project.url};
 const coordinates=configured??{host:`db.${project.ref}.supabase.co`,port:5432,database:'postgres',user:'postgres',sslmode:/** @type {const} */('verify-full'),sslRootCert:/** @type {const} */('system')};
 return validateDatabaseConnection(scope,{...coordinates,password,sslRootCert:coordinates.sslRootCert??'system'});
}
/** @typedef {{manifestPath:string,settingsPath:string,repositoryRoot:string,candidate:import('./manifest.mjs').Candidate,operation:string,now?:string,clock?:()=>string}} HostedOptions */
/** Construct the real provider boundary; CLI accepts no injected SQL, URLs, or executable callbacks.
 * @param {HostedOptions} options
 * @param {{adapterFactory?:typeof createSupabaseOperationsAdapter,baseline?:typeof captureManagedBaseline}} [dependencies]
 */
export async function executeHostedLifecycle(options,dependencies={}){
 const {manifestPath,repositoryRoot,candidate}=options;const clock=options.clock??(()=>options.now??new Date().toISOString());
 const settings=await readLifecycleSettings(options.settingsPath,repositoryRoot);
 ensure(settings.operation===options.operation,'SETTINGS_OPERATION_MISMATCH');
 const manifest=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()});
 const ownerSourceAuthorization=settings.ownerSourceAuthorization;
 if(ownerSourceAuthorization)ensure(settings.operation==='create-source'&&manifest.state==='source_creation_pending'&&manifest.pending?.step==='create-source'&&manifest.pending.operationId===ownerSourceAuthorization.operationId&&manifest.source===null&&manifest.target===null,'OWNER_SOURCE_AUTHORIZATION_READBACK_ONLY');
 const role=settings.operation.startsWith('create-')?'restore-write':'source-read';
 ensure(settings.capability.role===role&&settings.capability.id===manifest.capabilityIds[role],'CREDENTIAL_ROLE_MISMATCH');
 ensure(manifest.allowedActions.includes(settings.operation)&&manifest.humanBoundary===null&&manifest.terminal===null,'ACTION_FORBIDDEN');
 const purpose=settings.operation==='create-target'?'target':'source';
 const password=settings.databasePasswords?.[purpose];
 if(settings.operation.startsWith('create-'))ensure(password&&password.length>=32,'PROJECT_PASSWORD_REQUIRED');
 const adapter=(dependencies.adapterFactory??createSupabaseOperationsAdapter)({token:settings.providerToken,clock,
  ...(settings.twoSlotAuthorization?{twoSlotAuthorization:settings.twoSlotAuthorization}:{}),
  ...(ownerSourceAuthorization?{ownerSourceAuthorization}:{}),
  databasePassword:async selected=>{ensure(selected===purpose&&password,'CREDENTIAL_ROLE_MISMATCH');return password;},
  inspectEmpty:async project=>{
   ensure(project.organizationId===manifest.provisioning.organizationId&&project.region===manifest.provisioning.region&&!manifest.forbiddenRefs.includes(project.ref)&&!manifest.preservedRefs.includes(project.ref)&&project.environment===(purpose==='source'?'synthetic':'disposable'),'TARGET_FORBIDDEN');
   ensure(password,'PROJECT_PASSWORD_REQUIRED');
   // The provider adapter establishes exact project identity before this read-only empty-state check.
   const sourceRef=manifest.source?.ref??project.ref,createdResourceEvidenceSha256=digest({runId:manifest.runId,project,operation:settings.operation});
   const connection=lifecycleDatabaseConnection({runId:manifest.runId,ref:project.ref,sourceRef,preservedRefs:manifest.preservedRefs,createdResourceEvidenceSha256,url:project.url},purpose,password,settings.databaseConnections?.[purpose]);
   await(dependencies.baseline??captureManagedBaseline)({scope:{mode:'hosted',role:purpose,runId:manifest.runId,projectRef:project.ref,sourceRef,preservedRefs:manifest.preservedRefs,createdResourceEvidenceSha256,apiUrl:project.url},connection,toolchain:{mode:'container'}});
   return true;
  }});
 const result=await executeProjectLifecycleStep({manifestPath,repositoryRoot,candidate,step:settings.operation,clock,...(ownerSourceAuthorization?{ownerSourceAuthorization}:{}),adapter:{...adapter,verifySource:async({manifest:current})=>{
  ensure(settings.verification&&current.source,'SOURCE_VERIFICATION_SETTINGS_REQUIRED');
  const {readSourceSettings}=await import('./source-execution.mjs');
  const seed=await readSourceSettings(settings.verification.seedSettingsPath,repositoryRoot);
  const evidence=await readSeededSourceEvidence({manifest:current,privateDirectory:seed.privateDirectory,repositoryRoot});
  const binding=JSON.parse((await readPrivateBytes(settings.verification.bindingSettingsPath,repositoryRoot)).toString());
  const release=await readSourceReleaseBinding({manifest:current,settings:binding,now:clock()});
  const owned=current.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===current.source?.ref&&r.absentAt===null);
  ensure(owned&&seed.source.apiUrl===current.source.url,'SOURCE_OWNERSHIP_UNPROVEN');
  const provenance=await verifySyntheticSource({scope:{mode:'hosted',role:'source',runId:current.runId,projectRef:current.source.ref,sourceRef:current.source.ref,preservedRefs:current.preservedRefs,createdResourceEvidenceSha256:owned.evidenceSha256,apiUrl:current.source.url},connection:seed.connection,toolchain:seed.toolchain,managedBaseline:evidence.managedBaseline,secretKey:seed.source.serviceKey});
  ensure(digest(provenance)===evidence.summary.inventorySha256,'SOURCE_PROVENANCE_DRIFT');
  const proof={fixtureRunId:current.runId,fixtureManifestSha256:evidence.summary.fixtureManifestSha256,inventorySha256:digest(provenance),releaseBindingSha256:release.evidenceSha256};
  return{...proof,evidence:proof,evidenceSha256:digest(proof)};
 }} });
 return{status:'LIFECYCLE_READBACK_VERIFIED',state:result.state,operation:settings.operation,runId:result.runId,evidenceSha256:result.history.at(-1)?.evidenceSha256};
}

const isolationSchema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('verify-isolation'),providerToken:secret,capabilityId:z.string(),twoSlotAuthorization:schema.shape.twoSlotAuthorization.unwrap(),sourcePrivateDirectory:z.string(),targetBinding:z.unknown(),
 sourceWorker:z.strictObject({settings:z.unknown(),privateDirectory:z.string(),readToken:secret}),targetWorker:z.strictObject({settings:z.unknown(),privateDirectory:z.string(),readToken:secret}),
 preserved:z.strictObject({canonicalStagingRef:z.string().regex(/^[a-z]{20}$/u),productionRefs:z.array(z.string().regex(/^[a-z]{20}$/u)).max(100),historicalRefs:z.array(z.string().regex(/^[a-z]{20}$/u)).max(100)})});
/** Exact read-only isolation proof while the source is paused and the separate target is active.
 * Roles of preserved projects come from the explicit owner environment map; their identities and
 * unchanged exclusion from this transaction are independently checked, never reclassified synthetic.
 * @param {HostedOptions} options
 * @param {{adapterFactory?:typeof createSupabaseOperationsAdapter,workerBinding?:typeof import('./worker-adapter.mjs').readIssue29WorkerBinding,targetBinding?:typeof import('./source-binding.mjs').readTargetReleaseBinding,seedEvidence?:typeof readSeededSourceEvidence}} [dependencies] */
export async function executeIsolationVerification(options,dependencies={}){
 const {manifestPath,repositoryRoot,candidate}=options,clock=options.clock??(()=>options.now??new Date().toISOString());
 const {constants}=await import('node:fs'),{open,unlink,readFile}=await import('node:fs/promises'),{dirname,join}=await import('node:path');const {assertPrivatePath,writePrivateManifest}=await import('./manifest.mjs');const {persistOperationsEvidence}=await import('./operator.mjs');
 let parsed;try{parsed=isolationSchema.safeParse(JSON.parse((await readPrivateBytes(options.settingsPath,repositoryRoot)).toString()));}catch{throw new OperationsError('PRIVATE_SETTINGS_INVALID');}ensure(parsed.success,'PRIVATE_SETTINGS_INVALID');const settings=parsed.data;
 await assertPrivatePath(manifestPath,repositoryRoot);let lock;try{lock=await open(manifestPath+'.lock',constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}catch{throw new OperationsError('TRANSACTION_LOCKED_INSPECT_BEFORE_RESUMING');}
 try{
  const m=await readPrivateManifest(manifestPath,{repositoryRoot,candidate,now:clock()}),source=m.source,target=m.target;
  ensure(source&&target&&source.ref!==target.ref&&!m.preservedRefs.includes(source.ref)&&!m.preservedRefs.includes(target.ref)&&!m.forbiddenRefs.includes(target.ref),'TARGET_FORBIDDEN');
  ensure(settings.capabilityId===m.capabilityIds['source-read']&&m.allowedActions.includes('verify-restore')&&!m.pending&&!m.terminal&&!m.humanBoundary&&m.maintenance?.phase==='paused'&&['storage_restored','integrity_verified','incident_drill_verified'].includes(m.state),'ISOLATION_SCOPE_FORBIDDEN');
  for(const [id,disposition]of [[source.ref,'persistent'],[target.ref,'disposable']])ensure(m.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===id&&r.runId===m.runId&&r.disposition===disposition&&r.absentAt===null),'ISOLATION_OWNERSHIP_REQUIRED');
  for(const project of [source,target]){const owned=m.cleanup.resources.find(r=>r.provider==='supabase'&&r.id===project.ref);ensure(owned,'ISOLATION_OWNERSHIP_REQUIRED');const bytes=await readPrivateBytes(join(dirname(manifestPath),owned.evidenceSha256+'.json'),repositoryRoot);ensure(createHash('sha256').update(bytes).digest('hex')===owned.evidenceSha256,'CREATION_EVIDENCE_MISMATCH');const creation=JSON.parse(bytes.toString());const ownerAuthorizedSource=project.ref===source.ref&&creation.kind==='issue29-supabase-owner-authorized-source';ensure((creation.kind==='issue29-supabase-created'||ownerAuthorizedSource)&&creation.runId===m.runId&&creation.project?.ref===project.ref&&creation.empty===true,'ISOLATION_FOREIGN_STATE_UNPROVEN');}
  const mapped=[settings.preserved.canonicalStagingRef,...settings.preserved.productionRefs,...settings.preserved.historicalRefs];ensure(mapped.length===m.preservedRefs.length&&new Set(mapped).size===mapped.length&&mapped.every(ref=>m.preservedRefs.includes(ref))&&settings.preserved.canonicalStagingRef===settings.twoSlotAuthorization.preservedStagingRef,'PRESERVED_INVENTORY_MISMATCH');
  const canonicalConfig=JSON.parse(await readFile(join(repositoryRoot,'wrangler.jsonc'),'utf8'));ensure(canonicalConfig.env?.staging?.vars?.PUBLIC_SUPABASE_URL===`https://${settings.preserved.canonicalStagingRef}.supabase.co`,'CANONICAL_STAGING_BINDING_MISMATCH');
  const adapter=(dependencies.adapterFactory??createSupabaseOperationsAdapter)({token:settings.providerToken,clock,twoSlotAuthorization:settings.twoSlotAuthorization});
  const context={manifest:m,operationId:m.runId,purpose:/** @type {const} */('target')},preflight=await adapter.preflight(context);ensure(preflight.plan==='free'&&preflight.quotedCost===0&&preflight.projectLimit===2&&preflight.activeProjectCount===2&&preflight.availableProjects===0,'ISOLATION_TWO_SLOT_STATE_MISMATCH');
  const expectedRefs=[...m.preservedRefs,source.ref,target.ref].sort();ensure(canonicalJson(preflight.inventoryRefs)===canonicalJson(expectedRefs)&&preflight.evidence,'ISOLATION_INVENTORY_UNPROVEN');
  await persistOperationsEvidence(manifestPath,repositoryRoot,preflight.evidence,preflight.evidenceSha256);
  const paused=await adapter.readPaused({manifest:m,operationId:m.runId,purpose:'source'});ensure(paused.status==='INACTIVE'&&paused.project.ref===source.ref&&paused.evidence,'SOURCE_PAUSE_UNPROVEN');await persistOperationsEvidence(manifestPath,repositoryRoot,paused.evidence,paused.evidenceSha256);
  const {readIssue29WorkerBinding}=await import('./worker-adapter.mjs'),{readTargetReleaseBinding}=await import('./source-binding.mjs');
  const sourceWorker=await(dependencies.workerBinding??readIssue29WorkerBinding)({manifest:m,...settings.sourceWorker,repositoryRoot}),targetWorker=await(dependencies.workerBinding??readIssue29WorkerBinding)({manifest:m,...settings.targetWorker,repositoryRoot});
  ensure(sourceWorker.purpose==='source'&&sourceWorker.projectRef===source.ref&&targetWorker.purpose==='target'&&targetWorker.projectRef===target.ref&&sourceWorker.accountId===targetWorker.accountId&&sourceWorker.origin!==targetWorker.origin,'ISOLATION_WORKER_BINDING_MISMATCH');
  const binding=await(dependencies.targetBinding??readTargetReleaseBinding)({manifest:m,settings:/** @type {import('./source-binding.mjs').BindingSettings} */(settings.targetBinding),now:clock()});ensure(binding.targetRef===target.ref,'TARGET_BINDING_IDENTITY_MISMATCH');
  const sourceSecret=JSON.parse((await readPrivateBytes(join(settings.sourceWorker.privateDirectory,'worker-source.secrets.json'),repositoryRoot)).toString()),targetSecret=JSON.parse((await readPrivateBytes(join(settings.targetWorker.privateDirectory,'worker-target.secrets.json'),repositoryRoot)).toString());
  for(const name of ['SUPABASE_SECRET_KEY','OPERATIONS_MONITOR_TOKEN'])ensure(typeof sourceSecret[name]==='string'&&sourceSecret[name].length>=32&&typeof targetSecret[name]==='string'&&targetSecret[name].length>=32&&sourceSecret[name]!==targetSecret[name],'SHARED_ENVIRONMENT_CREDENTIAL_FORBIDDEN');
  ensure(targetSecret.SUPABASE_SECRET_KEY===/** @type {import('./source-binding.mjs').BindingSettings} */(settings.targetBinding).source.serviceKey,'TARGET_STORAGE_CREDENTIAL_MISMATCH');
  const seed=await(dependencies.seedEvidence??readSeededSourceEvidence)({manifest:m,privateDirectory:settings.sourcePrivateDirectory,repositoryRoot});ensure(seed.summary.inventorySha256===m.sourceProvenance?.inventorySha256,'SOURCE_PROVENANCE_DRIFT');
  const quarantine=m.history.find(h=>h.step==='quarantine'&&h.resourceId===target.ref);ensure(quarantine,'QUARANTINE_EVIDENCE_REQUIRED');const raw=await readPrivateBytes(join(dirname(manifestPath),quarantine.evidenceSha256+'.json'),repositoryRoot);ensure(createHash('sha256').update(raw).digest('hex')===quarantine.evidenceSha256,'QUARANTINE_EVIDENCE_MISMATCH');const q=JSON.parse(raw.toString());ensure(q.provider?.projectRef===target.ref&&q.provider.runId===m.runId&&q.provider.targetWorkerResourcesAbsent===true&&q.provider.customSmtp===false&&q.provider.edgeFunctionCount===0&&q.provider.enabledAuthHookCount===0,'QUARANTINE_EVIDENCE_MISMATCH');
  const sourceWorkerSha256=digest(sourceWorker),targetWorkerSha256=digest(targetWorker);await persistOperationsEvidence(manifestPath,repositoryRoot,sourceWorker,sourceWorkerSha256);await persistOperationsEvidence(manifestPath,repositoryRoot,targetWorker,targetWorkerSha256);
  const proof={schemaVersion:1,kind:'issue29-environment-isolation',evidenceMode:Object.keys(dependencies).length?'deterministic-http-fixture':'provider-readback',runId:m.runId,candidate,sourceRef:source.ref,targetRef:target.ref,checkedAt:clock(),preserved:{canonicalStagingRef:settings.preserved.canonicalStagingRef,productionRefs:settings.preserved.productionRefs,forbiddenRefs:[...new Set([...m.forbiddenRefs,...m.preservedRefs])].sort()},classificationBasis:'owner-environment-map-and-live-identity-readback',sourceProvenanceSha256:seed.summary.inventorySha256,providerPreflightSha256:preflight.evidenceSha256,sourcePausedSha256:paused.evidenceSha256,quarantineSha256:quarantine.evidenceSha256,sourceWorkerSha256,targetWorkerSha256,productionReadOnly:true,sourceSyntheticVerified:true,targetDedicatedVerified:true,noForeignStateVerified:true,noSharedCredentialsVerified:true};
  const evidenceSha256=digest(proof);await persistOperationsEvidence(manifestPath,repositoryRoot,proof,evidenceSha256);m.history.push({step:'verify-restore',operationId:randomUUID(),resourceId:`isolation:${target.ref}`,completedAt:proof.checkedAt,evidenceSha256});await writePrivateManifest(manifestPath,m,{repositoryRoot,candidate,now:clock(),replace:true});return{status:'ENVIRONMENT_ISOLATION_VERIFIED',runId:m.runId,evidenceSha256};
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('ISOLATION_VERIFICATION_FAILED');}finally{await lock.close();await unlink(manifestPath+'.lock');}
}
