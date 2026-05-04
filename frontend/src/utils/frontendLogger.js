const isVerboseFrontendLoggingEnabled = () => process.env.REACT_APP_INSPYRO_DEBUG === '1';

const buildScopedArgs = (scope, args) => (
  scope
    ? [`[${scope}]`, ...args]
    : args
);

const emitConsole = (method, scope, args, { verboseOnly = false } = {}) => {
  if (verboseOnly && !isVerboseFrontendLoggingEnabled()) {
    return;
  }

  const consoleMethod = typeof console?.[method] === 'function'
    ? console[method]
    : console.log;
  consoleMethod(...buildScopedArgs(scope, args));
};

export const createFrontendLogger = (scope = '') => ({
  debug: (...args) => emitConsole('debug', scope, args, { verboseOnly: true }),
  log: (...args) => emitConsole('log', scope, args, { verboseOnly: true }),
  info: (...args) => emitConsole('info', scope, args, { verboseOnly: true }),
  warn: (...args) => emitConsole('warn', scope, args, { verboseOnly: true }),
  error: (...args) => emitConsole('error', scope, args),
});

export { isVerboseFrontendLoggingEnabled };
