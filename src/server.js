import app from './app.js';
import config from './config/config.js';

const PORT = config.port || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${config.env} mode`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export default server;
