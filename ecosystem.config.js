// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\ecosystem.config.js
/**
 * PM2 Application Configuration
 * Deploys the local F.R.I.D.A.Y. edge server with proper environments.
 */

module.exports = {
  apps: [{
    name: 'friday-local',
    script: 'backend/server.js',
    watch: false,
    env: {
      PORT: 8888,
      ENABLE_WHISPER: 'true',
      NODE_ENV: 'development'
    }
  }]
};
