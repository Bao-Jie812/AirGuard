/**
 * AirGuard MQTT 传感器模拟器（平滑渐变 · 上帝模式）
 *
 * 每 5 秒向 airguard/sensor/zone-n | zone-s | zone-w 发布一条 JSON：
 *   { pm25, co2, crowdLevel, status, time, zoneId }
 *
 * ★ 上帝模式（默认）
 * 模拟器只发送「正常且达标」的数据，状态恒为 NORMAL：
 *   PM2.5   20–30    （WATCH 阈值 35）
 *   CO₂     600–780  （WATCH 阈值 800）
 *   人流    0.18–0.45（WATCH 阈值 0.5）
 *
 * ★ 平滑过渡
 * 数值不是每次随机重抽，而是围绕上一次值做有上限的随机游走：
 *   CO₂ ±10/次、PM2.5 ±2/次、人流 ±0.02/次。
 * 正常区间内任何相邻两点的变化都不会超过上述步长，折线不会出现“心电图”。
 * 只有异常指令触发时，才允许以更大的步长快速爬升到超标区间；
 * 恢复指令下达后，同样按有限的步长平滑回落，不回跳成断崖。
 *
 * ★ 控制主题 airguard/control
 * - {"action":"TRIGGER_ALERT","zoneId":"zone-w"}
 *     → 立刻推送一条 ALERT 级读数（不等 5 秒定时器），随后进入异常模式，
 *       共 3 次发送并快速爬升至严重超标；
 *       可选 "ticks": 1–60 自定义持续次数；省略 zoneId 则全部区域。
 * - {"action":"TRIGGER_RECOVERY","zoneId":"zone-w"}
 * - {"action":"START_RECOVERY","zoneId":"zone-w"}
 *     → 立即切回正常模式并平滑回落；省略 zoneId 则全部区域恢复。
 *
 * 运行：npm run simulator
 */
import mqtt from 'mqtt'

const BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://broker.emqx.io:1883'
const TOPIC_PREFIX = 'airguard/sensor'
const CONTROL_TOPIC = process.env.MQTT_CONTROL_TOPIC ?? 'airguard/control'
const INTERVAL_MS = 5000

/** 一次 TRIGGER_ALERT 默认连续发送的异常次数（3 次 × 5 秒 = 15 秒） */
const DEFAULT_ALERT_TICKS = 3

/**
 * 正常模式配置：
 *   min/max       正常值硬边界（全部低于前端 WATCH 阈值）
 *   maxStep       正常区间内单次变化上限
 *   recoveryStep  从异常区回落时的单次变化上限（仍为平滑过渡，不是瞬跳）
 */
const NORMAL_CONFIG = {
  pm25: { min: 20, max: 30, maxStep: 2, recoveryStep: 45, digits: 0 },
  co2: { min: 600, max: 780, maxStep: 10, recoveryStep: 400, digits: 0 },
  crowdLevel: {
    min: 0.18,
    max: 0.45,
    maxStep: 0.02,
    recoveryStep: 0.15,
    digits: 2,
  },
}

/** 异常模式目标区间（高于 CRITICAL 阈值：PM2.5 ≥115、CO₂ ≥1500） */
const ALERT_CONFIG = {
  pm25: { min: 120, max: 170, maxStep: 60, digits: 0 },
  co2: { min: 1500, max: 1620, maxStep: 400, digits: 0 },
}

/**
 * 收到 TRIGGER_ALERT 后立即推送的“入口读数”。
 * 刻意停在 ALERT 区间上沿（PM2.5 <115、CO₂ <1500），
 * 使前端状态立即变为 ALERT，同时 Priority 得分约 46 分：
 *   PM2.5 110 → severity 76.25 × 0.3
 *   CO₂  1450 → severity 77.00 × 0.3
 * 下一次定时 tick 再继续爬升到 CRITICAL。
 */
const ALERT_ENTRY = { pm25: 110, co2: 1450 }

const METRIC_KEYS = ['pm25', 'co2', 'crowdLevel']

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function round(value, digits) {
  return Number(value.toFixed(digits))
}

function createMetric(initial, target = initial) {
  return { value: initial, target }
}

function createZone(values) {
  return {
    mode: 'NORMAL',
    alertTicksLeft: 0,
    pm25: createMetric(values.pm25),
    co2: createMetric(values.co2),
    crowdLevel: createMetric(values.crowdLevel),
  }
}

/** 三区域初始值全部落在正常区间内 */
const zones = new Map([
  ['zone-n', createZone({ pm25: 24, co2: 650, crowdLevel: 0.22 })],
  ['zone-s', createZone({ pm25: 26, co2: 700, crowdLevel: 0.3 })],
  ['zone-w', createZone({ pm25: 28, co2: 740, crowdLevel: 0.36 })],
])

function statusOf({ pm25, co2, crowdLevel }) {
  if (pm25 >= 115 || co2 >= 1500 || crowdLevel >= 1) return 'CRITICAL'
  if (pm25 >= 75 || co2 >= 1000 || crowdLevel >= 0.8) return 'ALERT'
  if (pm25 >= 35 || co2 >= 800 || crowdLevel >= 0.5) return 'WATCH'
  return 'NORMAL'
}

/**
 * 正常模式单步：
 * 1. 目标值始终限定在正常区间；
 * 2. 每次只向目标靠近 maxStep，绝不整段跳变；
 * 3. 从异常值回落时使用 recoveryStep，并最终钳制回正常区间。
 */
function stepNormal(metric, config) {
  const outsideBand = metric.value < config.min || metric.value > config.max
  const step = outsideBand ? config.recoveryStep : config.maxStep

  if (Math.abs(metric.target - metric.value) < step) {
    metric.target = randomBetween(config.min, config.max)
  }

  const delta = clamp(metric.target - metric.value, -step, step)
  const next = clamp(metric.value + delta, config.min, config.max)
  metric.value = round(next, config.digits)
  return metric.value
}

/** 异常模式单步：向异常目标快速但有限步地爬升/波动 */
function stepAlert(metric, config) {
  if (Math.abs(metric.target - metric.value) < config.maxStep) {
    metric.target = randomBetween(config.min, config.max)
  }
  const delta = clamp(metric.target - metric.value, -config.maxStep, config.maxStep)
  metric.value = round(Math.max(0, metric.value + delta), config.digits)
  return metric.value
}

function enterAlert(zone, ticks) {
  zone.mode = 'ALERT'
  zone.alertTicksLeft = ticks
  for (const key of ['pm25', 'co2']) {
    zone[key].target = randomBetween(
      ALERT_CONFIG[key].min,
      ALERT_CONFIG[key].max,
    )
  }
}

function enterNormal(zone) {
  zone.mode = 'NORMAL'
  zone.alertTicksLeft = 0
  for (const key of METRIC_KEYS) {
    zone[key].target = randomBetween(
      NORMAL_CONFIG[key].min,
      NORMAL_CONFIG[key].max,
    )
  }
}

function resolveTargetZones(message) {
  const zoneId = message.zoneId ?? message.zone_id ?? message.zone
  if (typeof zoneId === 'string' && zones.has(zoneId)) return [zoneId]
  if (zoneId === undefined) return [...zones.keys()]
  console.warn(`[simulator] 忽略未知区域: ${String(zoneId)}`)
  return []
}

const client = mqtt.connect(BROKER_URL, {
  clientId: `airguard-sim-${Math.random().toString(16).slice(2, 10)}`,
  reconnectPeriod: 3000,
  connectTimeout: 8000,
  // 离线期间不缓存 QoS0 实时读数：重连后只发新数据，
  // 避免把断网期间的旧值一次性灌给前端。
  queueQoSZero: false,
})

client.on('connect', () => {
  console.log(`[simulator] connected to ${BROKER_URL}`)
  client.subscribe(CONTROL_TOPIC, (error) => {
    if (error) {
      console.error('[simulator] subscribe control failed:', error.message)
    } else {
      console.log(`[simulator] listening control topic: ${CONTROL_TOPIC}`)
    }
  })
})

client.on('reconnect', () => {
  console.log('[simulator] reconnecting...')
})

client.on('error', (error) => {
  console.error('[simulator] error:', error.message)
})

client.on('message', (topic, payload) => {
  if (topic !== CONTROL_TOPIC) return

  let message
  try {
    message = JSON.parse(payload.toString())
  } catch {
    return
  }

  const action = String(message.action ?? message.command ?? '')
    .trim()
    .toUpperCase()

  if (action === 'TRIGGER_ALERT') {
    const targets = resolveTargetZones(message)
    const ticks = Number.isFinite(Number(message.ticks))
      ? clamp(Math.round(Number(message.ticks)), 1, 60)
      : DEFAULT_ALERT_TICKS
    for (const zoneId of targets) {
      enterAlert(zones.get(zoneId), ticks)
      console.log(
        `[simulator] 收到触发指令：${zoneId} 立即推送 ALERT 数据，并进入异常模式（共 ${ticks} 次发送）`,
      )
      // 关键：收到指令后立刻推送一条 ALERT 级读数，
      // 不等下一次 5 秒定时器。前端因此能马上用真实 MQTT 数据
      // 计算状态、Priority 并自动创建事件，而不是先造一个“空事件”。
      publishAlertEntry(zoneId, zones.get(zoneId))
    }
    return
  }

  if (
    action === 'TRIGGER_RECOVERY' ||
    action === 'START_RECOVERY' ||
    action === 'RECOVER' ||
    action === 'RESET'
  ) {
    const targets = resolveTargetZones(message)
    for (const zoneId of targets) {
      enterNormal(zones.get(zoneId))
      console.log(`[simulator] 收到恢复指令：${zoneId} 平滑恢复正常数据`)
    }
  }
})

let timer = null

function publishPayload(zoneId, payload) {
  const topic = `${TOPIC_PREFIX}/${zoneId}`
  client.publish(topic, JSON.stringify(payload), { qos: 0 }, (error) => {
    if (error) {
      console.error(`[simulator] publish failed ${topic}:`, error.message)
    }
  })
  const modeTag = payload.status === 'NORMAL' ? '' : ` [${payload.status}]`
  console.log(`[simulator]${modeTag} ${topic}`, JSON.stringify(payload))
}

/**
 * 触发指令的即时响应：把指标直接抬到 ALERT 区间并发布一条读数。
 * 这条读数计入异常发送次数，后续定时 tick 继续向 CRITICAL 爬升。
 */
function publishAlertEntry(zoneId, zone) {
  zone.pm25.value = ALERT_ENTRY.pm25
  zone.co2.value = ALERT_ENTRY.co2
  zone.crowdLevel.target = randomBetween(
    NORMAL_CONFIG.crowdLevel.min,
    NORMAL_CONFIG.crowdLevel.max,
  )

  const payload = {
    zoneId,
    pm25: zone.pm25.value,
    co2: zone.co2.value,
    crowdLevel: zone.crowdLevel.value,
    time: new Date().toISOString(),
  }
  payload.status = statusOf(payload)
  publishPayload(zoneId, payload)

  zone.alertTicksLeft -= 1
  if (zone.alertTicksLeft <= 0) {
    enterNormal(zone)
    console.log(`[simulator] ${zoneId} 异常发送结束，开始平滑恢复正常数据`)
  }
}

function startPublishing() {
  // MQTT 每次重连都会触发 connect；这里保证只有一个发布定时器，
  // 否则重连后会出现多个 setInterval 并发推送，数据节奏越来越乱。
  if (timer !== null) return
  tick()
  timer = setInterval(tick, INTERVAL_MS)
}

function tick() {
  const time = new Date().toISOString()

  for (const [zoneId, zone] of zones) {
    const payload = {
      zoneId,
      pm25:
        zone.mode === 'ALERT'
          ? stepAlert(zone.pm25, ALERT_CONFIG.pm25)
          : stepNormal(zone.pm25, NORMAL_CONFIG.pm25),
      co2:
        zone.mode === 'ALERT'
          ? stepAlert(zone.co2, ALERT_CONFIG.co2)
          : stepNormal(zone.co2, NORMAL_CONFIG.co2),
      crowdLevel: stepNormal(zone.crowdLevel, NORMAL_CONFIG.crowdLevel),
      time,
    }
    payload.status = statusOf(payload)
    publishPayload(zoneId, payload)

    if (zone.mode === 'ALERT') {
      zone.alertTicksLeft -= 1
      if (zone.alertTicksLeft <= 0) {
        enterNormal(zone)
        console.log(
          `[simulator] ${zoneId} 异常发送结束，开始平滑恢复正常数据`,
        )
      }
    }
  }
}

client.on('connect', startPublishing)

process.on('SIGINT', () => {
  if (timer !== null) clearInterval(timer)
  client.end()
  process.exit(0)
})

process.on('SIGTERM', () => {
  if (timer !== null) clearInterval(timer)
  client.end()
  process.exit(0)
})
