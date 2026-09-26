export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __EMBEDDED_DB__?: { stop: () => Promise<void> } }).__EMBEDDED_DB__?.stop();
}
