const levels = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };

export default class Logger {
  constructor(serviceName, level = process.env.LOG_LEVEL || 'INFO') {
    this.serviceName = serviceName;
    this.level = levels[level.toUpperCase()] ?? levels.INFO;
  }
  write(level, method, message, meta = {}) {
    if (this.level < levels[level]) return;
    console[method](JSON.stringify({ timestamp: new Date().toISOString(), service: this.serviceName, level, message, ...meta }));
  }
  error(message, meta) { this.write('ERROR', 'error', message, meta); }
  warn(message, meta) { this.write('WARN', 'warn', message, meta); }
  info(message, meta) { this.write('INFO', 'info', message, meta); }
  debug(message, meta) { this.write('DEBUG', 'debug', message, meta); }
}
