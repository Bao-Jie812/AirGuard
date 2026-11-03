import { useCallback, useEffect } from 'react'
import { AlertTriangle, Camera, Fan } from 'lucide-react'
import { getZone } from '../../data/zones'
import {
  ANOMALY_Z_THRESHOLD,
  formatZScore,
  type MetricAnomaly,
} from '../../domain/anomaly'
import { METRIC_META } from '../../domain/constants'
import { formatNumber, formatTimeWithSecondsFromMs } from '../../domain/format'
import { useLiveData } from '../../state/LiveDataContext'
import { useToast } from '../../state/ToastContext'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/**
 * 全局「ML 隐患预警」弹窗。
 *
 * 触发条件（检测逻辑在 LiveDataContext）：严格限定为规则/ML 分歧状态 ——
 *   固定规则未达 ALERT（NORMAL/WATCH），且轻量 ML 判定 ANOMALY。
 *   规则已到 ALERT/CRITICAL 的区域不弹此窗，越限走常规事件流。
 *
 * 交互（预警 → 现场取证 → 证据回传闭环）：
 *   【立即记录干预】登记轻量 Action「开启新风系统」（不创建事件），
 *     关闭弹窗并联动模拟器恢复；Z-score 回落至正常区间后隐患自动解除；
 *   【前往现场拍照取证】关闭弹窗，复制 H5 现场端直达链接（/m?zone=…&tab=scene）
 *     并提示到 iPad 操作；照片经 MQTT 回传后自动挂入该区域未关闭事件；
 *   【忽略】/ ESC / 点遮罩：关闭，同一区域 3 分钟内防抖不再弹窗。
 */

/** 按指标与偏离方向给出处置建议，与 ActionType 语义对齐 */
const METRIC_ADVICE: Record<
  MetricAnomaly['metric'],
  { rise: string; drop: string }
> = {
  co2: {
    rise: '建议立即开启通风或前往现场确认，避免浓度继续爬升。',
    drop: '浓度异常下降较为罕见，可能为传感器漂移或采样故障，建议现场复核读数。',
  },
  pm25: {
    rise: '建议排查污染源并开启净化 / 通风，避免颗粒物持续累积。',
    drop: '读数异常下降，可能为传感器漂移或滤网自检，建议现场复核。',
  },
  crowdDensity: {
    rise: '建议现场疏导人流并复核通行区域，避免局部过度聚集。',
    drop: '人流读数异常下降，可能为摄像头遮挡或统计故障，建议现场复核。',
  },
}

/** 预警原因文案：当前值 + 未越规则阈值 + 远超历史均值 + z 值 */
function describeMetric(item: MetricAnomaly): string {
  const meta = METRIC_META[item.metric]
  const direction = item.zScore >= 0 ? '异常上升' : '异常下降'
  return (
    `${meta.label}出现${direction}（当前 ` +
    `${formatNumber(item.value, item.digits)} ${item.unit}，规则未达 ALERT` +
    `（报警阈值 ${formatNumber(meta.alert, meta.digits)} ${item.unit}），` +
    `但远超历史均值 μ≈${formatNumber(item.mean, item.digits)} ${item.unit}，` +
    `z=${formatZScore(item.zScore)}）`
  )
}

export function MlAlertModal() {
  const { mlAlert, dismissMlAlert, recordMlIntervention } = useLiveData()
  const { toast } = useToast()

  const zoneId = mlAlert?.zoneId ?? null
  const detectedAt = mlAlert?.detectedAt ?? null

  // 每次出现一条新预警只播报一次；指标刷新不会重置 detectedAt，因此不会重复播报。
  useEffect(() => {
    if (!zoneId) return
    if (
      !('speechSynthesis' in window) ||
      typeof SpeechSynthesisUtterance === 'undefined'
    ) {
      return
    }

    const synthesis = window.speechSynthesis
    const zoneName = getZone(zoneId).shortName
    const utterance = new SpeechSynthesisUtterance(
      `注意，检测到${zoneName}环境指标出现异常波动，存在潜在隐患，请及时排查。`,
    )
    utterance.lang = 'zh-CN'
    utterance.rate = 1
    utterance.pitch = 1
    const chineseVoice = synthesis
      .getVoices()
      .find((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('zh'))
    if (chineseVoice) utterance.voice = chineseVoice

    // 清除上一次可能尚未结束的播报，避免多条预警排队播放过时内容。
    synthesis.cancel()
    synthesis.speak(utterance)
    return () => {
      // 弹窗关闭、升级为规则告警或切换到另一条预警时停止当前播报。
      synthesis.cancel()
    }
  }, [zoneId, detectedAt])

  // onClose 回调保持稳定引用：弹窗展示期间 mlAlert 会随读数刷新，
  // 避免 Modal 的 ESC/焦点副作用因子每次渲染都重建
  const handleIgnore = useCallback(() => {
    if (zoneId) dismissMlAlert(zoneId)
  }, [dismissMlAlert, zoneId])
  // 现场取证：大屏无法直接跳到 iPad，复制 H5 直达链接并提示；
  // 照片回传后由 LiveDataContext 自动挂入该区域未关闭事件
  const handleGoFieldEvidence = useCallback(() => {
    if (!zoneId) return
    dismissMlAlert(zoneId)
    const h5Path = `/m?zone=${zoneId}&tab=scene`
    void navigator.clipboard
      ?.writeText(`${window.location.origin}${h5Path}`)
      .catch(() => {})
    toast(
      `H5 现场端直达链接已复制（${h5Path}）。请在 iPad 上打开并拍照取证；照片回传后将自动挂入该区域事件的「人工核实证据」。`,
      'info',
    )
  }, [dismissMlAlert, zoneId, toast])
  const handleIntervene = useCallback(() => {
    if (!zoneId || !mlAlert) return
    recordMlIntervention(zoneId, mlAlert.metrics, mlAlert.maxAbsZ)
    toast(
      `已记录干预「开启新风系统」（${getZone(zoneId).name}），系统持续跟踪；Z-score 回落至正常区间后隐患自动解除。`,
      'success',
    )
  }, [zoneId, mlAlert, recordMlIntervention, toast])

  if (!mlAlert) return null
  const zone = getZone(mlAlert.zoneId)

  return (
    <Modal
      open
      size="md"
      className="ml-alert-modal"
      title="⚠️ ML 隐患预警"
      description="固定规则尚未达到 ALERT，但轻量 ML（Z-score 滑动窗口）检测到读数显著偏离历史分布，建议提前干预。"
      onClose={handleIgnore}
      footer={
        <>
          <Button variant="ghost" onClick={handleIgnore}>
            忽略
          </Button>
          <Button
            variant="secondary"
            icon={<Camera size={15} />}
            onClick={handleGoFieldEvidence}
          >
            前往现场拍照取证
          </Button>
          <Button
            variant="primary"
            className="ml-alert-modal__go"
            icon={<Fan size={15} />}
            onClick={handleIntervene}
          >
            立即记录干预
          </Button>
        </>
      }
    >
      <div className="ml-alert-modal__zone">
        <span className="ml-alert-modal__icon" aria-hidden="true">
          <AlertTriangle size={20} />
        </span>
        <div className="ml-alert-modal__zone-text">
          <strong>{zone.name}</strong>
          <p>
            首次检测于 {formatTimeWithSecondsFromMs(mlAlert.detectedAt)} · ML
            基线 {mlAlert.sampleSize} 点
          </p>
        </div>
        <Badge tone="warning" dot>
          规则未达 ALERT · ML ANOMALY
        </Badge>
      </div>

      <ul className="ml-alert-modal__reasons">
        {mlAlert.metrics.map((item) => (
          <li key={item.metric}>
            <p>{describeMetric(item)}</p>
            <p className="ml-alert-modal__advice">
              {item.zScore >= 0
                ? METRIC_ADVICE[item.metric].rise
                : METRIC_ADVICE[item.metric].drop}
            </p>
          </li>
        ))}
      </ul>

      <p className="ml-alert-modal__note">
        「立即记录干预」将登记轻量 Action「开启新风系统」（不创建事件），并联动设备恢复；
        系统持续跟踪，Z-score 回落至 ±{ANOMALY_Z_THRESHOLD} 内时隐患自动解除。
        若干预期间规则越限，将自动转入常规事件处置流程。
        忽略后 3 分钟内不再提醒本区域。
      </p>
    </Modal>
  )
}
