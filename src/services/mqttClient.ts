/**
 * 浏览器端 MQTT 客户端（WebSocket 接入 EMQX 公共 Broker）。
 *
 * mqtt.js 自带断线重连（reconnectPeriod），这里只做单例封装，
 * 供 LiveDataProvider 订阅传感器数据与多端处置同步。
 */
import mqtt, { type MqttClient } from 'mqtt'

/**
 * 浏览器端 Broker 地址：必须使用 wss（TLS WebSocket）。
 * 若页面经 HTTPS 部署（如演示环境），浏览器混合内容策略会静默拦截
 * ws:// 明文连接 —— iPad H5 端表现为 MQTT 永远离线、照片无法同步；
 * wss 在 HTTP 开发环境同样可用，不存在回退代价。
 */
export const MQTT_WS_URL = 'wss://broker.emqx.io:8084/mqtt'
export const SENSOR_TOPIC = 'airguard/sensor/#'
export const SENSOR_TOPIC_PREFIX = 'airguard/sensor/'
export const EVENT_TOPIC = 'airguard/event/#'
export const EVENT_TOPIC_PREFIX = 'airguard/event/'
export const CONTROL_TOPIC = 'airguard/control'
export const EVIDENCE_TOPIC = 'airguard/evidence/#'
export const EVIDENCE_TOPIC_PREFIX = 'airguard/evidence/'
/**
 * 现场取证专用 Topic：H5 拍照 / Web 上传的人工观察统一发到这里，
 * 报文内携带 zoneId 与 eventId（若有未关闭事件）。
 * 仍落在 airguard/evidence/# 订阅范围内，接收端无需新增订阅。
 */
export const EVIDENCE_UPLOAD_TOPIC = 'airguard/evidence/upload'

export const CLIENT_ID = `airguard-web-${Math.random().toString(16).slice(2, 10)}`

let client: MqttClient | null = null

export function getMqttClient(): MqttClient {
  if (!client) {
    client = mqtt.connect(MQTT_WS_URL, {
      clientId: CLIENT_ID,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      clean: true,
    })
  }
  return client
}
