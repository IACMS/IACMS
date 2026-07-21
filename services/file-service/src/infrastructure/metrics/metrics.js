/**
 * In-process Prometheus-style metrics for FMS.
 * Exposed via GET /metrics as text/plain exposition format.
 */
class MetricsRegistry {
  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
  }

  inc(name, labels = {}, value = 1) {
    const key = this._key(name, labels);
    this.counters.set(key, (this.counters.get(key) || 0) + value);
  }

  setGauge(name, labels = {}, value = 0) {
    const key = this._key(name, labels);
    this.gauges.set(key, value);
  }

  _key(name, labels) {
    const parts = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return parts ? `${name}{${parts}}` : name;
  }

  /**
   * Prometheus text exposition format.
   * @returns {string}
   */
  toPrometheus() {
    const lines = [
      '# HELP fms_uploads_total Total successful file uploads',
      '# TYPE fms_uploads_total counter',
      '# HELP fms_upload_errors_total Total failed uploads',
      '# TYPE fms_upload_errors_total counter',
      '# HELP fms_processing_queue_depth Files awaiting or in processing',
      '# TYPE fms_processing_queue_depth gauge',
      '# HELP fms_worker_errors_total Worker processing errors',
      '# TYPE fms_worker_errors_total counter',
    ];

    for (const [key, value] of this.counters) {
      lines.push(`${key} ${value}`);
    }
    for (const [key, value] of this.gauges) {
      lines.push(`${key} ${value}`);
    }

    return lines.join('\n') + '\n';
  }
}

export const metrics = new MetricsRegistry();
