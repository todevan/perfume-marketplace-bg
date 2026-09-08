import { expect, it } from 'vitest';
import { createMonitorDeploymentAdapter } from '../../scripts/issue29-operations/monitor-deployment.mjs';

const settings = { mode:'create', accountId: 'a'.repeat(32), subdomain: 'owner', workerAlias: 'aromatika-issue29-monitor', privateConfigPath: '/private/config.json', privateSecretsPath: '/private/secrets.json', readToken: 'r'.repeat(43), deployToken: 'd'.repeat(43), deployCapabilityId: 'monitoring-config', expectedEnvironment: 'synthetic-recovery', runtimeEnvironment: 'development', expectedRelease: 'b'.repeat(40), targetOrigin: 'https://issue29-source.owner.workers.dev' };

it('rejects a deployment configuration that cannot bind the exact runtime identity before provider access', () => {
	expect(() => createMonitorDeploymentAdapter({ ...settings, runtimeEnvironment: 'production' })).toThrow('MONITOR_DEPLOYMENT_SETTINGS_INVALID');
	expect(() => createMonitorDeploymentAdapter({ ...settings, expectedEnvironment: 'Development' })).toThrow('MONITOR_DEPLOYMENT_SETTINGS_INVALID');
	expect(() => createMonitorDeploymentAdapter({ ...settings, privateSecretsPath: '' })).toThrow('MONITOR_DEPLOYMENT_SETTINGS_INVALID');
});

it('proves a newly deployed exact Free-plan Worker and rejects a foreign Durable Object binding', async () => {
	let foreign = false;
	const fetchImpl: typeof fetch = async input => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith('/workers/scripts/aromatika-issue29-monitor')) return Response.json({ success: false, errors: [{ code: 10007 }] }, { status: 404 });
		if (path.endsWith('/subscriptions')) return Response.json({ success: true, result: [] });
		if (path.endsWith('/deployments')) return Response.json({ success: true, result: { deployments: [{ versions: [{ percentage: 100, version_id: 'v1' }] }] } });
		if (path.endsWith('/versions/v1')) return Response.json({ success: true, result: { id: 'v1', resources: { bindings: [{ type: 'plain_text', name: 'EXPECTED_RELEASE_SHA', text: settings.expectedRelease }, { type: 'plain_text', name: 'EXPECTED_ENVIRONMENT', text: settings.expectedEnvironment }, { type: 'plain_text', name: 'RUNTIME_ENVIRONMENT', text: settings.runtimeEnvironment }, { type: 'plain_text', name: 'TARGET_ORIGIN', text: settings.targetOrigin }, { type: 'durable_object_namespace', name: 'MONITOR_COORDINATOR', class_name: foreign ? 'Foreign' : 'Issue29MonitorCoordinator', namespace_id: 'namespace-1' }] } } });
		if (path.endsWith('/schedules')) return Response.json({ success: true, result: { schedules: [{ cron: '*/10 * * * *' }] } });
		throw new Error(path);
	};
	const adapter = createMonitorDeploymentAdapter(settings, { fetchImpl, now: () => '2026-09-08T12:00:00.000Z' });
	await expect(adapter.inspect()).resolves.toMatchObject({ status: 'absent' });
	await expect(adapter.readback()).resolves.toMatchObject({ status: 'verified', candidateSha: settings.expectedRelease });
	foreign = true;
	await expect(adapter.readback()).rejects.toThrow('MONITOR_DO_BINDING_MISMATCH');
});

import { mkdtemp, chmod, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../scripts/issue29-operations/recovery-set.mjs';
import { executeDeployMonitor } from '../../scripts/issue29-operations/monitor-deployment.mjs';
import { manifestFixture } from '../fixtures/issue29-operations';
import { writePrivateManifest, readPrivateManifest } from '../../scripts/issue29-operations/manifest.mjs';

it.each([false,true,'release-update'])('journals exact deployment and resumes ambiguous submission without retry (%s)',async ambiguous=>{
 const directory=await mkdtemp(join(tmpdir(),'i29-monitor-deploy-'));await chmod(directory,0o700);
 try{
  const m=manifestFixture(),now='2026-09-05T12:00:00.000Z',manifestPath=join(directory,'manifest.json');m.allowedActions.push('deploy-monitor');m.monitoring.workerAlias=settings.workerAlias;
  const sourceBinding={providerToken:'p'.repeat(43),source:{apiUrl:m.source!.url,serviceKey:'s'.repeat(43)},deployment:{accountId:settings.accountId,workerName:`issue29-${m.runId}`,versionId:m.candidate.deploymentId,origin:`https://issue29-${m.runId}.owner.workers.dev`,readToken:'r'.repeat(43)}};
  const local={...settings,mode:'create' as const,sourceBinding,expectedRelease:m.candidate.sha,targetOrigin:sourceBinding.deployment.origin,deployCapabilityId:m.capabilityIds['monitoring-config'],privateConfigPath:join(directory,'worker.json'),privateSecretsPath:join(directory,'secrets.json')};
  const vars={EXPECTED_RELEASE_SHA:local.expectedRelease,EXPECTED_ENVIRONMENT:local.expectedEnvironment,RUNTIME_ENVIRONMENT:local.runtimeEnvironment,TARGET_ORIGIN:local.targetOrigin,PUBLIC_HEALTH_URL:local.targetOrigin+'/',READINESS_URL:local.targetOrigin+'/api/operations/readiness'};
  await writeFile(local.privateConfigPath,JSON.stringify({name:local.workerAlias,main:resolve('workers/issue29-monitor/src/index.ts'),account_id:local.accountId,compatibility_date:'2026-07-20',workers_dev:true,triggers:{crons:['*/10 * * * *']},durable_objects:{bindings:[{name:'MONITOR_COORDINATOR',class_name:'Issue29MonitorCoordinator'}]},migrations:[{tag:'v1',new_sqlite_classes:['Issue29MonitorCoordinator']}],vars}),{mode:0o600});
  await writeFile(local.privateSecretsPath,JSON.stringify({READINESS_TOKEN:'r'.repeat(43),RESEND_API_KEY:'re_fixture123456789',RESEND_FROM:'monitor@example.test',RESEND_TO:'owner@example.test',RESEND_WEBHOOK_SECRET:'whsec_dGVzdF9zaWduaW5nX2tleV9mb3JfaXNzdWUyOQ==',BACKUP_CHECKPOINT_TOKEN:'b'.repeat(43),WATCHDOG_TOKEN:'w'.repeat(43),EVIDENCE_READ_TOKEN:'e'.repeat(43),MAINTENANCE_TOKEN:'m'.repeat(43),RELEASE_ADOPTION_TOKEN:'u'.repeat(43)}),{mode:0o600});
  await writePrivateManifest(manifestPath,m,{repositoryRoot:process.cwd(),now});let deployed=false,submissions=0,activeVersion='monitor-v1',deployedRelease=m.candidate.sha;
  const fetchImpl:typeof fetch=async input=>{const u=new URL(String(input)),path=u.pathname;
   if(u.hostname==='api.supabase.com'){if(path.includes('/organizations/'))return Response.json({id:'owned-org',plan:'free'});if(path.endsWith('/api-keys'))return Response.json([{name:'service_role',api_key:sourceBinding.source.serviceKey}]);return Response.json({ref:m.source!.ref,organization_slug:'owned-org',region:'eu-central-1',status:'ACTIVE_HEALTHY',database:{version:'17.6.1'}});}
   if(u.origin===local.targetOrigin)return new Response(null,{status:200,headers:{'x-deployed-git-sha':m.candidate.sha}});
   if(path.includes(`/workers/scripts/${sourceBinding.deployment.workerName}/`)){if(path.endsWith('/deployments'))return Response.json({success:true,result:{deployments:[{versions:[{version_id:m.candidate.deploymentId,percentage:100}]}]}});return Response.json({success:true,result:{id:m.candidate.deploymentId,metadata:{created_on:now},resources:{bindings:[['RELEASE_COMMIT_SHA',m.candidate.sha],['PUBLIC_SUPABASE_URL',m.source!.url],['APP_ENV','development'],['ISSUE29_CANDIDATE_TREE',m.candidate.tree],['ISSUE29_RUN_ID',m.runId]].map(([name,text])=>({name,text,type:'plain_text'}))}}});}
   if(path.endsWith('/subscriptions'))return Response.json({success:true,result:[]});
   if(path.endsWith(`/workers/scripts/${local.workerAlias}`))return Response.json({success:false,errors:[{code:10007}]},{status:404});
   if(path.endsWith('/deployments')){expect(deployed).toBe(true);return Response.json({success:true,result:{deployments:[{versions:[{version_id:activeVersion,percentage:100}]}]}});}
   if(path.endsWith('/versions/'+activeVersion))return Response.json({success:true,result:{id:activeVersion,metadata:{created_on:now},resources:{bindings:[...Object.entries({...vars,EXPECTED_RELEASE_SHA:deployedRelease}).map(([name,text])=>({type:'plain_text',name,text})),{type:'durable_object_namespace',name:'MONITOR_COORDINATOR',class_name:'Issue29MonitorCoordinator',namespace_id:'owned-namespace'}]}}});
   if(path.endsWith('/schedules'))return Response.json({success:true,result:{schedules:[{cron:'*/10 * * * *'}]}});throw new Error('Unexpected fixture request');
  };
  const execImpl=async()=>{submissions++;const pending=JSON.parse(await readFile(manifestPath,'utf8')).pending;expect(pending.step).toBe('deploy-monitor');deployed=true;activeVersion=`monitor-v${submissions}`;deployedRelease=local.expectedRelease;if(ambiguous===true)throw new Error('private ambiguous response');return {stdout:'',stderr:''};};
  const options={manifestPath,repositoryRoot:process.cwd(),candidate:m.candidate,settings:local,fetchImpl,execImpl:execImpl as never,now};
  if(ambiguous===true)await expect(executeDeployMonitor(options)).rejects.toThrow('MONITOR_DEPLOY_MUTATION_UNCERTAIN_READBACK_ONLY');
  const proof=await executeDeployMonitor(options);expect(proof.candidateSha).toBe(m.candidate.sha);expect(submissions).toBe(1);
  const after=await readPrivateManifest(manifestPath,{repositoryRoot:process.cwd(),now});expect(after.pending).toBeNull();const history=after.history.at(-1)!;expect(history.intentSha256).toMatch(/^[a-f0-9]{64}$/);const bytes=await readFile(join(directory,history.evidenceSha256+'.json'));expect(createHash('sha256').update(bytes).digest('hex')).toBe(history.evidenceSha256);expect(after.cleanup.resources.find(r=>r.provider==='cloudflare-monitor')?.evidenceSha256).toBe(history.evidenceSha256);
  await executeDeployMonitor(options);expect(submissions).toBe(1);
  if(ambiguous==='release-update'){
   const fromCandidate={...m.candidate},mergeSha='c'.repeat(40),configHash='d'.repeat(64);
   const merge={schemaVersion:1,kind:'issue29-protected-merge',evidenceMode:'deterministic-http-fixture',repository:'todevan/perfume-marketplace-bg',repositoryId:123,pullRequestNumber:66,fromCandidate,mergeSha,treeSha:fromCandidate.tree,verifiedAt:now,mergedAt:now,protectionSha256:'e'.repeat(64),checkRunsSha256:'f'.repeat(64)};
   const mergeBytes=canonicalJson(merge),evidenceSha256=createHash('sha256').update(mergeBytes).digest('hex');await writeFile(join(directory,evidenceSha256+'.json'),mergeBytes,{mode:0o600});
   after.candidate={...fromCandidate,sha:mergeSha,deploymentId:'source-v2'};after.releaseUpdate={fromCandidate,mergeSha,treeSha:fromCandidate.tree,pullRequestNumber:66,verifiedAt:now,evidenceSha256,repository:merge.repository,repositoryId:merge.repositoryId};after.monitoring.configSha256=configHash;
   after.allowedActions.push('adopt-merged-release');after.history.push({step:'adopt-merged-release',operationId:crypto.randomUUID(),resourceId:mergeSha,completedAt:now,evidenceSha256});
   m.candidate=after.candidate;sourceBinding.deployment.versionId=m.candidate.deploymentId;local.expectedRelease=mergeSha;const privateConfig=JSON.parse(await readFile(local.privateConfigPath,'utf8'));privateConfig.vars.EXPECTED_RELEASE_SHA=mergeSha;await writeFile(local.privateConfigPath,JSON.stringify(privateConfig),{mode:0o600});
   await writePrivateManifest(manifestPath,after,{repositoryRoot:process.cwd(),now,replace:true});
   const updated=await executeDeployMonitor({...options,candidate:m.candidate,settings:{...local,mode:'release-update'}});
   expect(submissions).toBe(2);expect(updated).toMatchObject({candidateSha:mergeSha,previousCandidateSha:fromCandidate.sha,previousConfigSha256:configHash,protectedMergeEvidenceSha256:evidenceSha256});expect(updated.providerReadback.durableObject.namespaceIdSha256).toBe(proof.providerReadback.durableObject.namespaceIdSha256);
  }
 }finally{await rm(directory,{recursive:true,force:true});}
});
