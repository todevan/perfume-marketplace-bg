import { readFileSync } from 'node:fs';
import { assertCleanupReceiptForMigratedBaseline } from './operator-lib.mjs';

const [receiptPath, candidateSha] = process.argv.slice(2);
if (!receiptPath || !candidateSha) throw new Error('cleanup receipt path and candidate SHA are required');
const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
assertCleanupReceiptForMigratedBaseline(receipt, candidateSha, process.env.SUPABASE_ACCESS_TOKEN);
console.log(JSON.stringify({ status: 'CLEANUP_RECEIPT_VALID' }));
