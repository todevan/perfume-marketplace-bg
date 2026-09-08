import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { canonicalJson } from '../../scripts/issue29-operations/recovery-set.mjs';
import { executeBackupSet } from '../../scripts/issue29-operations/execution.mjs';
import { manifestFixture, candidate } from '../fixtures/issue29-operations';
import { readPrivateManifest, writePrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
const dirs:string[]=[];const now='2026-09-05T12:01:00.000Z';
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const {publicKey}=generateKeyPairSync('rsa',{modulusLength:3072});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'issue29-execution-test-'));dirs.push(dir);const manifest=manifestFixture();manifest.state='monitoring_proved';manifest.target=null;manifest.allowedActions.push('synthetic-jobs');
 manifest.backup.publicKeyId=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
 manifest.cleanup.resources.push({provider:'supabase',id:manifest.source!.ref,runId:manifest.runId,createdAt:'2026-09-05T12:00:00.000Z',evidenceSha256:'d'.repeat(64),disposition:'persistent',absentAt:null});
 const jobs={schemaVersion:1,runId:manifest.runId,projectRef:manifest.source!.ref,role:'source',mode:'quiesced',checkedAt:now,priorState:[],state:[],proof:[]};const jobsBytes=canonicalJson(jobs),jobsHash=createHash('sha256').update(jobsBytes).digest('hex');await writeFile(join(dir,jobsHash+'.json'),jobsBytes,{mode:0o600});manifest.history.push({step:'synthetic-jobs',resourceId:'source-jobs',operationId:manifest.runId,completedAt:now,evidenceSha256:jobsHash});
 const manifestPath=join(dir,'manifest.json');await writePrivateManifest(manifestPath,manifest,{repositoryRoot:process.cwd(),now});
 const baseline={schemaSql:'-- base',roleNames:[],schemaSha256:createHash('sha256').update('-- base').digest('hex'),postgresVersion:'17.6'};
 const settings={schemaVersion:1,operation:'backup-set',providerToken:'private-provider-token',source:{apiUrl:manifest.source!.url,serviceKey:'private-service-key'},deployment:{accountId:'c'.repeat(32),workerName:`issue29-${manifest.runId}`,versionId:candidate.deploymentId,origin:`https://issue29-${manifest.runId}.owner.workers.dev`,readToken:'private-read-token'},connection:{host:`db.${manifest.source!.ref}.supabase.co`,port:5432,database:'postgres',user:'postgres',password:'private-password',sslmode:'verify-full'},toolchain:{mode:'container'},managedBaseline:{path:join(dir,'baseline.json'),sha256:baseline.schemaSha256},ownerPublicKeyPath:join(dir,'public.pem'),privateDirectory:dir,outputDirectory:join(dir,'set')};
 await writeFile(settings.ownerPublicKeyPath,publicKey.export({type:'spki',format:'pem'}),{mode:0o600});await writeFile(settings.managedBaseline.path,JSON.stringify(baseline),{mode:0o600});
 const settingsPath=join(dir,'settings.json');await writeFile(settingsPath,JSON.stringify(settings),{mode:0o600});return{dir,manifest,manifestPath,settingsPath,settings};
}
it('rejects preserved or unowned source before any export',async()=>{
 const f=await fixture();f.manifest.cleanup.resources=[];await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:process.cwd(),now,replace:true});const binding=vi.fn();
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},{binding})).rejects.toThrow('SOURCE_PROVENANCE_UNPROVEN');expect(binding).not.toHaveBeenCalled();
});
it('persists one export intent, closes ambiguous attempts to repeat exports, and sanitizes underlying failures',async()=>{
 const f=await fixture();let attempts=0;
 const deps={binding:vi.fn(async()=>({evidenceSha256:'d'.repeat(64)})),exportDatabase:vi.fn(async()=>{attempts++;const m=await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now});expect(m.pending?.step).toBe('backup-set');throw new Error('private-password');})};
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},deps)).rejects.toThrow('BACKUP_EXPORT_FAILED_INSPECT_PRIVATE_STATE');
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},deps)).rejects.toThrow('BACKUP_PUBLICATION_READBACK_REQUIRED');expect(attempts).toBe(1);
});
it('rejects an owner public-key mismatch before source read',async()=>{
 const f=await fixture();f.manifest.backup.publicKeyId='c'.repeat(64);await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:process.cwd(),now,replace:true});const binding=vi.fn();
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},{binding})).rejects.toThrow('OWNER_PUBLIC_KEY_MISMATCH');expect(binding).not.toHaveBeenCalled();
});

it('publishes and re-reads real ciphertext components, not a claimed backup receipt',async()=>{
 const f=await fixture();const checkpoint={snapshotId:'00000003-00000001-1',finalizedRowsetSha256:'d'.repeat(64)};
 const components=new Map(['roles.sql','schema.sql','data.sql','migration-history.sql','auth-recovery.sql','managed-schema.sql','platform-inventory.json'].map(name=>[name,Buffer.from(`synthetic-${name}`)]));
 const exportDatabase=vi.fn(async({onSnapshot}:any)=>({components,checkpointBefore:checkpoint,checkpointAfter:checkpoint,migration:{count:27,sha256:'e'.repeat(64)},inventory:{exclusions:['auth-sessions','runtime-secrets']},storage:await onSnapshot({photos:[],checkpoint})}));
 const exportStorage=vi.fn(async()=>({components:new Map(),storageManifest:{bucket:'listing-images',files:[]},bucketInventory:[],finalizedRowsetSha256:checkpoint.finalizedRowsetSha256,objectCount:0,totalBytes:0,pathTreeSha256:'f'.repeat(64)}));
 const deps={binding:vi.fn(async()=>({})),exportDatabase,exportStorage};
 const result=await executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},deps as any);
 const manifest=await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now});
 expect(manifest.state).toBe('backup_started');expect(manifest.pending).toBeNull();expect(manifest.backupVerification).toBeNull();expect(manifest.history.at(-1)?.evidenceSha256).toBe(result.descriptorSha256);
 expect([...components.values()].every(b=>b.every(v=>v===0))).toBe(true);
 expect(await executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},deps as any)).toEqual(result);expect(exportDatabase).toHaveBeenCalledTimes(1);
 await writeFile(join(f.settings.outputDirectory,'component-000000.bin'),Buffer.from('corrupt'),{mode:0o600});
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},deps as any)).rejects.toThrow();expect(exportDatabase).toHaveBeenCalledTimes(1);
});

it('records private-key recovery separately after authenticating the entire recovery set',async()=>{
 const f=await fixture();const {createRecoverySet}=await import('../../scripts/issue29-operations/recovery-set.mjs');const {executeBackupVerification}=await import('../../scripts/issue29-operations/execution.mjs');
 const keys=generateKeyPairSync('rsa',{modulusLength:3072});f.manifest.backup.publicKeyId=createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex');
 const checkpoint={snapshotId:'00000003-00000001-1',finalizedRowsetSha256:'d'.repeat(64)};
 const created=await createRecoverySet({destination:f.settings.outputDirectory,repositoryRoot:process.cwd(),publicKey:keys.publicKey,components:new Map(['roles.sql','schema.sql','data.sql','migration-history.sql','auth-recovery.sql','managed-schema.sql','platform-inventory.json'].map(name=>[name,Buffer.from(`synthetic-${name}`)])),storageManifest:{bucket:'listing-images',files:[]},checkpointBefore:checkpoint,checkpointAfter:checkpoint,metadata:{backupSetId:f.manifest.runId,source:{environmentAlias:f.manifest.fixture.alias,organizationId:f.manifest.source!.organizationId,projectRef:f.manifest.source!.ref,region:f.manifest.source!.region,classification:f.manifest.source!.classification},release:{commitSha:candidate.sha,treeSha:candidate.tree,workerVersion:candidate.deploymentId},startedAt:'2026-09-05T12:00:00.000Z',finishedAt:now,tools:{supabaseCli:'2.109.1',postgres:'17.6',operator:'issue29-v2'},migration:{count:27,sha256:'e'.repeat(64)},destinationAlias:f.manifest.backup.destinationAlias,exclusions:['auth-sessions'],manualReconstruction:['runtime-secrets']}});
 f.manifest.state='backup_started';f.manifest.history.push({step:'backup-set',operationId:f.manifest.runId,completedAt:now,evidenceSha256:created.descriptorSha256,resourceId:null});await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:process.cwd(),now,replace:true});
 const privateKeyPath=join(f.dir,'owner-private.pem');await writeFile(privateKeyPath,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 const result=await executeBackupVerification({manifestPath:f.manifestPath,repositoryRoot:process.cwd(),candidate,directory:f.settings.outputDirectory,expectedDescriptorSha256:created.descriptorSha256,privateKeyPath,now});expect(result.decryptionVerified).toBe(true);expect(result.recoveryPointAgeSeconds).toBe(60);
 const m=await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now});expect(m.backupVerification).toEqual({descriptorSha256:created.descriptorSha256,independentlyVerifiedAt:now,sourceReadsComplete:true});
 expect(result.decryptionVerified).toBe(true);
 const record=m.history.find(h=>h.step==='verify-backup');expect(record?.resourceId).toBe(created.descriptorSha256);
 const evidence=await readFile(join(f.dir,record!.evidenceSha256+'.json'),'utf8');expect(createHash('sha256').update(evidence).digest('hex')).toBe(record!.evidenceSha256);expect(JSON.parse(evidence)).toEqual(result);
 // A second independent verification has its own observed time and evidence; no prior
 // recovery proof is silently reused or overwritten when daily recovery points advance.
 const again=await executeBackupVerification({manifestPath:f.manifestPath,repositoryRoot:process.cwd(),candidate,directory:f.settings.outputDirectory,expectedDescriptorSha256:created.descriptorSha256,privateKeyPath,now:'2026-09-05T12:02:00.000Z'});
 const updated=await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now:'2026-09-05T12:02:00.000Z'});expect(updated.history.filter(h=>h.step==='verify-backup')).toHaveLength(2);expect(again.recoveryPointAgeSeconds).toBe(120);
});
it('does not reuse an old recovery set for a new trusted persistent-source execution',async()=>{
 const f=await fixture();f.manifest.state='cleanup_verified';f.manifest.cleanup.resources[0].disposition='persistent';
 f.manifest.history.push({step:'backup-set',operationId:'29292929-2929-4292-8292-292929292929',completedAt:now,resourceId:null,evidenceSha256:'a'.repeat(64)});
 await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:process.cwd(),now,replace:true});
 const executionId='39393939-3939-4393-8393-393939393939';let calls=0;
 const exportDatabase=vi.fn(async()=>{calls++;const m=await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now});expect(m.pending?.operationId).toBe(executionId);expect(m.history).toHaveLength(2);throw new Error('private-database-body');});
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now,executionId},{binding:async()=>({}),exportDatabase} as any)).rejects.toThrow('BACKUP_EXPORT_FAILED_INSPECT_PRIVATE_STATE');
 expect(calls).toBe(1);
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now,executionId},{binding:async()=>({}),exportDatabase} as any)).rejects.toThrow('BACKUP_PUBLICATION_READBACK_REQUIRED');expect(calls).toBe(1);
});

it('requires recorded source job quiescence before a new export intent',async()=>{const f=await fixture();f.manifest.history=[];await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:process.cwd(),now,replace:true});const binding=vi.fn(),exportDatabase=vi.fn();await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now},{binding,exportDatabase})).rejects.toThrow('JOBS_EVIDENCE_REQUIRED');expect(binding).not.toHaveBeenCalled();expect(exportDatabase).not.toHaveBeenCalled();expect((await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now})).pending).toBeNull();});

it('retains one complete independent encrypted premerge copy and re-verifies without overwriting it',async()=>{
 const f=await fixture();const {createRecoverySet}=await import('../../scripts/issue29-operations/recovery-set.mjs');const {executeBackupCopy}=await import('../../scripts/issue29-operations/execution.mjs');const checkpoint={snapshotId:'00000003-00000001-1',finalizedRowsetSha256:'d'.repeat(64)};
 const created=await createRecoverySet({destination:f.settings.outputDirectory,repositoryRoot:process.cwd(),publicKey,components:new Map(['roles.sql','schema.sql','data.sql','migration-history.sql','auth-recovery.sql','managed-schema.sql','platform-inventory.json'].map(name=>[name,Buffer.from(`synthetic-${name}`)])),storageManifest:{bucket:'listing-images',files:[]},checkpointBefore:checkpoint,checkpointAfter:checkpoint,metadata:{backupSetId:f.manifest.runId,source:{environmentAlias:f.manifest.fixture.alias,organizationId:f.manifest.source!.organizationId,projectRef:f.manifest.source!.ref,region:f.manifest.source!.region,classification:f.manifest.source!.classification},release:{commitSha:candidate.sha,treeSha:candidate.tree,workerVersion:candidate.deploymentId},startedAt:now,finishedAt:now,tools:{supabaseCli:'2.109.1',postgres:'17.6',operator:'issue29-v2'},migration:{count:27,sha256:'e'.repeat(64)},destinationAlias:f.manifest.backup.destinationAlias,exclusions:['auth-sessions'],manualReconstruction:['runtime-secrets']}});
 f.manifest.state='backup_verified';f.manifest.backupVerification={descriptorSha256:created.descriptorSha256,independentlyVerifiedAt:now,sourceReadsComplete:true};f.manifest.allowedActions.push('artifact-upload');await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:process.cwd(),now,replace:true});const copy={schemaVersion:1,operation:'copy-backup',directory:f.settings.outputDirectory,destination:join(f.dir,'secondary'),descriptorSha256:created.descriptorSha256,destinationAlias:'owner-secondary',retentionDays:35,capabilityId:f.manifest.capabilityIds['artifact-upload']};await writeFile(f.settingsPath,JSON.stringify(copy));
 const first=await executeBackupCopy({...f,repositoryRoot:process.cwd(),candidate,now});expect(first.workflowProof).toBe(false);expect(await readFile(join(copy.destination,'backup-set.json'))).toEqual(await readFile(join(copy.directory,'backup-set.json')));expect(await executeBackupCopy({...f,repositoryRoot:process.cwd(),candidate,now})).toEqual(first);
 await writeFile(join(copy.destination,'component-000000.bin'),Buffer.from('corrupt'));await expect(executeBackupCopy({...f,repositoryRoot:process.cwd(),candidate,now})).rejects.toThrow('Issue #29:');expect((await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now})).cleanup.resources.filter(r=>r.provider==='owner-copy')).toHaveLength(1);
});
