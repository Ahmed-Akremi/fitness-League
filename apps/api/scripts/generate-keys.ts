/** Prints fresh Ed25519 JWT keys as env lines: `pnpm keys:generate >> .env` */
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const b64 = (pem: string) => Buffer.from(pem).toString('base64');
console.log(`JWT_PRIVATE_KEY_B64=${b64(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())}`);
console.log(`JWT_PUBLIC_KEY_B64=${b64(publicKey.export({ type: 'spki', format: 'pem' }).toString())}`);
