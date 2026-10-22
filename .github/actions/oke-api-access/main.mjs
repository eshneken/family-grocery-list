import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const lease = path.join(process.env.RUNNER_TEMP, `oke-api-lease-${randomUUID()}.json`);
fs.appendFileSync(process.env.GITHUB_STATE, `lease_file=${lease}\n`);
execFileSync('python3', [fileURLToPath(new URL('../../../scripts/oke_ci_access.py', import.meta.url)), 'open', lease], { stdio: 'inherit' });
