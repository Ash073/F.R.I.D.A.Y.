// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\ecosystem.config.js

module.exports = {
  apps: [
    {
      name: 'friday-backend',
      script: 'server.js',
      cwd: './backend',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: 8888,
        ENABLE_WHISPER: 'true'
      },
      error_file: '../logs/friday-error.log',
      out_file: '../logs/friday-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      time: true
    }
  ]
}
