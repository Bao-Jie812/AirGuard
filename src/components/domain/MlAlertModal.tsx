import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Fan } from 'lucide-react'
import { getZone } from '../../data/zones'
import {
  ANOMALY_Z_THRESHOLD,
  formatZScore,
  type MetricAnomaly,
} from '../../domain/anomaly'
import { METRIC_META } from '../../domain/constants'
import { formatNumber, formatTimeWithSecondsFromMs } from '../../domain/format'
import { useLiveData } from '../../state/LiveDataContext'
import { useSelectedZone } from '../../state/SelectedZone'
import { useToast } from '../../state/ToastContext'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

/**
 * 全局「ML 隐患预警」弹窗。
 *
 * 触发条件（检测逻辑在 LiveDataContext）：严格限定为规则/ML 分歧状态 ——
 *   固定规则判定 NORMAL，且轻量 ML（Z-score 滑动窗口）判定 ANOMALY。
 *   规则已到 WATCH/ALERT/CRITICAL 的区域不弹此窗，越限走常规事件流。
 *
 * 交互：
 *   【立即记录干预】登记轻量 Action「开启新风系统」（不创建事件），
 *     关闭弹窗并联动模拟器恢复；Z-score 回落至正常区间后隐患自动解除；
 *   【前往查看详情】关闭弹窗并跳转到「事件与处置」页（按该区域筛选）；
 *   【忽略】/ ESC / 点遮罩：关闭，同一区域 3 分钟内防抖不再弹窗。
 */

/** 按指标给出处置建议，与 ActionType 语义对齐 */
const METRIC_ADVICE: Record<MetricAnomaly['metric'], string> = {
  co2: '建议立即开启通风或前往现场确认，避免浓度继续爬升。',
  pm25: '建议排查污染源并开启净化 / 通风，避免颗粒物持续累积。',
  crowdDensity: '建议现场疏导人流并复核通行区域，避免局部过度聚集。',
}

/** 预警原因文案：当前值 + 未越规则阈值 + 远超历史均值 + z 值 */
function describeMetric(item: MetricAnomaly): string {
  const meta = METRIC_META[item.metric]
  const direction = item.zScore >= 0 ? '异常上升' : '异常下降'
  return (
    `${meta.label}出现${direction}（当前 ` +
    `${formatNumber(item.value, item.digits)} ${item.unit}，规则判定正常` +
    `（关注阈值 ${formatNumber(meta.watch, meta.digits)} ${item.unit}），` +
    `但远超历史均值 μ≈${formatNumber(item.mean, item.digits)} ${item.unit}，` +
    `z=${formatZScore(item.zScore)}）`
  )
}

export function MlAlertModal() {
  const { mlAlert, dismissMlAlert, recordMlIntervention } = useLiveData()
  const { setSelectedZoneId } = useSelectedZone()
  const { toast } = useToast()
  const navigate = useNavigate()

  const zoneId = mlAlert?.zoneId ?? null
  // onClose 回调保持稳定引用：弹窗展示期间 mlAlert 会随读数刷新，
  // 避免 Modal 的 ESC/焦点副作用因子每次渲染都重建
  const handleIgnore = useCallback(() => {
    if (zoneId) dismissMlAlert(zoneId)
  }, [dismissMlAlert, zoneId])
  const handleGoDetail = useCallback(() => {
    if (!zoneId) return
    dismissMlAlert(zoneId)
    setSelectedZoneId(zoneId)
    navigate(`/events?zone=${zoneId}`)
  }, [dismissMlAlert, setSelectedZoneId, navigate, zoneId])
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
      description="固定规则判定正常，但轻量 ML（Z-score 滑动窗口）检测到读数显著偏离历史分布 —— 规则/ML 分歧，交集从严建议提前干预。"
      onClose={handleIgnore}
      footer={
        <>
          <Button variant="ghost" onClick={handleIgnore}>
            忽略
          </Button>
          <Button
            variant="secondary"
            iconAfter={<ArrowRight size={15} />}
            onClick={handleGoDetail}
          >
            前往查看详情
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
          规则正常 · ML ANOMALY
        </Badge>
      </div>

      <ul className="ml-alert-modal__reasons">
        {mlAlert.metrics.map((item) => (
          <li key={item.metric}>
            <p>{describeMetric(item)}</p>
            <p className="ml-alert-modal__advice">
              {METRIC_ADVICE[item.metric]}
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
