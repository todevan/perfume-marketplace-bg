import {z} from 'zod';
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {assertPrivatePath,ensure,OperationsError,readPrivateManifest} from './manifest.mjs';
import {readPrivateBytes} from './execution.mjs';
import {readSeededSourceEvidence} from './source-execution.mjs';
import {syntheticActorDefinitions} from './synthetic-source.mjs';
import {readTargetReleaseBinding} from './source-binding.mjs';
/** Credentials are derived only from this run's hash-bound seed, never from generic real-beta env.
 * @param {import('./manifest.mjs').OperationsManifest} manifest @param {any} fixture
 * @param {{origin:string,publishableKey:string,totpSecret:string}} settings */
export function issue29BrowserEnvironment(manifest,fixture,settings){
 const target=manifest.target;ensure(target&&manifest.source&&target.ref!==manifest.source.ref&&!manifest.forbiddenRefs.includes(target.ref)&&!manifest.preservedRefs.includes(target.ref),'TARGET_FORBIDDEN');
 ensure(manifest.state==='storage_restored'&&manifest.pending?.step==='verify-restore'&&manifest.pending.resourceId==='application'&&manifest.targetDeploymentId&&manifest.maintenance?.phase==='paused','BROWSER_RESTORE_BOUNDARY_REQUIRED');
 ensure(manifest.cleanup.resources.some(r=>r.provider==='supabase'&&r.id===target.ref&&r.runId===manifest.runId&&r.disposition==='disposable'&&r.absentAt===null),'BROWSER_TARGET_OWNERSHIP_REQUIRED');
 const origin=new URL(settings.origin),name=`issue29-restore-${manifest.maintenance.id}`;ensure(origin.protocol==='https:'&&origin.origin===settings.origin&&origin.hostname.startsWith(name+'.')&&origin.hostname.endsWith('.workers.dev'),'BROWSER_WORKER_IDENTITY_MISMATCH');
 const users=fixture.privateAuthFixtures?.users;ensure(Array.isArray(users)&&users.length===4&&new Set(users.map(u=>u.id)).size===4,'BROWSER_SYNTHETIC_ACTORS_REQUIRED');
 /** @type {Record<string,string>} */const env={E2E_REAL_RUN:'true',E2E_REAL_BASE_URL:settings.origin,E2E_REAL_CROSS_USER_PRIVACY_RUN:'true',E2E_REAL_UPLOADS:'false',E2E_REAL_LISTING_SLUG:'recovery-listing',E2E_REAL_LISTING_QUERY:'Recovery listing',E2E_REAL_SUPABASE_URL:target.url,E2E_REAL_SUPABASE_PROJECT_REF:target.ref,E2E_REAL_SUPABASE_PUBLISHABLE_KEY:settings.publishableKey,E2E_REAL_MODERATOR_TOTP_SECRET:settings.totpSecret};
 for(const actor of syntheticActorDefinitions(manifest.runId)){const user=users.find(u=>u.alias===actor.alias);ensure(user&&user.email===actor.email,'BROWSER_SYNTHETIC_ACTORS_REQUIRED');const prefix=actor.alias==='future-staff'?'MODERATOR':actor.alias.toUpperCase();env[`E2E_REAL_${prefix}_EMAIL`]=user.email;env[`E2E_REAL_${prefix}_PASSWORD`]=fixture.privateAuthFixtures.password;env[`E2E_REAL_${prefix}_USERNAME`]=actor.username;}
 return env;
}
/** Reuse the session produced by the real application login/CAPTCHA. Never call password grant
 * separately for the Issue29 Realtime probe. Cookie payload stays only in the private process.
 * @param {{name:string,value:string}[]} cookies @param {string} projectRef */
export function issue29SessionFromCookies(cookies,projectRef){
 ensure(/^[a-z]{20}$/u.test(projectRef),'TARGET_BROWSER_SESSION_INVALID');const name=`sb-${projectRef}-auth-token`;
 const parts=cookies.filter(c=>c.name===name||c.name.startsWith(name+'.'));ensure(parts.length>0,'TARGET_BROWSER_SESSION_REQUIRED');
 ensure(parts.length<=20&&new Set(parts.map(p=>p.name)).size===parts.length,'TARGET_BROWSER_SESSION_INVALID');
 const direct=parts.find(p=>p.name===name);if(direct)ensure(parts.length===1,'TARGET_BROWSER_SESSION_INVALID');
 const value=direct?.value??parts.sort((a,b)=>Number(a.name.slice(name.length+1))-Number(b.name.slice(name.length+1))).map((p,i)=>{ensure(p.name===`${name}.${i}`,'TARGET_BROWSER_SESSION_INVALID');return p.value;}).join('');
 ensure(value.startsWith('base64-')&&value.length<=65536,'TARGET_BROWSER_SESSION_INVALID');
 try{const parsed=JSON.parse(Buffer.from(value.slice(7),'base64url').toString());ensure(typeof parsed.access_token==='string'&&typeof parsed.refresh_token==='string','TARGET_BROWSER_SESSION_INVALID');return{access_token:parsed.access_token,refresh_token:parsed.refresh_token};}catch{throw new OperationsError('TARGET_BROWSER_SESSION_INVALID');}
}
const schema=z.strictObject({schemaVersion:z.literal(1),operation:z.literal('verify-application'),manifestPath:z.string(),sourcePrivateDirectory:z.string(),bindingSettingsPath:z.string(),publishableKey:z.string().min(10),totpSecretPath:z.string().optional(),sessionCredentialsPath:z.string(),allowLiveHumanChallenges:z.literal(true)});
/** This opt-in is not a CAPTCHA bypass: it only authorizes waiting for a real human-issued token
 * on the exact already-restored disposable target. @param {string} path @param {string} repositoryRoot */
export async function readIssue29BrowserBoundary(path,repositoryRoot){
 try{const parsed=schema.safeParse(JSON.parse((await readPrivateBytes(path,repositoryRoot)).toString()));ensure(parsed.success,'BROWSER_SETTINGS_INVALID');const s=parsed.data;
  const manifest=await readPrivateManifest(s.manifestPath,{repositoryRoot});const seed=await readSeededSourceEvidence({manifest,privateDirectory:s.sourcePrivateDirectory,repositoryRoot});
  const binding=JSON.parse((await readPrivateBytes(s.bindingSettingsPath,repositoryRoot)).toString());const release=await readTargetReleaseBinding({manifest,settings:binding});
  const totpSecret=s.totpSecretPath?(await readPrivateBytes(s.totpSecretPath,repositoryRoot,256)).toString().trim():'';ensure(!totpSecret||/^[A-Z2-7]{16,128}$/u.test(totpSecret),'TARGET_MFA_CUSTODY_REQUIRED');
  const environment=issue29BrowserEnvironment(manifest,seed.fixture,{origin:binding.deployment.origin,publishableKey:s.publishableKey,totpSecret});
  await assertPrivatePath(s.sessionCredentialsPath,repositoryRoot);const directory=await lstat(dirname(s.sessionCredentialsPath));ensure(directory.isDirectory()&&!directory.isSymbolicLink()&&(directory.mode&0o777)===0o700,'PRIVATE_FILE_MODE_REQUIRED');
  return{environment,operationId:manifest.pending?.operationId,runId:manifest.runId,targetRef:manifest.target?.ref,candidate:manifest.candidate,sessionCredentialsPath:s.sessionCredentialsPath,actors:seed.fixture.privateAuthFixtures.users,repositoryRoot,releaseEvidenceSha256:release.evidenceSha256};
 }catch(error){if(error instanceof OperationsError)throw error;throw new OperationsError('BROWSER_BOUNDARY_UNPROVEN');}
}

/** Capture only the current run's synthetic browser credentials into its private local facility,
 * never the Playwright report, logs, receipt, or provider artifact. @param {Awaited<ReturnType<typeof readIssue29BrowserBoundary>>} boundary @param {Map<string,{access_token:string,refresh_token:string}>} sessions */
export async function writeIssue29BrowserSessions(boundary,sessions){
 const actors=boundary.actors.map((/** @type {any} */a)=>{const session=sessions.get(a.email);ensure(session,'TARGET_BROWSER_SESSION_REQUIRED');return{alias:a.alias,id:a.id,accessToken:session.access_token,...(a.alias==='future-staff'?{requiredAal:'aal2'}:{requiredAal:'aal1'})};});
 const payload={schemaVersion:1,operationId:boundary.operationId,runId:boundary.runId,targetRef:boundary.targetRef,candidate:boundary.candidate,actors};await assertPrivatePath(boundary.sessionCredentialsPath,boundary.repositoryRoot);const handle=await open(boundary.sessionCredentialsPath,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);try{await handle.writeFile(JSON.stringify(payload));await handle.sync();}finally{await handle.close();}
}
