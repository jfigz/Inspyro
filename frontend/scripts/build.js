// Keep production builds quiet when dependencies publish broken sourcemaps.
if (process.env.GENERATE_SOURCEMAP === undefined) {
  process.env.GENERATE_SOURCEMAP = 'false';
}

const extraArgs = process.argv.slice(2);
process.argv = [process.argv[0], process.argv[1], 'build', ...extraArgs];

require('react-scripts/bin/react-scripts');
