import Log from 'log';

var logger = null;

export default {
  getLogger() {
    if (!logger) {
      logger = new Log();
    }
    return logger;
  },

  setLogger(log) {
    logger = log;
  },

  error() {
    this.getLogger().error.apply(logger, arguments);
  },

  debug() {
    this.getLogger().debug.apply(logger, arguments);
  },

  info() {
    this.getLogger().info.apply(logger, arguments);
  }
}
