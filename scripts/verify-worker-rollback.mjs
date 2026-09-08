import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const STAGING_WORKER = 'perfume-marketplace-bg-staging';
const sha = /^[a-f0-9]{40}$/u;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

/**
 * Read-only exact-version verification. It never deploys or restores database state.
 * @param {{accountId?:string,versionId?:string,sourceSha?:string,provenanceSha256?:string,token?:string,deployed?:boolean}} input
 * @param {{fetchImpl?:typeof fetch}} [dependencies]
 */
export async function verifyWorkerRollback(input, { fetchImpl = fetch } = {}) {
  try {
    const { accountId, versionId, sourceSha, provenanceSha256, token, deployed = false } = input;
    if (!/^[a-f0-9]{32}$/u.test(accountId ?? '') || !uuid.test(versionId ?? '') ||
        !sha.test(sourceSha ?? '') || !/^[a-f0-9]{64}$/u.test(provenanceSha256 ?? '') || !token) throw new Error();
    const root = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${STAGING_WORKER}`;
    /** @param {string} path */
    const get = async (path) => {
      const response = await fetchImpl(`${root}/${path}`, { method: 'GET', redirect: 'error',
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error();
      const envelope = await response.json();
      if (envelope.success !== true) throw new Error();
      return envelope.result;
    };
    const version = await get(`versions/${versionId}`);
    if (version?.id !== versionId || version.annotations?.['workers/tag'] !== sourceSha ||
        !Number.isFinite(Date.parse(version.metadata?.created_on)) ||
        !/^[a-f0-9]{32,64}$/iu.test(version.resources?.script?.etag ?? '')) throw new Error();
    const provenance = { schemaVersion: 1, accountId, workerName: STAGING_WORKER, versionId,
      createdOn: version.metadata.created_on, sourceSha, scriptEtag: version.resources.script.etag };
    const digest = createHash('sha256').update(JSON.stringify(provenance)).digest('hex');
    if (digest !== provenanceSha256) throw new Error();
    if (deployed) {
      const current = (await get('deployments'))?.deployments?.[0];
      if (current?.versions?.length !== 1 || current.versions[0].version_id !== versionId ||
          current.versions[0].percentage !== 100) throw new Error();
    }
    return provenance;
  } catch { throw new Error('rollback_verification_failed'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyWorkerRollback({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      versionId: process.env.ROLLBACK_VERSION_ID, sourceSha: process.env.ROLLBACK_SOURCE_SHA,
      provenanceSha256: process.env.ROLLBACK_PROVENANCE_SHA256,
      token: process.env.CLOUDFLARE_API_TOKEN, deployed: process.argv.includes('--deployed') });
    console.log('Exact staging Worker rollback provenance verified; database recovery is not implied.');
  } catch { console.error('rollback_verification_failed'); process.exitCode = 1; }
}
