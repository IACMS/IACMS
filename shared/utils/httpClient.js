/**
 * Shared HTTP Client for Service-to-Service Communication
 */

class HttpClient {
  constructor(baseURL, options = {}) {
    this.baseURL = baseURL;
    this.timeout = options.timeout || 5000;
    this.headers = options.headers || {};
  }

  async request(method, path, data = null, headers = {}) {
    const url = `${this.baseURL}${path}`;
    const config = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
        ...headers,
      },
      signal: AbortSignal.timeout(this.timeout),
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      config.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, config);
      const contentType = response.headers.get('content-type');
      
      let responseData;
      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      if (!response.ok) {
        throw new Error(
          responseData.message || `HTTP ${response.status}: ${response.statusText}`
        );
      }

      return responseData;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      throw error;
    }
  }

  get(path, headers) {
    return this.request('GET', path, null, headers);
  }

  post(path, data, headers) {
    return this.request('POST', path, data, headers);
  }

  put(path, data, headers) {
    return this.request('PUT', path, data, headers);
  }

  patch(path, data, headers) {
    return this.request('PATCH', path, data, headers);
  }

  delete(path, headers) {
    return this.request('DELETE', path, null, headers);
  }
}

export default HttpClient;

