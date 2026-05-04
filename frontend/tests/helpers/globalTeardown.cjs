const { cleanupHarnessSandbox, readHarnessManifest } = require('./inspyroHarness');

module.exports = async () => {
  if (
    process.env.KEEP_INSPYRO_E2E_SANDBOX === '1'
    || process.env.INSPYRO_E2E_SKIP_WEBSERVER === '1'
  ) {
    return;
  }

  try {
    const manifest = readHarnessManifest(process.env.INSPYRO_E2E_MANIFEST);
    cleanupHarnessSandbox(manifest);
  } catch (error) {
    process.stderr.write(`[playwright-teardown] ${error.message}\n`);
  }
};
