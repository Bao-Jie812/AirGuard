/**
 * 浏览器端 MQTT 客户端（WebSocket 接入 EMQX 公共 Broker）。
 *
 * mqtt.js 自带断线重连（reconnectPeriod），这里只做单例封装，
 * 供 LiveDataProvider 订阅传感器数据与多端处置同步。
 */
import mqtt, { type MqttClient } from 'mqtt'

export const MQTT_WS_URL = 'ws://broker.emqx.io:8083/mqtt'
export const SENSOR_TOPIC = 'airguard/sensor/#'
export const SENSOR_TOPIC_PREFIX = 'airguard/sensor/'
export const EVENT_TOPIC = 'airguard/event/#'
export const EVENT_TOPIC_PREFIX = 'airguard/event/'
export const CONTROL_TOPIC = 'airguard/control'
export const EVIDENCE_TOPIC = 'airguard/evidence/#'
export const EVIDENCE_TOPIC_PREFIX = 'airguard/evidence/'

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
