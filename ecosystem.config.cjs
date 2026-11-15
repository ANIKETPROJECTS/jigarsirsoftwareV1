const path = require('node:path');

module.exports = {
  apps: [
    {
      name: 'gms-app',
      cwd: path.join(__dirname, 'backend'),
      script: 'src/server.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: '3001',
      },
    },
  ],
};
