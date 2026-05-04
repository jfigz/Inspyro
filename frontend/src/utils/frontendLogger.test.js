import { createFrontendLogger, isVerboseFrontendLoggingEnabled } from './frontendLogger';

describe('frontendLogger', () => {
  const originalDebugFlag = process.env.REACT_APP_INSPYRO_DEBUG;

  beforeEach(() => {
    delete process.env.REACT_APP_INSPYRO_DEBUG;
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (typeof originalDebugFlag === 'string') {
      process.env.REACT_APP_INSPYRO_DEBUG = originalDebugFlag;
    } else {
      delete process.env.REACT_APP_INSPYRO_DEBUG;
    }
    jest.restoreAllMocks();
  });

  it('keeps verbose logging disabled by default', () => {
    const logger = createFrontendLogger('Run All');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(isVerboseFrontendLoggingEnabled()).toBe(false);
    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('[Run All]', 'error');
  });

  it('enables verbose logging only when REACT_APP_INSPYRO_DEBUG=1', () => {
    process.env.REACT_APP_INSPYRO_DEBUG = '1';
    const logger = createFrontendLogger('Run All');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');

    expect(isVerboseFrontendLoggingEnabled()).toBe(true);
    expect(console.debug).toHaveBeenCalledWith('[Run All]', 'debug');
    expect(console.info).toHaveBeenCalledWith('[Run All]', 'info');
    expect(console.warn).toHaveBeenCalledWith('[Run All]', 'warn');
  });
});
