/**
 * AirGuard MQTT 模拟器：每个区域都有独立状态锁，锁定期间不会被正常随机数据覆盖。
 *
 * NORMAL       → 每 5 秒发送正常随机波动数据。
 * ALERT_MODE   → 每 5 秒重复发送 CO2 850 / PM2.5 45，等待用户忽略或处置。
 * ESCALATE_AFTER_IGNORE → 用户忽略后启动 5 秒计时，随后进入 CRITICAL_MODE。
 * CRITICAL_MODE→ 每 5 秒重复发送 CO2 1600 / PM2.5 150，直到收到恢复指令。
 *
 * airguard/control：
 *   {"action":"TRIGGER_ALERT","zoneId":"zone-s"}  进入 ALERT_MODE。
 *   {"action":"RESET","zoneId":"zone-s"}          解除状态锁并恢复随机流。
 *   START_RECOVERY / TRIGGER_RECOVERY / RECOVER   与 RESET 等效。
 */
import mqtt from 'mqtt'

const BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://broker.emqx.io:1883'
const TOPIC_PREFIX = 'airguard/sensor'
const CONTROL_TOPIC = process.env.MQTT_CONTROL_TOPIC ?? 'airguard/control'
const INTERVAL_MS = 5000
const ESCALATION_DELAY_MS = 5000

const WATCH_READING = { pm25: 45, co2: 850 }
const CRITICAL_READING = { pm25: 150, co2: 1600 }
const NORMAL_CONFIG = {
  pm25: { min: 20, max: 30, step: 2, digits: 0 },
  co2: { min: 600, max: 700, step: 10, digits: 0 },
  crowdLevel: { min: 0.18, max: 0.45, step: 0.02, digits: 2 },
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function round(value, digits) {
  return Number(value.toFixed(digits))
}

function createZone(values) {
  return {
    zoneStatusMode: 'NORMAL',
    escalationTimer: null,
    values: { ...values },
  }
}

const zones = new Map([
  ['zone-n', createZone({ pm25: 24, co2: 620, crowdLevel: 0.22 })],
  ['zone-s', createZone({ pm25: 26, co2: 640, crowdLevel: 0.3 })],
  ['zone-w', createZone({ pm25: 28, co2: 660, crowdLevel: 0.36 })],
])

function statusOf({ pm25, co2, crowdLevel }) {
  if (pm25 >= 115 || co2 >= 1500 || crowdLevel >= 1) return 'CRITICAL'
  if (pm25 >= 75 || co2 >= 1000 || crowdLevel >= 0.8) return 'ALERT'
  if (pm25 >= 35 || co2 >= 800 || crowdLevel >= 0.5) return 'WATCH'
  return 'NORMAL'
}

const client = mqtt.connect(BROKER_URL, {
  clientId: `airguard-sim-${Math.random().toString(16).slice(2, 10)}`,
  reconnectPeriod: 3000,
  connectTimeout: 8000,
  queueQoSZero: false,
})

function publish(zoneId, values, locked = false) {
  const payload = {
    zoneId,
    ...values,
    time: new Date().toISOString(),
    ...(locked ? { isManual: true, source: 'SIMULATOR_LOCKED_SCRIPT' } : {}),
  }
  payload.status = statusOf(payload)
  const topic = `${TOPIC_PREFIX}/${zoneId}`
  client.publish(topic, JSON.stringify(payload), { qos: 0 }, (error) => {
    if (error) console.error(`[simulator] publish failed ${topic}:`, error.message)
  })
  console.log(`[simulator] [${payload.status}] ${topic}`, JSON.stringify(payload))
}

function clearEscalation(zone) {
  if (zone.escalationTimer !== null) {
    clearTimeout(zone.escalationTimer)
    zone.escalationTimer = null
  }
}

function publishLockedReading(zoneId) {
  const zone = zones.get(zoneId)
  const reading = zone.zoneStatusMode === 'CRITICAL_MODE' ? CRITICAL_READING : WATCH_READING
  zone.values = { ...zone.values, ...reading }
  publish(zoneId, zone.values, true)
}

function triggerAlert(zoneId) {
  const zone = zones.get(zoneId)
  clearEscalation(zone)
  zone.zoneStatusMode = 'ALERT_MODE'
  publishLockedReading(zoneId)
  console.log(`[simulator] ${zoneId} 已锁定 ALERT_MODE，等待忽略或处置；正常随机数据已暂停`)
}

function escalateAfterIgnore(zoneId) {
  const zone = zones.get(zoneId)
  clearEscalation(zone)
  if (zone.zoneStatusMode !== 'ALERT_MODE') return
  console.log(`[simulator] ${zoneId} 已忽略 ML 预警，5 秒后恶化为 CRITICAL_MODE`)
  zone.escalationTimer = setTimeout(() => {
    zone.escalationTimer = null
    if (zone.zoneStatusMode !== 'ALERT_MODE') return
    zone.zoneStatusMode = 'CRITICAL_MODE'
    publishLockedReading(zoneId)
    console.log(`[simulator] ${zoneId} 已恶化为 CRITICAL_MODE，将持续发送 1600 直到 RESET`)
  }, ESCALATION_DELAY_MS)
}

function normalReading(zone) {
  const next = { ...zone.values }
  for (const [key, config] of Object.entries(NORMAL_CONFIG)) {
    const delta = randomBetween(-config.step, config.step)
    next[key] = round(clamp(zone.values[key] + delta, config.min, config.max), config.digits)
  }
  return next
}

function resetZone(zoneId) {
  const zone = zones.get(zoneId)
  clearEscalation(zone)
  zone.zoneStatusMode = 'NORMAL'
  // RESET 立即给一组正常值，不必等待下一个五秒周期。
  for (const [key, config] of Object.entries(NORMAL_CONFIG)) {
    zone.values[key] = round(randomBetween(config.min, config.max), config.digits)
  }
  publish(zoneId, zone.values)
  console.log(`[simulator] ${zoneId} 已解除状态锁，恢复正常随机数据`)
}

function resolveTargetZones(message) {
  const zoneId = message.zoneId ?? message.zone_id ?? message.zone
  if (typeof zoneId === 'string' && zones.has(zoneId)) return [zoneId]
  if (zoneId === undefined) return [...zones.keys()]
  console.warn(`[simulator] 忽略未知区域: ${String(zoneId)}`)
  return []
}

client.on('connect', () => {
  console.log(`[simulator] connected to ${BROKER_URL}`)
  client.subscribe(CONTROL_TOPIC, (error) => {
    if (error) console.error('[simulator] subscribe control failed:', error.message)
    else console.log(`[simulator] listening control topic: ${CONTROL_TOPIC}`)
  })
  startPublishing()
})

client.on('reconnect', () => console.log('[simulator] reconnecting...'))
client.on('error', (error) => console.error('[simulator] error:', error.message))

client.on('message', (topic, payload) => {
  if (topic !== CONTROL_TOPIC) return
  let message
  try {
    message = JSON.parse(payload.toString())
  } catch {
    return
  }
  if (!message || typeof message !== 'object') return

  const action = String(message.action ?? message.command ?? '').trim().toUpperCase()
  const targets = resolveTargetZones(message)
  if (action === 'TRIGGER_ALERT' || action === 'TRIGGER_ESCALATION') {
    for (const zoneId of targets) triggerAlert(zoneId)
    return
  }
  if (action === 'ESCALATE_AFTER_IGNORE') {
    for (const zoneId of targets) escalateAfterIgnore(zoneId)
    return
  }
  if (['RESET', 'START_RECOVERY', 'TRIGGER_RECOVERY', 'RECOVER'].includes(action)) {
    for (const zoneId of targets) resetZone(zoneId)
  }
})

let timer = null

function startPublishing() {
  if (timer !== null) return
  tick()
  timer = setInterval(tick, INTERVAL_MS)
}

function tick() {
  for (const [zoneId, zone] of zones) {
    if (zone.zoneStatusMode === 'NORMAL') {
      zone.values = normalReading(zone)
      publish(zoneId, zone.values)
    } else {
      // 锁定期间只重发剧本值，绝不调用 normalReading。
      publishLockedReading(zoneId)
    }
  }
}

function shutdown() {
  if (timer !== null) clearInterval(timer)
  for (const zone of zones.values()) clearEscalation(zone)
  client.end()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
