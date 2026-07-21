/**
 * k6 load test for FMS — 100 concurrent uploads (small payloads for CI-friendly runs).
 *
 * Usage:
 *   k6 run services/file-service/loadtest/upload.js \
 *     -e BASE_URL=http://localhost:3000/api/v1 \
 *     -e TOKEN=<jwt>
 *
 * For a 10GB chunked upload scenario, raise CHUNK_TOTAL and file size in a dedicated script.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { FormData } from 'https://jslib.k6.io/formdata/0.0.2/index.js';

export const options = {
  vus: 100,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<5000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const TOKEN = __ENV.TOKEN || '';

export default function () {
  const fd = new FormData();
  fd.append('service', 'case-management');
  fd.append('module', 'loadtest');
  fd.append('file', http.file(new Uint8Array(64 * 1024).buffer, 'load.bin', 'application/octet-stream'));

  const res = http.post(`${BASE_URL}/files`, fd.body(), {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': `multipart/form-data; boundary=${fd.boundary}`,
    },
  });

  check(res, {
    'upload status is 201': (r) => r.status === 201,
  });

  sleep(0.5);
}
