'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  AIRFLOW_COLOR,
  FRAME_COLOR,
  Person,
  SceneContainer,
  SwingWindow,
  WallMaterial,
  alertOf,
  type InteriorSceneProps,
} from './interiorShared'

/**
 * 低多边形 3D 食堂微场景（zone-w 第二食堂）：嵌套在区域详情弹窗中作为「内部实景模拟」。
 *
 * 布局：后墙一排圆柱体打饭窗口 + 长条取餐台，大厅两张长条连排餐桌配小圆凳。
 * 交互由两个 props 驱动：
 *   status     —— ALERT / CRITICAL 时环境光平滑转为暖红，大厅从 4 人增至 10 人显得拥挤；
 *                 NORMAL 为冷白明亮、人流稀疏
 *   actionType —— 'FAN' 顶部横梁下出现大型排风扇（圆柱机身 + 扇叶）持续旋转，
 *                 并伴随向下生长的蓝色涡旋气流；
 *                 'WINDOW' 东墙两扇玻璃窗绕竖直铰链向外平滑旋开
 *
 * 相机：东南上方俯视——东墙窗户朝相机翻开，排风扇与涡旋在画面中心。
 */

const PI = Math.PI

/* ---------------- 大厅框架：地台 + 后墙 + 两侧墙（前侧开敞） ---------------- */
function Hall() {
  return (
    <group>
      {/* 地台与地板 */}
      <mesh position={[0, -0.12, 0.1]} receiveShadow>
        <boxGeometry args={[10.4, 0.24, 8]} />
        <meshStandardMaterial color="#efece4" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.012, 0.1]} receiveShadow>
        <boxGeometry args={[9.8, 0.024, 7.4]} />
        <meshStandardMaterial color="#ddd3bd" roughness={0.9} />
      </mesh>

      {/* 后墙 z=-3.68 */}
      <mesh position={[0, 1.6, -3.68]} castShadow receiveShadow>
        <boxGeometry args={[9.8, 3.2, 0.16]} />
        <WallMaterial />
      </mesh>
      {/* 两侧墙 x=±4.82 */}
      {[-4.82, 4.82].map((x) => (
        <mesh key={x} position={[x, 1.6, 0.1]} castShadow receiveShadow>
          <boxGeometry args={[0.16, 3.2, 7.4]} />
          <WallMaterial />
        </mesh>
      ))}

      {/* 顶部横梁：排风扇挂载点（不做整面吊顶，避免挡住俯视相机） */}
      <mesh position={[0, 3.12, 0]} castShadow>
        <boxGeometry args={[9.8, 0.18, 0.34]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
      </mesh>
    </group>
  )
}

/* ---------------- 打饭区：圆柱体窗口亭 + 长条取餐台 ---------------- */
function ServingKiosk({ x }: { x: number }) {
  return (
    <group position={[x, 0, -3.05]}>
      {/* 圆柱窗口亭主体 */}
      <mesh position={[0, 1.15, 0]} castShadow>
        <cylinderGeometry args={[0.42, 0.46, 2.3, 14]} />
        <meshStandardMaterial color="#d8dcd6" roughness={0.7} />
      </mesh>
      {/* 顶部檐盖 */}
      <mesh position={[0, 2.34, 0]} castShadow>
        <cylinderGeometry args={[0.52, 0.52, 0.1, 14]} />
        <meshStandardMaterial color="#8e979c" roughness={0.6} />
      </mesh>
      {/* 出餐窗台 */}
      <mesh position={[0, 1.06, 0.36]} castShadow>
        <boxGeometry args={[0.95, 0.06, 0.32]} />
        <meshStandardMaterial color="#8c6a4f" roughness={0.8} />
      </mesh>
    </group>
  )
}

function ServingCounter() {
  return (
    <group>
      <mesh position={[0, 0.46, -2.35]} castShadow receiveShadow>
        <boxGeometry args={[7.6, 0.92, 0.5]} />
        <meshStandardMaterial color="#a98a68" roughness={0.85} />
      </mesh>
      {/* 不锈钢台面 */}
      <mesh position={[0, 0.94, -2.35]} castShadow>
        <boxGeometry args={[7.7, 0.04, 0.56]} />
        <meshStandardMaterial color="#c8cfd2" roughness={0.4} metalness={0.35} />
      </mesh>
    </group>
  )
}

/* ---------------- 长条餐桌 + 小圆凳 ---------------- */
function LongTable({ z }: { z: number }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 0.08, 1.0]} />
        <meshStandardMaterial color="#b08968" roughness={0.8} />
      </mesh>
      {[-2.2, 2.2].map((x) => (
        <mesh key={x} position={[x, 0.36, 0]} castShadow>
          <boxGeometry args={[0.08, 0.72, 0.8]} />
          <meshStandardMaterial color="#8c6a4f" roughness={0.85} />
        </mesh>
      ))}
      {/* 两侧小圆凳 */}
      {[-1.8, -0.9, 0, 0.9, 1.8].map((x) =>
        [-0.62, 0.62].map((dz) => (
          <mesh key={`${x}:${dz}`} position={[x, 0.225, dz]} castShadow>
            <cylinderGeometry args={[0.17, 0.19, 0.45, 10]} />
            <meshStandardMaterial color="#a8adb3" roughness={0.85} />
          </mesh>
        )),
      )}
    </group>
  )
}

/* ---------------- 顶部排风扇：FAN 时从横梁下长出并持续旋转 ---------------- */
function FanBlades({ spinning }: { spinning: boolean }) {
  const ref = useRef<THREE.Group>(null!)
  const speed = useRef(0)
  useFrame((_, delta) => {
    // 转速缓启缓停；扇叶水平，绕竖直轴旋转
    speed.current = THREE.MathUtils.damp(speed.current, spinning ? 11 : 0, 2.5, delta)
    ref.current.rotation.y += speed.current * delta
  })
  return (
    <group ref={ref} position={[0, -0.56, 0]}>
      {[0, 1, 2, 3].map((i) => (
        <group key={i} rotation={[0, (i * PI) / 2, 0]}>
          {/* 叶片绕长轴扭转 0.38 rad 形成攻角 */}
          <mesh position={[0.55, 0, 0]} rotation={[0.38, 0, 0]} castShadow>
            <boxGeometry args={[0.95, 0.02, 0.18]} />
            <meshStandardMaterial color="#7c878d" roughness={0.6} />
          </mesh>
        </group>
      ))}
      {/* 中心毂 */}
      <mesh castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.14, 12]} />
        <meshStandardMaterial color="#6f7a80" roughness={0.55} />
      </mesh>
    </group>
  )
}

function ExhaustFan() {
  const ref = useRef<THREE.Group>(null!)
  useFrame((_, delta) => {
    // 出现动画：整体从 0 放大到 1
    const s = THREE.MathUtils.damp(ref.current.scale.x, 1, 4, delta)
    ref.current.scale.setScalar(Math.max(s, 0.01))
  })
  return (
    <group ref={ref} position={[0, 2.98, 0]} scale={0.01}>
      {/* 吊杆 */}
      <mesh position={[0, -0.17, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 0.34, 8]} />
        <meshStandardMaterial color="#6f7a80" roughness={0.6} />
      </mesh>
      {/* 圆柱机身 */}
      <mesh position={[0, -0.42, 0]} castShadow>
        <cylinderGeometry args={[0.52, 0.52, 0.24, 20]} />
        <meshStandardMaterial color="#8e979c" roughness={0.55} metalness={0.25} />
      </mesh>
      <FanBlades spinning />
    </group>
  )
}

/* ---------------- 蓝色涡旋气流：FAN 时从扇下向下生长并旋转 ---------------- */
function swirlCurve(phase: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const angle = phase + t * 2.4 * 2 * PI
    const radius = 0.22 + t * 0.55
    points.push(new THREE.Vector3(Math.cos(angle) * radius, -t * 1.6, Math.sin(angle) * radius))
  }
  return new THREE.CatmullRomCurve3(points)
}

function FanSwirl() {
  const ref = useRef<THREE.Group>(null!)
  const curves = useMemo(() => [0, 1, 2].map((i) => swirlCurve((i * 2 * PI) / 3)), [])
  useFrame((_, delta) => {
    ref.current.rotation.y += delta * 2.8
    // 从扇底向下生长
    const s = THREE.MathUtils.damp(ref.current.scale.y, 1, 3, delta)
    ref.current.scale.set(1, Math.max(s, 0.01), 1)
  })
  return (
    <group ref={ref} position={[0, 2.3, 0]} scale={[1, 0.01, 1]}>
      {curves.map((curve, i) => (
        <mesh key={i}>
          <tubeGeometry args={[curve, 72, 0.017, 6, false]} />
          <meshStandardMaterial
            color={AIRFLOW_COLOR}
            transparent
            opacity={0.45}
            roughness={0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- 人流：正常 4 人稀疏，告警追加 6 人（排队 + 满座） ---------------- */
interface Diner {
  p: [number, number, number]
  c: string
  seated?: boolean
}
const NORMAL_DINERS: Diner[] = [
  { p: [-1.2, 0, -1.32], c: '#7fa8c9', seated: true }, // 餐桌 1 北侧
  { p: [0.4, 0, -0.08], c: '#d99080', seated: true }, // 餐桌 1 南侧
  { p: [-2.6, 0, -1.7], c: '#e3c878' }, // 打饭排队
  { p: [2.9, 0, 2.6], c: '#9db98a' }, // 走动
]
const ALERT_EXTRA_DINERS: Diner[] = [
  { p: [0, 0, -1.7], c: '#b39bc8' }, // 排队
  { p: [2.6, 0, -1.7], c: '#e0a8b0' }, // 排队
  { p: [0, 0, -1.15], c: '#8fb6a0' }, // 第二排队伍
  { p: [1.0, 0, 1.08], c: '#c9a86a', seated: true }, // 餐桌 2 北侧
  { p: [-0.6, 0, 2.32], c: '#7f9dc9', seated: true }, // 餐桌 2 南侧
  { p: [3.3, 0, 0.5], c: '#c98a8a' }, // 墙边站立
]

export default function Canteen3D({
  status = 'NORMAL',
  actionType = null,
  className = '',
  style,
}: InteriorSceneProps) {
  const alert = alertOf(status)
  const diners = alert ? [...NORMAL_DINERS, ...ALERT_EXTRA_DINERS] : NORMAL_DINERS
  const fanActive = actionType === 'FAN'
  return (
    <SceneContainer
      alert={alert}
      camera={[7.0, 7.8, 9.2]}
      target={[0, 0.8, -0.3]}
      className={className}
      style={style}
    >
      <Hall />

      {/* 打饭区 */}
      <ServingCounter />
      {[-2.6, 0, 2.6].map((x) => (
        <ServingKiosk key={x} x={x} />
      ))}

      {/* 两张长条餐桌 */}
      <LongTable z={-0.7} />
      <LongTable z={1.7} />

      {/* 就餐学生：数量随状态变化 */}
      {diners.map((diner, i) => (
        <Person key={i} position={diner.p} color={diner.c} seated={diner.seated} />
      ))}

      {/* FAN：顶部排风扇 + 涡旋气流 */}
      {fanActive && <ExhaustFan />}
      {fanActive && <FanSwirl />}

      {/* WINDOW：东墙双扇玻璃窗向外旋开（室内朝 -x → rotationY=-90°） */}
      <SwingWindow position={[4.73, 0, -1.3]} rotationY={-PI / 2} open={actionType === 'WINDOW'} />
      <SwingWindow position={[4.73, 0, 1.5]} rotationY={-PI / 2} open={actionType === 'WINDOW'} />
    </SceneContainer>
  )
}

export { Canteen3D }
