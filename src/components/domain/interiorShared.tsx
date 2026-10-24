'use client'

import { useMemo, useRef, type CSSProperties, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { ZoneStatus } from '../../data/types'

/**
 * 室内微场景共享件：Canteen3D / Dorm3D 的灯光、容器与学生/窗户原语。
 * Classroom3D 是早期独立实现，保持原样不重构；新场景统一从这里取件，
 * 保证三个场景的红温告警过渡、相机交互限制与容器样式完全一致。
 */

/** 三个室内场景共用的动作指令：FAN = 排风 / 空调，WINDOW = 开窗通风 */
export type InteriorAction = 'FAN' | 'WINDOW' | null

export interface InteriorSceneProps {
  /** 区域状态：ALERT / CRITICAL 视为告警 */
  status?: ZoneStatus
  /** 当前处置动作；null = 无动作 */
  actionType?: InteriorAction
  className?: string
  /** 覆盖最外层容器样式；嵌入定高容器（如详情弹窗）时传 { minHeight: 0 } */
  style?: CSSProperties
}

export const alertOf = (status: ZoneStatus | undefined) =>
  status === 'ALERT' || status === 'CRITICAL'

export const WALL_COLOR = '#f7f4ec'
export const FRAME_COLOR = '#e9e5da'
export const SKIN_COLOR = '#f2d3b8'
/** 气流统一蓝色，与 Classroom3D 的螺旋气流一致 */
export const AIRFLOW_COLOR = '#4a90d9'

export function WallMaterial() {
  return <meshStandardMaterial color={WALL_COLOR} roughness={0.92} />
}

/* ---------------- 灯光：状态切换时颜色 / 强度逐帧平滑过渡（与 Classroom3D 同参） ---------------- */
export function LightRig({ alert }: { alert: boolean }) {
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

/* ---------------- 场景容器：统一样式的 div + Canvas + 限制性 OrbitControls ---------------- */
interface SceneContainerProps {
  alert: boolean
  /** 透视相机初始位置（东南上方俯视） */
  camera: [number, number, number]
  /** 观察目标点 */
  target?: [number, number, number]
  fov?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}

export function SceneContainer({
  alert,
  camera,
  target = [0, 0.8, 0],
  fov = 30,
  className = '',
  style,
  children,
}: SceneContainerProps) {
  return (
    <div
      className={`interior-3d ${className}`}
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
      <Canvas shadows dpr={[1, 1.75]} camera={{ position: camera, fov, near: 0.1, far: 80 }}>
        <color attach="background" args={['#e9eff3']} />
        <LightRig alert={alert} />
        {children}
        {/* 只允许小范围旋转查看，禁止缩放平移，避免与弹窗交互冲突 */}
        <OrbitControls
          target={target}
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

/* ---------------- 胶囊学生：低多边形胶囊身体 + 球头，食堂/宿舍共用 ---------------- */
export function Person({
  position,
  color,
  seated = false,
}: {
  position: [number, number, number]
  color: string
  /** 坐姿：整体抬高到凳面高度 */
  seated?: boolean
}) {
  const y = seated ? 0.24 : 0
  return (
    <group position={position}>
      {/* 身体：胶囊体呈现圆润低多边形感 */}
      <mesh position={[0, y + 0.39, 0]} castShadow>
        <capsuleGeometry args={[0.14, 0.5, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.85} flatShading />
      </mesh>
      {/* 头 */}
      <mesh position={[0, y + 0.92, 0]} castShadow>
        <sphereGeometry args={[0.13, 10, 8]} />
        <meshStandardMaterial color={SKIN_COLOR} roughness={0.7} flatShading />
      </mesh>
    </group>
  )
}

/* ---------------- 平开窗：深色窗洞 + 固定外框 + 绕左铰链向外(-z)平滑旋开的玻璃扇 ----------------
 * 局部坐标系：墙面 = XY 平面，室内朝 +z；用 rotationY 适配不同朝向的墙：
 *   后墙（室内 +z）→ 0；东墙（室内 -x）→ -PI/2；西墙（室内 +x）→ PI/2。 */
export function SwingWindow({
  position,
  rotationY = 0,
  width = 1.15,
  height = 1.3,
  sill = 1.0,
  open,
}: {
  position: [number, number, number]
  rotationY?: number
  width?: number
  height?: number
  /** 窗台（窗洞下沿）高度 */
  sill?: number
  open: boolean
}) {
  const hinge = useRef<THREE.Group>(null!)
  useFrame((_, delta) => {
    // 向室外（-z）翻开约 92°，damp 平滑过渡
    hinge.current.rotation.y = THREE.MathUtils.damp(
      hinge.current.rotation.y,
      open ? 1.6 : 0,
      4.5,
      delta,
    )
  })
  const w = width
  const h = height
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 窗洞：深色凹槽伪造开洞，避免切墙分段 */}
      <mesh position={[0, sill + h / 2, -0.04]}>
        <boxGeometry args={[w, h, 0.06]} />
        <meshStandardMaterial color="#43525a" roughness={0.9} />
      </mesh>
      {/* 固定外框四条 */}
      <mesh position={[0, sill + h + 0.03, 0.01]} castShadow>
        <boxGeometry args={[w + 0.12, 0.07, 0.1]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
      </mesh>
      <mesh position={[0, sill - 0.03, 0.01]} castShadow>
        <boxGeometry args={[w + 0.12, 0.07, 0.1]} />
        <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
      </mesh>
      {[-w / 2 - 0.03, w / 2 + 0.03].map((x) => (
        <mesh key={x} position={[x, sill + h / 2, 0.01]} castShadow>
          <boxGeometry args={[0.07, h + 0.12, 0.1]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
        </mesh>
      ))}
      {/* 玻璃扇：铰链在左边缘（x=-w/2），向外旋开 */}
      <group ref={hinge} position={[-w / 2, sill, 0.03]}>
        <mesh position={[w / 2, h / 2, 0]} castShadow>
          <boxGeometry args={[w - 0.1, h - 0.1, 0.03]} />
          <meshPhysicalMaterial
            color="#bcd9e6"
            transparent
            opacity={0.45}
            roughness={0.12}
            metalness={0.1}
          />
        </mesh>
        {/* 扇框四条 */}
        <mesh position={[w / 2, h - 0.03, 0]} castShadow>
          <boxGeometry args={[w, 0.06, 0.06]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
        </mesh>
        <mesh position={[w / 2, 0.03, 0]} castShadow>
          <boxGeometry args={[w, 0.06, 0.06]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
        </mesh>
        <mesh position={[w - 0.03, h / 2, 0]} castShadow>
          <boxGeometry args={[0.06, h, 0.06]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
        </mesh>
        <mesh position={[0.03, h / 2, 0]}>
          <boxGeometry args={[0.06, h, 0.06]} />
          <meshStandardMaterial color={FRAME_COLOR} roughness={0.8} />
        </mesh>
      </group>
    </group>
  )
}
