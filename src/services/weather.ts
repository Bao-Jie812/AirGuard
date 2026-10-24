/**
 * 高德开放平台 · 南京市实况天气（Web 服务 API）
 *
 * 只读外部证据：任何失败（超时 / HTTP 错误 / 数据结构不符 / Key 鉴权失败）
 * 都会降级为 TIMEOUT / ERROR 状态返回，绝不抛出，不影响其他核心功能。
 *
 * 调试：所有关键步骤都会以 [天气] 前缀输出到浏览器控制台（F12 → Console）。
 */

export interface NanjingWeather {
  temperature: string
  text: string
  humidity: string | null
  windpower: string | null
  observedAt: string
}

export type WeatherResult =
  | { ok: true; data: NanjingWeather }
  | { ok: false; status: 'TIMEOUT' | 'ERROR'; message: string }

const API_KEY = (import.meta.env.VITE_AMAP_KEY as string | undefined) ?? ''

/** 南京 adcode */
const CITY_CODE = '320100'
const WEATHER_URL = `https://restapi.amap.com/v3/weather/weatherInfo?city=${CITY_CODE}&key=${API_KEY}`

const TIMEOUT_MS = 5000

function maskKey(key: string): string {
  if (key.length <= 6) return `***（长度 ${key.length}）`
  return `${key.slice(0, 3)}***${key.slice(-3)}（长度 ${key.length}）`
}

// 模块加载时打印一次 Key 读取结果，用于确认 .env 是否被 Vite 正确注入。
// 注意：修改 .env 后必须重启 npm run dev，Vite 只在启动时读取 .env。
console.log(
  '[天气] 环境变量检查 →',
  `VITE_AMAP_KEY=${API_KEY ? maskKey(API_KEY) : 'undefined'}`,
)
if (!API_KEY) {
  console.error(
    '[天气] VITE_AMAP_KEY 为 undefined。请检查：① .env 位于项目根目录；② 变量名以 VITE_ 开头；③ 修改 .env 后重启了 npm run dev。',
  )
}

interface AmapLive {
  weather?: string
  temperature?: string
  humidity?: string
  windpower?: string
  reporttime?: string
}

interface AmapWeatherResponse {
  /** '1' 成功；'0' 失败（此时 info / infocode 给出原因，lives 缺失或为空） */
  status?: string
  info?: string
  infocode?: string
  lives?: AmapLive[]
}

export async function fetchNanjingWeather(): Promise<WeatherResult> {
  if (!API_KEY) {
    return {
      ok: false,
      status: 'ERROR',
      message: '未配置 VITE_AMAP_KEY，无法请求高德天气。',
    }
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    console.log(
      '[天气] 发起请求 →',
      WEATHER_URL.replace(API_KEY, maskKey(API_KEY)),
    )
    const response = await fetch(WEATHER_URL, { signal: controller.signal })
    const json = (await response.json()) as AmapWeatherResponse
    // 完整打印真实返回，便于核对字段结构
    console.log('[天气] 高德天气完整返回 JSON →', json)

    if (!response.ok) {
      return {
        ok: false,
        status: 'ERROR',
        message: `高德天气接口返回 HTTP ${response.status}。`,
      }
    }

    // 高德业务错误：status='0'，info/infocode 说明原因（如 INVALID_USER_KEY）
    if (json.status !== '1') {
      return {
        ok: false,
        status: 'ERROR',
        message: `高德天气返回错误（infocode ${json.infocode ?? '—'}）：${json.info ?? '未知原因'}`,
      }
    }

    const live = json.lives?.[0]
    if (
      !live ||
      live.temperature === undefined ||
      live.weather === undefined
    ) {
      console.error(
        '[天气] 解析失败：lives[0] 缺少 temperature/weather，实际结构见上一条日志。',
      )
      return {
        ok: false,
        status: 'ERROR',
        message: '高德天气返回数据结构不符（完整 JSON 已打印到控制台）。',
      }
    }

    return {
      ok: true,
      data: {
        temperature: String(live.temperature),
        text: String(live.weather),
        humidity: live.humidity !== undefined ? String(live.humidity) : null,
        windpower:
          live.windpower !== undefined ? String(live.windpower) : null,
        observedAt: live.reporttime
          ? new Date(live.reporttime.replace(' ', 'T') + '+08:00').toISOString()
          : new Date().toISOString(),
      },
    }
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError'
    console.error('[天气] 请求异常 →', error)
    return {
      ok: false,
      status: isAbort ? 'TIMEOUT' : 'ERROR',
      message: isAbort
        ? `高德天气请求超时（${TIMEOUT_MS} ms）。`
        : `高德天气请求失败：${error instanceof Error ? error.message : '未知错误'}`,
    }
  } finally {
    window.clearTimeout(timer)
  }
}
