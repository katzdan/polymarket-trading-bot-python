
module.exports = {
  apps : [{
    name: "polymarket-copytrading-bot",
    script: "npx",
    args: "ts-node src/index.ts",
    interpreter: "none",
    env: {
      NODE_ENV: "production",
    },
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    log_date_format: "YYYY-MM-DD HH:mm Z",
    error_file: "logs/pm2-error.log",
    out_file: "logs/pm2-out.log",
    merge_logs: true
  }]
};
