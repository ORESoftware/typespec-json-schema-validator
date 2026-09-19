// Turn a retained production-audit receipt into an operator alert about advisory
// exceptions that have expired, or are about to. Deterministic and offline: the
// scheduled workflow owns every GitHub interaction.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { buildExceptionExpiryAlert } from '../src/npm-audit-policy.mjs';

const receiptPath = resolve(
  process.argv[2]
  || process.env.TSJSV_NPM_AUDIT_RECEIPT
  || '.typespec-json-schema-validator/npm-audit-receipt.json',
);
const bodyPath = resolve(
  process.argv[3]
  || process.env.TSJSV_NPM_AUDIT_ALERT_BODY
  || '.typespec-json-schema-validator/npm-audit-exception-alert.md',
);

let receipt;
try {
  receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
} catch (error) {
  process.stderr.write(`production audit receipt unreadable at ${receiptPath}: ${error.message}\n`);
  process.exit(2);
}

const alert = buildExceptionExpiryAlert(receipt);

async function emitOutputs() {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const delimiter = `tjsv-alert-${Date.now()}`;
  await appendFile(
    outputPath,
    `alert=${alert.alert}\n`
    + `expired_count=${alert.expired.length}\n`
    + `expiring_count=${alert.expiringSoon.length}\n`
    + `title<<${delimiter}\n${alert.title ?? ''}\n${delimiter}\n`
    + `body_path=${bodyPath}\n`,
    'utf8',
  );
}

if (!alert.alert) {
  process.stdout.write('no advisory exception is expired or inside the early-warning window\n');
  await emitOutputs();
  process.exit(0);
}

await mkdir(dirname(bodyPath), { recursive: true });
await writeFile(bodyPath, alert.body, { encoding: 'utf8', mode: 0o600 });
await emitOutputs();

process.stdout.write(`${alert.title}\n`);
process.stdout.write(alert.body);
process.exit(0);
