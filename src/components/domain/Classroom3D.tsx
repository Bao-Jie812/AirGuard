'use client'

import { useMemo, useRef, type CSSProperties } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { ZoneStatus } from '../../data/types'

/**
 * 低多边形 3D 教室微场景：嵌套在区域详情弹窗中作为「内部实景模拟」。
 *
 * 全部几何由代码程序生成（Box / Cylinder / Sphere / Tube），无外部模型与贴图。
 * 交互由两个 props 驱动：
 *   status     —— ALERT / CRITICAL 时环境光平滑转为暖红、学生满座；NORMAL 为冷白明亮
 *   actionType —— 'FAN' 西墙风扇扇叶持续旋转并出现蓝色螺旋气流；
 *                 'WINDOW' 东墙两扇玻璃窗绕竖直铰链平滑旋开约 95°
 *
 * 相机：东南上方俯视约 45°——西墙风扇正对镜头，
 * 东墙窗户向外（+x）翻开时正好朝相机打开，两个动画都清晰可见。
 */

export type ClassroomAction = 'FAN' | 'WINDOW' | null

export interface Classroom3DProps {
  /** 区域状态：ALERT / CRITICAL 视为告警 */
  status?: ZoneStatus
  /** 当前处置动作；null = 无动作 */
  actionType?: ClassroomAction
  className?: string
  /** 覆盖最外层容器样式；嵌入定高容器（如详情弹窗）时传 { minHeight: 0 } */
  style?: CSSProperties
}

const PI = Math.PI
const WALL_COLOR = '#f7f4ec'
const FRAME_COLOR = '#e9e5da'

function WallMaterial() {
  return <meshStandardMaterial color={WALL_COLOR} roughness={0.92} />
}

/* ---------------- 灯光：状态切换时颜色 / 强度逐帧平滑过渡 ---------------- */
function LightRig({ alert }: { alert: boolean }) {
  const amb = useRef<THREE.AmbientLight>(null!)
  const hemi = useRef<THREE.HemisphereLight>(null!)
  const sun = useRef<THREE.DirectionalLight>(null!)
  const scene = useThree((s) => s.scene)
  // [正常色, 告警色]
  const targets = useMemo(
    () => ({
      amb: [new THREE.Color('#dce6f5'), new THREE.Color('#ffd2c4')],
      hemi: [new THREE.Color('#ffffff'), new THREE.Color('#ffe0d4')],
      sun: [new THREE.Color('#fff3e2'), new THREE.Color('#ffb59e')],
      bg: [new THREE.Color('#e9eff3'), new THREE.Color('#f3ded6')],
    }),
    [],
  )
  useFrame((_, delta) => {
    const k = 1 - Math.exp(-3.2 * delta)
    const pick = (pair: THREE.Color[]) => pair[alert ? 1 : 0]
    amb.current.color.lerp(pick(targets.amb), k)
    hemi.current.color.lerp(pick(targets.hemi), k)
    sun.current.color.lerp(pick(targets.sun), k)
    if (scene.background instanceof THREE.Color) {
      scene.background.lerp(pick(targets.bg), k)
    }
    sun.current.intensity = THREE.MathUtils.damp(
      sun.current.intensity,
      alert ? 1.25 : 1.7,
      3.2,
      delta,
    )
  })
  return (
    <>
      <ambientLight ref={amb} intensity={0.6} />
      <hemisphereLight ref={hemi} args={['#ffffff', '#d8cfc0', 0.45]} />
      <directionalLight
        ref={sun}
        position={[4.5, 8, 3]}
        intensity={1.7}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-camera-near={1}
        shadow-camera-far={25}
        shadow-bias={-0.0002}
        shadow-normalBias={0.04}
      />
    </>
  )
}

/* ---------------- 教室框架：地台 + 后墙（带窗洞）+ 两侧墙（东墙带窗洞） ---------------- */
function Room() {
  return (
    <group>
      {/* 地台与地板 */}
      <mesh position={[0, -0.12, 0.1]} receiveShadow>
        <boxGeometry args={[7.9, 0.24, 6.2]} />
        <meshStandardMaterial color="#efece4" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.012, 0.1]} receiveShadow>
        <boxGeometry args={[7.4, 0.024, 5.7]} />
        <meshStandardMaterial color="#e6d9c3" roughness={0.9} />
      </mesh>

      {/* 后墙 z=-2.85：窗洞 x∈[-1.15,1.15]，y∈[0.95,2.15]，由四段拼出 */}
      <mesh position={[-2.475, 1.35, -2.85]} castShadow receiveShadow>
        <boxGeometry args={[2.65, 2.7, 0.16]} />
        <WallMaterial />
      </mesh>
      <mesh position={[2.475, 1.35, -2.85]} castShadow receiveShadow>
        <boxGeometry args={[2.65, 2.7, 0.16]} />
        <WallMaterial />
      </mesh>
      <mesh position={[0, 0.475, -2.85]} castShadow receiveShadow>
        <boxGeometry args={[2.3, 0.95, 0.16]} />
        <WallMaterial />
      </mesh>
      <mesh position={[0, 2.425, -2.85]} castShadow receiveShadow>
        <boxGeometry args={[2.3, 0.55, 0.16]} />
        <WallMaterial />
      </mesh>
      {/* 后墙窗台 */}
      <mesh position={[0, 0.93, -2.76]} castShadow>
        <boxGeometry args={[2.44, 0.07, 0.32]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
      </mesh>

      {/* 西墙（整面，风扇挂这面） */}
      <mesh position={[-3.72, 1.35, 0.1]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 2.7, 5.9]} />
        <WallMaterial />
      </mesh>

      {/* 东墙 x=3.72：窗洞 z∈[-0.95,0.95]，y∈[0.9,2.2]，由四段拼出 */}
      <mesh position={[3.72, 1.35, -1.9]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 2.7, 1.9]} />
        <WallMaterial />
      </mesh>
      <mesh position={[3.72, 1.35, 2.0]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 2.7, 2.1]} />
        <WallMaterial />
      </mesh>
      <mesh position={[3.72, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.9, 1.9]} />
        <WallMaterial />
      </mesh>
      <mesh position={[3.72, 2.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.5, 1.9]} />
        <WallMaterial />
      </mesh>
      {/* 东墙窗洞外框（固定不动） */}
      <mesh position={[3.72, 2.22, 0]} castShadow>
        <boxGeometry args={[0.24, 0.08, 2.04]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
      </mesh>
      <mesh position={[3.72, 0.88, 0]} castShadow>
        <boxGeometry args={[0.24, 0.08, 2.04]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
      </mesh>
      {[-0.97, 0.97].map((z) => (
        <mesh key={z} position={[3.72, 1.55, z]} castShadow>
          <boxGeometry args={[0.24, 1.42, 0.08]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- 课桌 / 椅子 / 学生 ---------------- */
function Desk({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.0, 0.07, 0.6]} />
        <meshStandardMaterial color="#b08968" roughness={0.8} />
      </mesh>
      {[-0.44, 0.44].map((x) => (
        <mesh key={x} position={[x, 0.36, 0]} castShadow>
          <boxGeometry args={[0.06, 0.72, 0.5]} />
          <meshStandardMaterial color="#8c6a4f" roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

function Chair({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.44, 0.06, 0.44]} />
        <meshStandardMaterial color="#a8adb3" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.67, -0.2]} castShadow>
        <boxGeometry args={[0.44, 0.44, 0.05]} />
        <meshStandardMaterial color="#a8adb3" roughness={0.85} />
      </mesh>
      {[-0.18, 0.18].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} castShadow>
          <boxGeometry args={[0.05, 0.44, 0.38]} />
          <meshStandardMaterial color="#969ca2" roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

function Student({
  position,
  color,
}: {
  position: [number, number, number]
  color: string
}) {
  return (
    <group position={position}>
      {/* 身体：低分段圆柱 + flatShading 呈现低多边形面片感 */}
      <mesh position={[0, 0.7, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.16, 0.5, 8]} />
        <meshStandardMaterial color={color} roughness={0.85} flatShading />
      </mesh>
      {/* 头 */}
      <mesh position={[0, 1.04, 0]} castShadow>
        <sphereGeometry args={[0.14, 10, 8]} />
        <meshStandardMaterial color="#f2d3b8" roughness={0.7} flatShading />
      </mesh>
    </group>
  )
}

/* ---------------- 西墙风扇：薄板外框 + 三叶扇叶 ---------------- */
function FanBlades({ spinning }: { spinning: boolean }) {
  const ref = useRef<THREE.Group>(null!)
  // 转速缓启缓停，避免突兀跳变
  const speed = useRef(0)
  useFrame((_, delta) => {
    speed.current = THREE.MathUtils.damp(
      speed.current,
      spinning ? 13 : 0,
      2.5,
      delta,
    )
    ref.current.rotation.x += speed.current * delta
  })
  return (
    <group ref={ref} position={[0.09, 0, 0]}>
      {[0, 1, 2].map((i) => (
        <group key={i} rotation={[(i * 2 * PI) / 3, 0, 0]}>
          {/* 叶片绕厚度轴扭转 0.55 rad 形成攻角 */}
          <mesh position={[0, 0.22, 0]} rotation={[0.55, 0, 0]} castShadow>
            <boxGeometry args={[0.02, 0.36, 0.13]} />
            <meshStandardMaterial color="#7c878d" roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function WallFan({ spinning }: { spinning: boolean }) {
  return (
    <group position={[-3.58, 1.8, -0.5]}>
      {/* 外框：四条灰色薄长方体 */}
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.07, 0.06, 0.9]} />
        <meshStandardMaterial color="#8e979c" roughness={0.7} />
      </mesh>
      <mesh position={[0, -0.42, 0]} castShadow>
        <boxGeometry args={[0.07, 0.06, 0.9]} />
        <meshStandardMaterial color="#8e979c" roughness={0.7} />
      </mesh>
      {[0.42, -0.42].map((z) => (
        <mesh key={z} position={[0, 0, z]} castShadow>
          <boxGeometry args={[0.07, 0.9, 0.06]} />
          <meshStandardMaterial color="#8e979c" roughness={0.7} />
        </mesh>
      ))}
      {/* 中心毂（轴向 +x，朝室内吹） */}
      <mesh position={[0.06, 0, 0]} rotation={[0, 0, PI / 2]} castShadow>
        <cylinderGeometry args={[0.075, 0.075, 0.12, 12]} />
        <meshStandardMaterial color="#6f7a80" roughness={0.55} />
      </mesh>
      <FanBlades spinning={spinning} />
    </group>
  )
}

/* ---------------- 蓝色螺旋气流：FAN 时从风扇口生长并旋转 ---------------- */
function helixCurve(phase: number): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = []
  const LENGTH = 3.1
  const TURNS = 2.1
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const angle = phase + t * TURNS * 2 * PI
    const radius = 0.16 + t * 0.34
    points.push(
      new THREE.Vector3(
        t * LENGTH,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
      ),
    )
  }
  return new THREE.CatmullRomCurve3(points)
}

function AirFlow() {
  const ref = useRef<THREE.Group>(null!)
  const curves = useMemo(
    () => [0, 1, 2].map((i) => helixCurve((i * 2 * PI) / 3)),
    [],
  )
  useFrame((_, delta) => {
    ref.current.rotation.x += delta * 2.6
    // 沿风向（x 轴）从风扇口生长出来
    const s = THREE.MathUtils.damp(ref.current.scale.x, 1, 3, delta)
    ref.current.scale.set(Math.max(s, 0.01), 1, 1)
  })
  return (
    <group ref={ref} position={[-3.44, 1.8, -0.5]} scale={[0.01, 1, 1]}>
      {curves.map((curve, i) => (
        <mesh key={i}>
          <tubeGeometry args={[curve, 72, 0.017, 6, false]} />
          <meshStandardMaterial
            color="#4a90d9"
            transparent
            opacity={0.55}
            roughness={0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- 东墙玻璃窗：双扇绕各自外侧铰链平滑旋开 ---------------- */
function WindowPane({
  hingeZ,
  dir,
  open,
}: {
  hingeZ: number
  /** 玻璃板从铰链向 ±z 方向延伸 */
  dir: 1 | -1
  open: boolean
}) {
  const ref = useRef<THREE.Group>(null!)
  useFrame((_, delta) => {
    // 向室外（+x）翻开约 95°，damp 平滑过渡
    ref.current.rotation.y = THREE.MathUtils.damp(
      ref.current.rotation.y,
      open ? dir * 1.65 : 0,
      4.5,
      delta,
    )
  })
  return (
    <group ref={ref} position={[3.66, 0.92, hingeZ]}>
      {/* 半透明玻璃 */}
      <mesh position={[0, 0.64, dir * 0.46]} castShadow>
        <boxGeometry args={[0.03, 1.24, 0.86]} />
        <meshPhysicalMaterial
          color="#bcd9e6"
          transparent
          opacity={0.45}
          roughness={0.12}
          metalness={0.1}
        />
      </mesh>
      {/* 窗框四条 */}
      <mesh position={[0, 1.28, dir * 0.46]} castShadow>
        <boxGeometry args={[0.06, 0.06, 0.94]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.01, dir * 0.46]} castShadow>
        <boxGeometry args={[0.06, 0.06, 0.94]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.64, dir * 0.91]} castShadow>
        <boxGeometry args={[0.06, 1.32, 0.06]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.64, dir * 0.02]}>
        <boxGeometry args={[0.06, 1.32, 0.06]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
      </mesh>
    </group>
  )
}

/* ---------------- 座位布局：2 列 × 3 排，正常坐 4 人、告警满座 6 人 ---------------- */
const SEATS = [
  { x: -1.6, z: -1.4 },
  { x: 0.6, z: -1.4 },
  { x: -1.6, z: 0.0 },
  { x: 0.6, z: 0.0 },
  { x: -1.6, z: 1.4 },
  { x: 0.6, z: 1.4 },
]
const NORMAL_SEATS = [0, 2, 3, 5]
const STUDENT_COLORS = [
  '#7fa8c9',
  '#d99080',
  '#e3c878',
  '#9db98a',
  '#b39bc8',
  '#e0a8b0',
]

export default function Classroom3D({
  status = 'NORMAL',
  actionType = null,
  className = '',
  style,
}: Classroom3DProps) {
  const alert = status === 'ALERT' || status === 'CRITICAL'
  const seatIndexes = alert ? SEATS.map((_, i) => i) : NORMAL_SEATS
  return (
    <div
      className={`classroom-3d ${className}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 200,
        overflow: 'hidden',
        borderRadius: 12,
        background: '#e9eff3',
        ...style,
      }}
    >
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: [4.6, 7.2, 6.2], fov: 30, near: 0.1, far: 60 }}
      >
        <color attach="background" args={['#e9eff3']} />
        <LightRig alert={alert} />
        <Room />

        {/* 课桌与椅子（始终满布），学生数量随状态变化 */}
        {SEATS.map((seat) => (
          <group key={`${seat.x}:${seat.z}`}>
            <Desk position={[seat.x, 0, seat.z]} />
            <Chair position={[seat.x, 0, seat.z - 0.62]} />
          </group>
        ))}
        {seatIndexes.map((seatIndex) => (
          <Student
            key={seatIndex}
            position={[SEATS[seatIndex].x, 0, SEATS[seatIndex].z - 0.62]}
            color={STUDENT_COLORS[seatIndex]}
          />
        ))}

        {/* 西墙风扇：FAN 时扇叶持续旋转 + 蓝色气流 */}
        <WallFan spinning={actionType === 'FAN'} />
        {actionType === 'FAN' && <AirFlow />}

        {/* 东墙双扇玻璃窗：WINDOW 时向外旋开 */}
        <WindowPane hingeZ={-0.94} dir={1} open={actionType === 'WINDOW'} />
        <WindowPane hingeZ={0.94} dir={-1} open={actionType === 'WINDOW'} />

        {/* 只允许小范围旋转查看，禁止缩放平移，避免与弹窗交互冲突 */}
        <OrbitControls
          target={[0, 0.7, 0]}
          enableZoom={false}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minPolarAngle={0.55}
          maxPolarAngle={1.05}
          minAzimuthAngle={0.35}
          maxAzimuthAngle={0.95}
        />
      </Canvas>
    </div>
  )
}

export { Classroom3D }
