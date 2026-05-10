// Suppress Node deprecation warnings for react-scripts dev server noise.
const noDeprecationFlag = '--no-deprecation';
const currentNodeOptions = process.env.NODE_OPTIONS || '';
if (!currentNodeOptions.includes(noDeprecationFlag)) {
  process.env.NODE_OPTIONS = `${currentNodeOptions} ${noDeprecationFlag}`.trim();
}
process.noDeprecation = true;

// docx-preview 0.3.7 publishes sourcemap references to TypeScript sources that
// are not included in the package. React Scripts' source-map-loader turns those
// missing files into dozens of dev-server warnings, so default sourcemaps off
// for this wrapper while still allowing an explicit env override.
if (process.env.GENERATE_SOURCEMAP === undefined) {
  process.env.GENERATE_SOURCEMAP = 'false';
}

const extraArgs = process.argv.slice(2);
process.argv = [process.argv[0], process.argv[1], 'start', ...extraArgs];

require('react-scripts/bin/react-scripts');
