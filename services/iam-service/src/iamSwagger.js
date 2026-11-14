import swaggerUi from 'swagger-ui-express';

export function setupSwagger(app, serviceName, port, extraPaths = {}) {
  const spec = {
    openapi: '3.0.0',
    info: { title: `Identity Platform - ${serviceName}`, version: '1.0.0', description: `API documentation for ${serviceName}.` },
    servers: [
      { url: `http://localhost:${port}`, description: 'Local service' },
      ...(process.env.API_GATEWAY_URL ? [{ url: process.env.API_GATEWAY_URL, description: 'Configured API gateway' }] : []),
    ],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': { get: { summary: 'Health check', responses: { '200': { description: 'Service is healthy' } } } },
      ...extraPaths,
    },
  };
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  app.get('/api-docs.json', (_req, res) => res.json(spec));
}
