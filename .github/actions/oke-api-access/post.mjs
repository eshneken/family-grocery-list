import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const lease = process.env.STATE_lease_file;
if (lease) {
  execFileSync('python3', [fileURLToPath(new URL('../../../scripts/oke_ci_access.py', import.meta.url)), 'close', lease], { stdio: 'inherit' });
}
