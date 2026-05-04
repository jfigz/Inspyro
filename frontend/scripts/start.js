// Suppress Node deprecation warnings for react-scripts dev server noise.
const noDeprecationFlag = '--no-deprecation';
const currentNodeOptions = process.env.NODE_OPTIONS || '';
if (!currentNodeOptions.includes(noDeprecationFlag)) {
  process.env.NODE_OPTIONS = `${currentNodeOptions} ${noDeprecationFlag}`.trim();
}
process.noDeprecation = true;

const extraArgs = process.argv.slice(2);
process.argv = [process.argv[0], process.argv[1], 'start', ...extraArgs];

require('react-scripts/bin/react-scripts');
