import swaggerUi from 'swagger-ui-express';

export function setupSwagger(app, serviceName, port, extraPaths = {}) {
  const openApiSpec = {
    openapi: '3.0.0',
    info: {
      title: `IACMS - ${serviceName}`,
      version: '1.0.0',
      description: `Interactive OpenAPI 3.0 documentation for ${serviceName} microservice on port ${port}.`,
    },
    servers: [
      {
        url: `http://localhost:${port}`,
        description: 'Local Development Server',
      },
      {
        url: 'http://localhost:3000',
        description: 'API Gateway',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          summary: 'Service Health Check',
          description: `Returns operational health metrics for ${serviceName}`,
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      service: { type: 'string', example: serviceName },
                      timestamp: { type: 'string', example: new Date().toISOString() },
                    },
                  },
                },
              },
            },
          },
        },
      },
      ...extraPaths,
    },
  };

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));
  app.get('/api-docs.json', (req, res) => res.json(openApiSpec));
}
