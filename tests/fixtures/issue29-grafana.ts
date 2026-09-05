const now='2026-09-05T12:00:00.000Z';
export const monitoringConfig = {stackSlug:'issue29-fixture',stackId:321,orgId:654,tenantId:987,namespace:'stacks-321',
  smOrigin:'https://synthetic-monitoring-api-eu-west-0.grafana.net',cloudReadToken:'cloud-read-private-token-123456789',
  stackToken:'stack-private-token-12345678901234',syntheticToken:'synthetic-private-token-1234567890',monitorToken:'monitor-private-token-12345678901234567890123456789',
  privateEmail:'private-owner@example.test',environmentAlias:'synthetic-source',runtimeEnvironment:'staging' as const,runId:'7abbd7fc-a029-4da0-94af-9d1262188f88',
  candidateSha:'a'.repeat(40),targetOrigin:'https://issue29-fixture.workers.dev',publicPath:'/',folderUid:'issue29-fixture',
  datasourceUid:'metrics-fixture',publicProbeId:44,k6ChannelId:'stable',metricsQueryOrigin:'https://prometheus-prod-01-prod-eu-west-0.grafana.net',
  metricsQueryBasePath:'/api/prom' as const,metricsInstanceId:'123',metricsReadToken:'read-private-token-12345678901234567',
  freePlanEvidence:{stackId:321,plan:'free' as const,trial:false as const,maxNewSpend:0 as const,providerPlan:'gcloud',observedAt:now,evidenceSha256:'f'.repeat(64)}};

export function providerFixture(overrides:Record<string,unknown>={}, selected:import('../../scripts/issue29-operations/grafana-adapter.mjs').GrafanaConfig=monitoringConfig) {
  const stored = new Map<string,Record<string,any>>(); const requests:{url:string;method:string;body:any}[]=[];
  const checkRows:Record<string,any>[]=[]; let eventRows:Record<string,unknown>[]=[];
  const fetchImpl:typeof fetch=async(url,init)=>{
    const u=new URL(String(url)), method=init?.method??'GET',body=typeof init?.body==='string'?JSON.parse(init.body):undefined;
    requests.push({url:u.href,method,body});
    if(u.hostname==='grafana.com')return Response.json({id:selected.stackId,orgId:selected.orgId,slug:selected.stackSlug,url:`https://${selected.stackSlug}.grafana.net`,status:'active',trial:0,plan:'gcloud',...overrides});
    if(u.pathname==='/api/v1/tenant')return Response.json({id:selected.tenantId,orgId:selected.orgId,stackId:selected.stackId,status:0,metricsRemote:{password:'must-not-leak'},...overrides});
    if(u.pathname==='/api/v1/tenant/limits')return Response.json({MaxChecks:10,MaxScriptedChecks:10,...overrides});
    if(u.pathname==='/api/v1/probe')return Response.json([{id:selected.publicProbeId,public:true,online:true,disabled:false,deprecated:false,k6Versions:{stable:'1.4.0'}}]);
    if(u.pathname==='/api/org')return Response.json({id:1});
    if(u.pathname===`/api/datasources/uid/${selected.datasourceUid}`)return Response.json({uid:selected.datasourceUid,type:'prometheus',url:selected.metricsQueryOrigin+'/api/prom',basicAuthUser:'123'});
    if(u.pathname.endsWith('/notification/query'))return Response.json({entries:body.limit===1?[]:eventRows,counts:[]});
    if(u.pathname==='/api/v1/check' && method==='GET')return Response.json({items:checkRows,next_cursor:''});
    if(u.pathname.includes('/rule-groups/'))return Response.json({interval:60,rules:[...stored.values()].filter(r=>r.ruleGroup)});
    if(method==='POST'){
      if(u.pathname==='/api/v1/check') {const row={...body,id:checkRows.length+1,tenantId:selected.tenantId};checkRows.push(row);return Response.json(row);}
      const key=body.uid??body.metadata?.name??Buffer.from(body.spec.title).toString('base64url');
      const row={...body,...(body.metadata?{metadata:{...body.metadata,name:key,uid:`provider-${key}`,resourceVersion:'1'}}:{})};
      if(row.spec?.value)delete row.spec.value;
      stored.set(u.pathname+'/'+key,row);return Response.json(row,{status:201});
    }
    if(method==='DELETE') {stored.delete(u.pathname);return new Response(null,{status:204});}
    const row=stored.get(u.pathname);return row?Response.json(row):new Response(null,{status:404});
  };
  return {fetchImpl,stored,requests,setEvents:(rows:Record<string,unknown>[])=>{eventRows=rows;}};
}
