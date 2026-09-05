import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { executeBackupSet } from '../../scripts/issue29-operations/execution.mjs';
import { manifestFixture, candidate } from '../fixtures/issue29-operations';
import { readPrivateManifest, writePrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';
const dirs:string[]=[];const now='2026-09-05T12:01:00.000Z';
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
const {publicKey}=generateKeyPairSync('rsa',{modulusLength:3072});
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'issue29-execution-test-'));dirs.push(dir);const manifest=manifestFixture();manifest.state='monitoring_proved';manifest.target=null;
 manifest.backup.publicKeyId=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
 manifest.cleanup.resources.push({provider:'supabase',id:manifest.source!.ref,runId:manifest.runId,createdAt:'2026-09-05T12:00:00.000Z',evidenceSha256:'d'.repeat(64),disposition:'disposable',absentAt:null});
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

it('records private-key recovery separately and closes source reads only after real decryption',async()=>{
 const f=await fixture();const {createRecoverySet}=await import('../../scripts/issue29-operations/recovery-set.mjs');const {executeBackupVerification}=await import('../../scripts/issue29-operations/execution.mjs');
 const keys=generateKeyPairSync('rsa',{modulusLength:3072});f.manifest.backup.publicKeyId=createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex');
 const checkpoint={snapshotId:'00000003-00000001-1',finalizedRowsetSha256:'d'.repeat(64)};
 const created=await createRecoverySet({destination:f.settings.outputDirectory,repositoryRoot:process.cwd(),publicKey:keys.publicKey,components:new Map(['roles.sql','schema.sql','data.sql','migration-history.sql','auth-recovery.sql','managed-schema.sql','platform-inventory.json'].map(name=>[name,Buffer.from(`synthetic-${name}`)])),storageManifest:{bucket:'listing-images',files:[]},checkpointBefore:checkpoint,checkpointAfter:checkpoint,metadata:{backupSetId:f.manifest.runId,source:{environmentAlias:f.manifest.fixture.alias,organizationId:f.manifest.source!.organizationId,projectRef:f.manifest.source!.ref,region:f.manifest.source!.region,classification:f.manifest.source!.classification},release:{commitSha:candidate.sha,treeSha:candidate.tree,workerVersion:candidate.deploymentId},startedAt:now,finishedAt:now,tools:{supabaseCli:'2.109.1',postgres:'17.6',operator:'issue29-v2'},migration:{count:27,sha256:'e'.repeat(64)},destinationAlias:f.manifest.backup.destinationAlias,exclusions:['auth-sessions'],manualReconstruction:['runtime-secrets']}});
 f.manifest.state='backup_started';f.manifest.history.push({step:'backup-set',operationId:f.manifest.runId,completedAt:now,evidenceSha256:created.descriptorSha256,resourceId:null});await writePrivateManifest(f.manifestPath,f.manifest,{repositoryRoot:process.cwd(),now,replace:true});
 const privateKeyPath=join(f.dir,'owner-private.pem');await writeFile(privateKeyPath,keys.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
 const result=await executeBackupVerification({manifestPath:f.manifestPath,repositoryRoot:process.cwd(),candidate,directory:f.settings.outputDirectory,expectedDescriptorSha256:created.descriptorSha256,privateKeyPath,now});expect(result.decryptionVerified).toBe(true);expect(result.recoveryPointAgeSeconds).toBe(0);
 const m=await readPrivateManifest(f.manifestPath,{repositoryRoot:process.cwd(),now});expect(m.backupVerification).toEqual({descriptorSha256:created.descriptorSha256,independentlyVerifiedAt:now,sourceReadsComplete:true});
 await expect(executeBackupSet({...f,repositoryRoot:process.cwd(),candidate,now})).rejects.toThrow('SOURCE_READS_CLOSED');
});
