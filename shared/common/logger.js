/**
 * Shared Logger Utility
 * Simple logger for all microservices
 */

const logLevels = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

class Logger {
  constructor(serviceName, level = 'INFO') {
    this.serviceName = serviceName;
    this.level = logLevels[level.toUpperCase()] || logLevels.INFO;
  }

  formatMessage(level, message, meta = {}) {
    return {
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      level,
      message,
      ...meta,
    };
  }

  error(message, meta = {}) {
    if (this.level >= logLevels.ERROR) {
      console.error(JSON.stringify(this.formatMessage('ERROR', message, meta)));
    }
  }

  warn(message, meta = {}) {
    if (this.level >= logLevels.WARN) {
      console.warn(JSON.stringify(this.formatMessage('WARN', message, meta)));
    }
  }

  info(message, meta = {}) {
    if (this.level >= logLevels.INFO) {
      console.info(JSON.stringify(this.formatMessage('INFO', message, meta)));
    }
  }

  debug(message, meta = {}) {
    if (this.level >= logLevels.DEBUG) {
      console.debug(JSON.stringify(this.formatMessage('DEBUG', message, meta)));
    }
  }
}

export default Logger;

