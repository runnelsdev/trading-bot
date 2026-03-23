module.exports = {
  apps: [
    {
      name: 'trading-bot',
      script: 'npm',
      args: 'run subscriber',
      cwd: '/opt/trading-bot',
      min_uptime: 30000,
      max_restarts: 10,
      exp_backoff_restart_delay: 1000,
      autorestart: true,
      watch: false,
      merge_logs: true,
    },
    {
      name: 'update-sidecar',
      script: 'src/update-sidecar.js',
      cwd: '/opt/trading-bot',
      min_uptime: 10000,
      max_restarts: 5,
      restart_delay: 60000,
      autorestart: true,
      watch: false,
      merge_logs: true,
    }
  ]
};
