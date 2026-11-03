'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import {
  AirFlow,
  FloorMaterial,
  Person,
  SceneContainer,
  SwingWindow,
  WallFan,
  WallMaterial,
  alertOf,
  type InteriorSceneProps,
} from './interiorShared'

const WINDOW = { x: -0.5, width: 1.25, height: 1.3, sill: 1 }
const FRAME_COLOR = '#c5ced0'
type Point = [number, number, number]

/* 用圆管构成床架、护栏和梯子，保留能看见床铺的空隙。 */
function Rail({ start, end, radius = 0.027 }: { start: Point; end: Point; radius?: number }) {
  const transform = useMemo(() => {
    const a = new THREE.Vector3(...start)
    const b = new THREE.Vector3(...end)
    const direction = b.clone().sub(a)
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize(),
      ),
    }
  }, [start[0], start[1], start[2], end[0], end[1], end[2]])

  return (
    <mesh position={transform.position} quaternion={transform.quaternion} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, transform.length, 12]} />
      <meshStandardMaterial color={FRAME_COLOR} metalness={0.82} roughness={0.32} />
    </mesh>
  )
}

function Room() {
  const left = WINDOW.x - WINDOW.width / 2
  const right = WINDOW.x + WINDOW.width / 2
  const top = WINDOW.sill + WINDOW.height
  const wallParts = [
    { x: (-3.15 + left) / 2, y: 1.4, width: left + 3.15, height: 2.8 },
    { x: (right + 3.15) / 2, y: 1.4, width: 3.15 - right, height: 2.8 },
    { x: WINDOW.x, y: WINDOW.sill / 2, width: WINDOW.width, height: WINDOW.sill },
    { x: WINDOW.x, y: (top + 2.8) / 2, width: WINDOW.width, height: 2.8 - top },
  ]

  return (
    <group>
      <RoundedBox args={[6.8, 0.26, 5.7]} radius={0.06} smoothness={3} position={[0, -0.13, 0.05]} receiveShadow>
        <FloorMaterial color="#e2e7e5" />
      </RoundedBox>
      {/* 几何拼板地面，不依赖外部纹理。 */}
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[-2.925 + i * 0.45, 0.013, 0.05]} receiveShadow>
          <boxGeometry args={[0.443, 0.026, 5.2]} />
          <FloorMaterial color={['#e8ecea', '#edf0ee', '#e7ebe9', '#eaf0ed'][i % 4]} />
        </mesh>
      ))}
      {/* 后墙分成四块：窗户后方保留真实空洞。 */}
      {wallParts.map((part, i) => (
        <mesh key={i} position={[part.x, part.y, -2.55]} castShadow receiveShadow>
          <boxGeometry args={[part.width, part.height, 0.16]} />
          <WallMaterial />
        </mesh>
      ))}
      <mesh position={[-3.15, 1.4, 0.05]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 2.8, 5.2]} />
        <WallMaterial />
      </mesh>
      {/* 镜头侧采用剖切矮墙，不遮挡人物、床铺和书桌。 */}
      <mesh position={[3.15, 0.14, 0.05]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.28, 5.2]} />
        <WallMaterial />
      </mesh>
      <mesh position={[0, 0.075, -2.445]} receiveShadow>
        <boxGeometry args={[6.15, 0.15, 0.045]} />
        <meshStandardMaterial color="#dce3df" roughness={0.65} />
      </mesh>
      <mesh position={[-3.045, 0.075, 0.05]} receiveShadow>
        <boxGeometry args={[0.045, 0.15, 5.1]} />
        <meshStandardMaterial color="#dce3df" roughness={0.65} />
      </mesh>
    </group>
  )
}

function Bedding({ y, color, foldColor }: { y: number; color: string; foldColor: string }) {
  return (
    <group position={[-2.22, y, -0.84]}>
      <RoundedBox args={[0.99, 0.17, 2.02]} radius={0.065} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.96} />
      </RoundedBox>
      <RoundedBox args={[1.015, 0.075, 1.34]} radius={0.035} smoothness={3} position={[0, 0.102, 0.31]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.98} />
      </RoundedBox>
      <RoundedBox args={[1.025, 0.045, 0.2]} radius={0.021} smoothness={3} position={[0, 0.15, -0.24]} castShadow>
        <meshStandardMaterial color={foldColor} roughness={0.98} />
      </RoundedBox>
      <RoundedBox args={[0.66, 0.135, 0.4]} radius={0.065} smoothness={5} position={[0, 0.145, -0.71]} rotation={[0, -0.05, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={1} />
      </RoundedBox>
      {/* 床尾窄条与缝线用几何表达，避免大面积平板感。 */}
      {[-0.38, 0.38].map((x) => (
        <mesh key={x} position={[x, 0.142, 0.36]} receiveShadow>
          <boxGeometry args={[0.015, 0.003, 1.14]} />
          <meshStandardMaterial color={foldColor} roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

function BunkBed() {
  const xs = [-2.77, -1.67]
  const zs = [-1.94, 0.26]
  return (
    <group>
      {xs.flatMap((x) => zs.map((z) => (
        <group key={`${x}:${z}`}>
          <Rail start={[x, 0.08, z]} end={[x, 2.18, z]} radius={0.04} />
          <mesh position={[x, 2.18, z]} castShadow>
            <sphereGeometry args={[0.042, 12, 8]} />
            <meshStandardMaterial color={FRAME_COLOR} metalness={0.82} roughness={0.32} />
          </mesh>
          <mesh position={[x, 0.07, z]} castShadow>
            <cylinderGeometry args={[0.053, 0.058, 0.085, 12]} />
            <meshStandardMaterial color="#949d9e" roughness={0.9} />
          </mesh>
        </group>
      )))}
      {[0.43, 1.51].map((y) => (
        <group key={y}>
          {xs.map((x) => <Rail key={x} start={[x, y, zs[0]]} end={[x, y, zs[1]]} radius={0.035} />)}
          {zs.map((z) => <Rail key={z} start={[xs[0], y, z]} end={[xs[1], y, z]} radius={0.035} />)}
          <mesh position={[-2.22, y + 0.018, -0.84]} castShadow receiveShadow>
            <boxGeometry args={[1.02, 0.045, 2.1]} />
            <meshStandardMaterial color="#c2cccf" metalness={0.78} roughness={0.38} />
          </mesh>
        </group>
      ))}
      <Bedding y={0.56} color="#a8ccdf" foldColor="#cde3ee" />
      <Bedding y={1.64} color="#b3d5e6" foldColor="#d6e8f0" />
      {/* 上铺通透双道护栏；近床尾留出爬梯入口。 */}
      {[1.94, 2.13].map((y) => (
        <group key={y}>
          <Rail start={[-2.77, y, -1.94]} end={[-2.77, y, 0.26]} />
          <Rail start={[-1.67, y, -1.94]} end={[-1.67, y, -0.23]} />
          <Rail start={[-2.77, y, -1.94]} end={[-1.67, y, -1.94]} />
          <Rail start={[-2.77, y, 0.26]} end={[-2.6, y, 0.26]} />
        </group>
      ))}
      {[-1.41, -0.8, -0.23].map((z) => (
        <Rail key={z} start={[-1.67, 1.54, z]} end={[-1.67, 2.13, z]} radius={0.02} />
      ))}
      {[-2.58, -1.95].map((x) => (
        <Rail key={x} start={[x, 0.08, 0.65]} end={[x, 1.88, 0.3]} radius={0.033} />
      ))}
      {[0.32, 0.62, 0.92, 1.22, 1.52].map((y) => {
        const z = 0.65 - ((y - 0.08) / 1.8) * 0.35
        return <Rail key={y} start={[-2.58, y, z]} end={[-1.95, y, z]} radius={0.028} />
      })}
    </group>
  )
}

function Book({ position, color, rotation = 0 }: { position: Point; color: string; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[-0.027, 0.027].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          <boxGeometry args={[0.35, 0.012, 0.27]} />
          <meshStandardMaterial color={color} roughness={0.72} />
        </mesh>
      ))}
      <mesh castShadow>
        <boxGeometry args={[0.325, 0.043, 0.248]} />
        <meshStandardMaterial color="#f4f4ee" roughness={0.95} />
      </mesh>
      <mesh position={[-0.169, 0, 0]} castShadow>
        <boxGeometry args={[0.012, 0.06, 0.27]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
    </group>
  )
}

function StudyDesk() {
  return (
    <group>
      <RoundedBox args={[2.42, 0.095, 0.8]} radius={0.035} smoothness={3} position={[1.25, 0.8, -1.98]} castShadow receiveShadow>
        <meshStandardMaterial color="#e5ddca" roughness={0.8} metalness={0} />
      </RoundedBox>
      {[-2.22, -1.91, -1.72].map((z) => (
        <mesh key={z} position={[1.25, 0.848, z]} receiveShadow>
          <boxGeometry args={[2.32, 0.002, 0.009]} />
          <meshStandardMaterial color="#d2c8b6" metalness={0} roughness={0.82} />
        </mesh>
      ))}
      {[0.15, 2.35].flatMap((x) => [-2.27, -1.7].map((z) => (
        <Rail key={`${x}:${z}`} start={[x, 0.04, z]} end={[x, 0.76, z]} radius={0.03} />
      )))}
      <Rail start={[0.15, 0.64, -2.27]} end={[2.35, 0.64, -2.27]} radius={0.026} />
      <Book position={[0.5, 0.882, -2.12]} color="#a2bbb0" rotation={-0.08} />
      <Book position={[0.51, 0.945, -2.12]} color="#cbbc9d" rotation={0.05} />
      <Book position={[1.55, 0.882, -1.94]} color="#b7b5c8" rotation={0.2} />
      {/* 轻巧的台灯与现有叠放书籍组成桌面细节。 */}
      <group name="dorm-desk-lamp" position={[1.04, 0.862, -2.2]}>
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[0.13, 0.14, 0.026, 24]} />
          <meshStandardMaterial color="#bfd6cb" roughness={0.48} />
        </mesh>
        <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.015, 0.015, 0.3, 12]} />
          <meshStandardMaterial color={FRAME_COLOR} metalness={0.82} roughness={0.32} />
        </mesh>
        <mesh position={[0, 0.34, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.055, 0.16, 0.12, 24]} />
          <meshStandardMaterial color="#d8e6df" roughness={0.5} />
        </mesh>
      </group>
      {/* 笔筒与几支铅笔提供桌面尺度。 */}
      <mesh position={[2.18, 0.93, -2.19]} castShadow>
        <cylinderGeometry args={[0.065, 0.06, 0.16, 16]} />
        <meshStandardMaterial color="#bfd6cb" roughness={0.35} metalness={0.8} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[2.15 + i * 0.027, 1.045, -2.19]} rotation={[0, 0, (i - 1) * 0.12]} castShadow>
          <cylinderGeometry args={[0.009, 0.009, 0.22, 6]} />
          <meshStandardMaterial color={['#cbbc9d', '#c7b2a8', '#9fb9c1'][i]} metalness={0} roughness={0.8} />
        </mesh>
      ))}
      {[0.65, 1.65].map((x) => (
        <group key={x} position={[x, 0, -1.28]}>
          <mesh position={[0, 0.44, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.21, 0.2, 0.075, 24]} />
            <meshStandardMaterial color="#c7dacf" metalness={0} roughness={0.8} />
          </mesh>
          {[-1, 1].flatMap((dx) => [-1, 1].map((dz) => (
            <Rail key={`${dx}:${dz}`} start={[dx * 0.15, 0.035, dz * 0.15]} end={[dx * 0.12, 0.405, dz * 0.12]} radius={0.018} />
          )))}
        </group>
      ))}
    </group>
  )
}

function AirConditioner({ active }: { active: boolean }) {
  const louver = useRef<THREE.Group>(null!)
  const indicator = useRef<THREE.MeshStandardMaterial>(null!)
  const progress = useRef(0)

  useFrame(({ clock }, delta) => {
    progress.current = THREE.MathUtils.damp(progress.current, active ? 1 : 0, 4, delta)
    louver.current.rotation.x = THREE.MathUtils.damp(
      louver.current.rotation.x,
      active ? 0.5 + Math.sin(clock.elapsedTime * 1.7) * 0.14 : 0.04,
      5,
      delta,
    )
    indicator.current.emissiveIntensity = 0.2 + progress.current * 1.4
  })

  return (
    <group position={[1.35, 2.35, -2.31]}>
      <RoundedBox args={[1.5, 0.37, 0.31]} radius={0.075} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.28} metalness={0.08} />
      </RoundedBox>
      <RoundedBox args={[1.36, 0.22, 0.026]} radius={0.012} smoothness={3} position={[0, 0.035, 0.152]} castShadow>
        <meshStandardMaterial color="#ffffff" roughness={0.25} />
      </RoundedBox>
      <mesh position={[0, -0.116, 0.14]}>
        <boxGeometry args={[1.24, 0.075, 0.045]} />
        <meshStandardMaterial color="#454a4d" roughness={0.7} />
      </mesh>
      <group name="dorm-ac-vent-grille">
        {Array.from({ length: 9 }, (_, i) => (
          <mesh key={i} position={[-0.52 + i * 0.13, -0.116, 0.165]} castShadow>
            <boxGeometry args={[0.012, 0.065, 0.01]} />
            <meshStandardMaterial color="#727a7d" roughness={0.58} />
          </mesh>
        ))}
      </group>
      <group ref={louver} position={[0, -0.112, 0.166]}>
        <mesh position={[0, -0.023, 0.025]} castShadow>
          <boxGeometry args={[1.26, 0.025, 0.1]} />
          <meshStandardMaterial color="#61686c" roughness={0.36} metalness={0.15} />
        </mesh>
      </group>
      <mesh position={[0.57, 0.012, 0.169]}>
        <sphereGeometry args={[0.017, 12, 8]} />
        <meshStandardMaterial ref={indicator} color="#73cfd0" emissive="#47b8cd" emissiveIntensity={0.2} />
      </mesh>
    </group>
  )
}

/** 纯几何宿舍：FAN 启动空调与壁扇，WINDOW 开窗，异常状态由共享灯光平滑呈现。 */
export default function Dorm3D({
  status = 'NORMAL',
  actionType = null,
  className = '',
  style,
}: InteriorSceneProps) {
  const fanActive = actionType === 'FAN'
  return (
    <SceneContainer
      denseLandscape
      alert={alertOf(status)}
      status={status}
      actionType={actionType}
      camera={[7.6, 7.4, 10.8]}
      target={[0, 0, 0]}
      fov={32}
      roomSize={[6.3, 5.2]}
      roomCenter={[0, 0.05]}
      roomHeight={2.8}
      className={className}
      style={style}
    >
      <Room />
      <BunkBed />
      <StudyDesk />
      <Person position={[0.65, 0, -1.28]} color="#aac5cb" seated />
      <Person position={[1.65, 0, -1.28]} color="#c8c1a9" seated />
      <AirConditioner active={fanActive} />
      {/* 常驻气流组件，让停止通风也有平滑淡出。 */}
      <AirFlow active={fanActive} position={[1.35, 2.2, -2.13]} rotation={[Math.PI / 3.5, 0, 0]} length={1.95} radius={0.3} />
      <WallFan position={[2.65, 1.62, -2.39]} scale={0.62} spinning={fanActive} />
      <SwingWindow
        position={[WINDOW.x, 0, -2.46]}
        width={WINDOW.width}
        height={WINDOW.height}
        sill={WINDOW.sill}
        open={actionType === 'WINDOW'}
      />
    </SceneContainer>
  )
}

export { Dorm3D }
