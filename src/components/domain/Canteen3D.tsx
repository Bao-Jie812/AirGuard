'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import {
  FloorMaterial,
  FRAME_COLOR,
  Person,
  SceneContainer,
  SwingWindow,
  WallFan,
  WallMaterial,
  alertOf,
  type InteriorSceneProps,
} from './interiorShared'

const PI = Math.PI
const WINDOW_WIDTH = 1.45
const WINDOW_HEIGHT = 1.35
const WINDOW_SILL = 1.05
const WINDOW_Z = [-1.3, 1.5]
const STEEL = '#c6d0d1'

/** 东墙由窗台、过梁和墙垛组成，窗洞内没有遮挡玻璃或光束的实心墙。 */
function Hall() {
  const eastPiers = [
    [-3.6, WINDOW_Z[0] - WINDOW_WIDTH / 2],
    [WINDOW_Z[0] + WINDOW_WIDTH / 2, WINDOW_Z[1] - WINDOW_WIDTH / 2],
    [WINDOW_Z[1] + WINDOW_WIDTH / 2, 2.5],
  ]
  return (
    <group>
      <mesh position={[0, -0.14, 0.1]} receiveShadow>
        <boxGeometry args={[10.4, 0.28, 8]} />
        <meshStandardMaterial color="#e0e5e3" metalness={0.25} roughness={0.46} />
      </mesh>
      <mesh position={[0, 0.012, 0.1]} receiveShadow>
        <boxGeometry args={[9.8, 0.024, 7.4]} />
        <FloorMaterial color="#f2f4f3" />
      </mesh>
      {[-3.6, -2.4, -1.2, 0, 1.2, 2.4, 3.6].map((x) => (
        <mesh key={`floor-x-${x}`} position={[x, 0.025, 0.1]} receiveShadow>
          <boxGeometry args={[0.012, 0.002, 7.4]} />
          <meshStandardMaterial color="#dce3df" roughness={0.8} />
        </mesh>
      ))}
      {[-2.9, -1.7, -0.5, 0.7, 1.9, 3.1].map((z) => (
        <mesh key={`floor-z-${z}`} position={[0, 0.025, z]} receiveShadow>
          <boxGeometry args={[9.8, 0.002, 0.012]} />
          <meshStandardMaterial color="#dce3df" roughness={0.8} />
        </mesh>
      ))}

      <mesh position={[0, 1.6, -3.68]} castShadow receiveShadow>
        <boxGeometry args={[9.8, 3.2, 0.16]} />
        <WallMaterial />
      </mesh>
      <mesh position={[-4.82, 1.6, -0.9]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 3.2, 5.4]} />
        <WallMaterial />
      </mesh>
      <mesh position={[-4.82, 0.525, 2.8]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 1.05, 2]} />
        <WallMaterial />
      </mesh>
      <mesh position={[4.82, WINDOW_SILL / 2, 0.1]} castShadow receiveShadow>
        <boxGeometry args={[0.16, WINDOW_SILL, 7.4]} />
        <WallMaterial />
      </mesh>
      <mesh position={[4.82, (WINDOW_SILL + WINDOW_HEIGHT + 3.2) / 2, -0.55]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 3.2 - WINDOW_SILL - WINDOW_HEIGHT, 6.1]} />
        <WallMaterial />
      </mesh>
      {eastPiers.map(([start, end], index) => (
        <mesh key={index} position={[4.82, WINDOW_SILL + WINDOW_HEIGHT / 2, (start + end) / 2]} castShadow receiveShadow>
          <boxGeometry args={[0.16, WINDOW_HEIGHT, end - start]} />
          <WallMaterial />
        </mesh>
      ))}
      <mesh position={[0, 0.17, -3.57]} receiveShadow>
        <boxGeometry args={[9.65, 0.28, 0.06]} />
        <meshStandardMaterial color="#d5ddda" roughness={0.72} />
      </mesh>
      {[-4.71, 4.71].map((x) => (
        <mesh key={x} position={[x, 0.17, 0.1]} receiveShadow>
          <boxGeometry args={[0.06, 0.28, 7.4]} />
          <meshStandardMaterial color="#d5ddda" roughness={0.72} />
        </mesh>
      ))}
      <mesh position={[0, 3.18, 0]} castShadow>
        <boxGeometry args={[9.8, 0.16, 0.2]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.8} roughness={0.34} />
      </mesh>
    </group>
  )
}

/** 开放式出餐窗：侧柱、后厨内壁和顶棚围出窗口；台面放置浅钢盆。 */
function ServingKiosk({ x, color }: { x: number; color: string }) {
  return (
    <group position={[x, 0, -2.96]}>
      <mesh position={[0, 1.75, -0.52]} receiveShadow>
        <boxGeometry args={[2.42, 1.45, 0.045]} />
        <WallMaterial />
      </mesh>
      <mesh position={[0, 1.5, -0.47]} receiveShadow>
        <boxGeometry args={[2.32, 0.02, 0.1]} />
        <meshStandardMaterial color="#d2dcda" roughness={0.5} />
      </mesh>
      {[-1.19, 1.19].map((side) => (
        <mesh key={side} position={[side, 1.76, -0.13]} castShadow receiveShadow>
          <boxGeometry args={[0.11, 1.45, 0.85]} />
          <meshStandardMaterial color="#eef2ef" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 2.55, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[2.58, 0.16, 1.1]} />
        <meshStandardMaterial color="#cbd5d3" roughness={0.32} metalness={0.65} />
      </mesh>
      <mesh position={[0, 2.39, 0.51]} castShadow>
        <boxGeometry args={[2.57, 0.28, 0.08]} />
        <meshStandardMaterial color={color} roughness={0.45} />
      </mesh>
      <mesh position={[0, 2.47, 0.28]}>
        <boxGeometry args={[2.1, 0.025, 0.12]} />
        <meshStandardMaterial color="#fff4d9" emissive="#ffe3a0" emissiveIntensity={0.55} roughness={0.5} />
      </mesh>
      <pointLight position={[0, 2.3, 0.12]} color="#fff0cb" intensity={0.85} distance={3} decay={2} />
      <mesh position={[0, 1.52, 0.51]} rotation={[-PI / 12, 0, 0]}>
        <boxGeometry args={[2.28, 0.42, 0.025]} />
        <meshPhysicalMaterial color="#edf7f2" transparent opacity={0.26} ior={1.45} roughness={0.1} metalness={0.03} envMapIntensity={1.2} reflectivity={0.6} clearcoat={1} clearcoatRoughness={0.08} depthWrite={false} />
      </mesh>
      {/* 顶牌用简洁餐盘图形，避免依赖字体文件或贴图。 */}
      <mesh position={[0, 2.4, 0.558]} rotation={[PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.085, 0.085, 0.012, 24]} />
        <meshStandardMaterial color="#f9fbf9" roughness={0.5} />
      </mesh>
      {[-0.18, 0.18].map((side) => (
        <mesh key={side} position={[side, 2.4, 0.561]}>
          <boxGeometry args={[0.018, 0.14, 0.012]} />
          <meshStandardMaterial color="#f9fbf9" roughness={0.5} />
        </mesh>
      ))}
      {[-0.67, 0, 0.67].map((tx, index) => (
        <group key={tx} position={[tx, 1.025, 0.35]}>
          <mesh receiveShadow>
            <boxGeometry args={[0.53, 0.065, 0.4]} />
            <meshStandardMaterial color={STEEL} metalness={0.82} roughness={0.28} />
          </mesh>
          <mesh position={[0, 0.036, 0]} receiveShadow>
            <boxGeometry args={[0.44, 0.012, 0.31]} />
            <meshStandardMaterial color="#a6b6b0" roughness={0.35} metalness={0.8} />
          </mesh>
          {[-0.13, 0, 0.13].map((foodX) => (
            <mesh key={foodX} position={[foodX, 0.06, 0]} castShadow>
              <sphereGeometry args={[0.085, 8, 6]} />
              <meshStandardMaterial color={['#b8c8a6', '#e1cca5', '#d4b0a1'][index]} roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

function ServingCounter() {
  return (
    <group>
      <mesh position={[0, 0.46, -2.68]} castShadow receiveShadow>
        <boxGeometry args={[7.95, 0.92, 0.88]} />
        <meshStandardMaterial color="#d5e3dd" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.09, -2.2]} receiveShadow>
        <boxGeometry args={[7.95, 0.15, 0.055]} />
        <meshStandardMaterial color="#bac8c4" metalness={0.8} roughness={0.36} />
      </mesh>
      <mesh position={[0, 0.96, -2.65]} castShadow receiveShadow>
        <boxGeometry args={[8.1, 0.08, 1.04]} />
        <meshStandardMaterial color="#dce4e2" metalness={0.84} roughness={0.28} />
      </mesh>
      {[-2.65, 0, 2.65].map((x) => (
        <mesh key={x} position={[x, 0.52, -2.225]} receiveShadow>
          <boxGeometry args={[2.43, 0.57, 0.024]} />
          <meshStandardMaterial color="#e5eeea" roughness={0.65} />
        </mesh>
      ))}
      {/* 取餐滑轨及其支架。 */}
      <mesh position={[0, 0.85, -1.99]} castShadow>
        <boxGeometry args={[7.9, 0.035, 0.2]} />
        <meshStandardMaterial color={STEEL} roughness={0.27} metalness={0.82} />
      </mesh>
      {[-3.5, 0, 3.5].map((x) => (
        <mesh key={x} position={[x, 0.75, -2.12]} rotation={[-PI / 5, 0, 0]} castShadow>
          <boxGeometry args={[0.035, 0.28, 0.035]} />
          <meshStandardMaterial color={STEEL} roughness={0.3} metalness={0.8} />
        </mesh>
      ))}
    </group>
  )
}

function Stool({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.46, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.21, 0.2, 0.085, 24]} />
        <meshStandardMaterial color="#c9ddd3" roughness={0.48} metalness={0} />
      </mesh>
      <mesh position={[0, 0.235, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.39, 12]} />
        <meshStandardMaterial color={STEEL} roughness={0.27} metalness={0.78} />
      </mesh>
      <mesh position={[0, 0.047, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.17, 0.19, 0.045, 20]} />
        <meshStandardMaterial color="#bcc9c5" roughness={0.36} metalness={0.8} />
      </mesh>
      <mesh position={[0, 0.19, 0]} rotation={[PI / 2, 0, 0]} castShadow>
        <torusGeometry args={[0.12, 0.013, 6, 20]} />
        <meshStandardMaterial color={STEEL} roughness={0.3} metalness={0.75} />
      </mesh>
    </group>
  )
}

function LongTable({ z }: { z: number }) {
  const outline = useMemo(() => {
    const shape = new THREE.Shape()
    const x = 2.35
    const y = 0.52
    const r = 0.1
    shape.moveTo(-x + r, -y)
    shape.lineTo(x - r, -y)
    shape.quadraticCurveTo(x, -y, x, -y + r)
    shape.lineTo(x, y - r)
    shape.quadraticCurveTo(x, y, x - r, y)
    shape.lineTo(-x + r, y)
    shape.quadraticCurveTo(-x, y, -x, y - r)
    shape.lineTo(-x, -y + r)
    shape.quadraticCurveTo(-x, -y, -x + r, -y)
    return shape
  }, [])
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0.73, 0]} rotation={[-PI / 2, 0, 0]} castShadow receiveShadow>
        <extrudeGeometry args={[outline, { depth: 0.065, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.012, bevelSegments: 2, steps: 1, curveSegments: 6 }]} />
        <meshStandardMaterial color="#f4f6f3" roughness={0.25} metalness={0} />
      </mesh>
      {[-0.26, 0.12, 0.34].map((dz) => (
        <mesh key={dz} position={[0, 0.808, dz]} receiveShadow>
          <boxGeometry args={[4.42, 0.001, 0.006]} />
          <meshStandardMaterial color="#e7ece7" metalness={0} roughness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.665, 0]} castShadow>
        <boxGeometry args={[4.35, 0.08, 0.75]} />
        <meshStandardMaterial color="#c1ceca" metalness={0.82} roughness={0.32} />
      </mesh>
      {[-2.08, 2.08].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          {[-0.34, 0.34].map((dz) => (
            <mesh key={dz} position={[0, 0.35, dz]} castShadow>
              <cylinderGeometry args={[0.04, 0.045, 0.64, 12]} />
              <meshStandardMaterial color={STEEL} roughness={0.27} metalness={0.8} />
            </mesh>
          ))}
          <mesh position={[0, 0.17, 0]} castShadow>
            <boxGeometry args={[0.045, 0.045, 0.72]} />
            <meshStandardMaterial color={STEEL} roughness={0.3} metalness={0.78} />
          </mesh>
        </group>
      ))}
      {[-1.8, -0.9, 0, 0.9, 1.8].map((x) =>
        [-0.83, 0.83].map((dz) => <Stool key={`${x}:${dz}`} x={x} z={dz} />),
      )}
      {[-1.75, 0.85].map((x) => (
        <group key={x} position={[x, 0.827, 0]}>
          <mesh receiveShadow>
            <boxGeometry args={[0.47, 0.025, 0.34]} />
            <meshStandardMaterial color="#d2ddda" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[-0.07, 0.027, 0]} receiveShadow>
            <cylinderGeometry args={[0.11, 0.095, 0.025, 20]} />
            <meshStandardMaterial color="#f8f9f5" roughness={0.3} />
          </mesh>
          {[{ x: 0.095, color: '#dfc69e' }, { x: 0.175, color: '#b6cda8' }].map((meal) => (
            <mesh key={meal.x} position={[meal.x, 0.037, 0.085]} castShadow>
              <boxGeometry args={[0.065, 0.04, 0.075]} />
              <meshStandardMaterial color={meal.color} roughness={0.64} />
            </mesh>
          ))}
          <mesh position={[0.13, 0.073, -0.05]} castShadow>
            <cylinderGeometry args={[0.045, 0.035, 0.12, 12]} />
            <meshStandardMaterial color="#eaf0eb" metalness={0} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

interface Diner {
  p: [number, number, number]
  c: string
  seated?: boolean
}
const NORMAL_DINERS: Diner[] = [
  { p: [-0.9, 0, -1.28], c: '#8299a5', seated: true },
  { p: [0, 0, 0.38], c: '#ac9891', seated: true },
  { p: [-2.85, 0, -1.45], c: '#b4ad92' },
  { p: [2.9, 0, 2.8], c: '#98a294' },
]
const ALERT_EXTRA_DINERS: Diner[] = [
  { p: [0.4, 0, -1.5], c: '#a19ba9' },
  { p: [2.7, 0, -1.45], c: '#b5a3a6' },
  { p: [-3.25, 0, -0.6], c: '#94a59e' },
  { p: [0.9, 0, 1.32], c: '#aaa08a', seated: true },
  { p: [-0.9, 0, 2.98], c: '#8999ad', seated: true },
  { p: [3.3, 0, 0.5], c: '#a89393' },
]

/** 纯几何食堂；NORMAL 4 人，ALERT / CRITICAL 10 人。 */
export default function Canteen3D({
  status = 'NORMAL',
  actionType = null,
  className = '',
  style,
}: InteriorSceneProps) {
  const alert = alertOf(status)
  const diners = alert ? [...NORMAL_DINERS, ...ALERT_EXTRA_DINERS] : NORMAL_DINERS
  return (
    <SceneContainer
      alert={alert}
      status={status}
      actionType={actionType}
      camera={[7.7, 8.2, 10.7]}
      target={[0, 0.4, 0.1]}
      fov={32}
      roomSize={[9.64, 7.4]}
      roomCenter={[0, 0.1]}
      roomHeight={3.2}
      className={className}
      style={style}
    >
      <Hall />
      <ServingCounter />
      {[-2.65, 0, 2.65].map((x, index) => (
        <ServingKiosk key={x} x={x} color={['#b3cfc1', '#c8d7be', '#bfd4cd'][index]} />
      ))}
      <LongTable z={-0.45} />
      <LongTable z={2.15} />
      {diners.map((diner, index) => (
        <Person key={index} position={diner.p} color={diner.c} seated={diner.seated} />
      ))}
      <mesh position={[0, 3.055, 0]} castShadow>
        <cylinderGeometry args={[0.085, 0.085, 0.13, 16]} />
        <meshStandardMaterial color="#c2ceca" roughness={0.3} metalness={0.82} />
      </mesh>
      <mesh position={[0, 2.84, 0]} castShadow>
        <cylinderGeometry args={[0.038, 0.038, 0.36, 12]} />
        <meshStandardMaterial color={STEEL} roughness={0.25} metalness={0.8} />
      </mesh>
      {/* 保持挂载，使停机时机身可见且共享扇叶能平滑减速。 */}
      <WallFan position={[0, 2.62, 0]} rotation={[PI / 2, 0, 0]} scale={1.4} airflowLength={1.25} spinning={actionType === 'FAN'} />
      {WINDOW_Z.map((z) => (
        <SwingWindow
          key={z}
          position={[4.82, 0, z]}
          rotationY={-PI / 2}
          width={WINDOW_WIDTH}
          height={WINDOW_HEIGHT}
          sill={WINDOW_SILL}
          open={actionType === 'WINDOW'}
        />
      ))}
    </SceneContainer>
  )
}

export { Canteen3D }
