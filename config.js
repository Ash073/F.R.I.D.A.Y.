// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\config.js
/**
 * F.R.I.D.A.Y. Shared Configuration
 * Configures endpoint routing, environment settings, and cloud integration.
 */

const LOCAL_URL = 'http://localhost:8888';
const CLOUD_URL = process.env.CLOUD_URL || 'https://f-r-i-d-a-y-8ixf.onrender.com';

module.exports = {
  LOCAL_URL,
  CLOUD_URL,
  CLOUD_ONLY_FEATURES: ['spotify', 'mobile'],
  ENABLE_WHISPER: process.env.ENABLE_WHISPER === 'true'
};
