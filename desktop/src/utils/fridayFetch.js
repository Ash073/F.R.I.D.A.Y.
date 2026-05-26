// c:\Users\Sayyed Ashif\Downloads\FRIDAY\friday\desktop\src\utils\fridayFetch.js

const LOCAL = 'http://localhost:8888'
const CLOUD = window.FRIDAY_CLOUD_URL || ''

const CLOUD_ONLY = ['spotify']

async function fridayFetch(feature, path, options = {}) {
  const isCloudOnly = CLOUD_ONLY.includes(feature)

  if (isCloudOnly && CLOUD) {
    return _fetch(CLOUD, path, options, 'CLOUD')
  }

  try {
    return await _fetch(LOCAL, path, {
      ...options,
      signal: AbortSignal.timeout(2000)
    }, 'LOCAL')
  } catch (err) {
    console.warn('[FRIDAY] Local unreachable, falling back to cloud:', err.message)
    if (CLOUD) return _fetch(CLOUD, path, options, 'CLOUD')
    throw new Error('Both local and cloud backends are unreachable')
  }
}

async function _fetch(base, path, options, label) {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    console.log(`[FRIDAY] ${label} → ${path}`)
    return res.json()
  } catch (err) {
    console.error(`[FRIDAY] ${label} fetch failed:`, err.message)
    throw err
  }
}

async function checkLocalHealth() {
  try {
    const res = await fetch(`${LOCAL}/health`, {
      signal: AbortSignal.timeout(2000)
    })
    const data = await res.json()
    window.FRIDAY_LOCAL_ONLINE = data.status === 'ok'
    console.log('[FRIDAY] Local backend:', data)
    return true
  } catch {
    window.FRIDAY_LOCAL_ONLINE = false
    console.warn('[FRIDAY] Local backend offline')
    return false
  }
}

window.fridayFetch = fridayFetch
window.checkLocalHealth = checkLocalHealth
