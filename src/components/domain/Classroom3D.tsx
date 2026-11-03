'use client'

import type { CSSProperties } from 'react'
import { RoundedBox } from '@react-three/drei'
import type { ZoneStatus } from '../../data/types'
import {
  FloorMaterial,
  FRAME_COLOR,
  Person,
  SceneContainer,
  SwingWindow,
  WallFan,
  WallMaterial,
  alertOf,
} from './interiorShared'

/** 程序几何教室：状态控制人数与告警灯光，动作控制风扇或平开窗。 */
export type ClassroomAction = 'FAN' | 'WINDOW' | null

export interface Classroom3DProps {
  status?: ZoneStatus
  actionType?: ClassroomAction
  className?: string
  /** 嵌入固定高度容器时可传入 { minHeight: 0 }。 */
  style?: CSSProperties
}

const PI = Math.PI
const WINDOW_Z = [-1.65, -0.25]

function WoodMaterial({ color = '#d9d2c3' }: { color?: string }) {
  return <meshStandardMaterial color={color} metalness={0} roughness={0.8} />
}

function MetalMaterial({ color = '#c9cece' }: { color?: string }) {
  return <meshStandardMaterial color={color} metalness={0.76} roughness={0.34} />
}

function Room() {
  return (
    <group>
      <RoundedBox args={[7.9, 0.24, 6.2]} radius={0.08} smoothness={2} position={[0, -0.12, 0.1]} receiveShadow>
        <meshStandardMaterial color="#e2e5e4" metalness={0.08} roughness={0.64} />
      </RoundedBox>
      <mesh position={[0, 0.005, 0.1]} receiveShadow>
        <boxGeometry args={[7.4, 0.02, 5.7]} />
        <FloorMaterial color="#eef0ef" />
      </mesh>
      {Array.from({ length: 36 }, (_, i) => {
        const col = i % 6
        const row = Math.floor(i / 6)
        return (
          <mesh key={i} position={[-3.075 + col * 1.23, 0.022, -2.27 + row * 0.948]} receiveShadow>
            <boxGeometry args={[1.218, 0.018, 0.936]} />
            <FloorMaterial color={['#f1f3f2', '#eef1f0', '#f3f4f3'][(col + row) % 3]} />
          </mesh>
        )
      })}

      <mesh position={[0, 1.35, -2.85]} castShadow receiveShadow>
        <boxGeometry args={[7.6, 2.7, 0.16]} />
        <WallMaterial />
      </mesh>
      <mesh position={[-3.72, 1.35, 0.1]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 2.7, 5.9]} />
        <WallMaterial />
      </mesh>

      {/* 东墙只在窗洞周围建墙；前段降低，避免遮住课桌和打开的窗扇。 */}
      <mesh position={[3.72, 0.51, -1.225]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 1.02, 3.25]} />
        <WallMaterial />
      </mesh>
      <mesh position={[3.72, 2.51, -1.225]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.38, 3.25]} />
        <WallMaterial />
      </mesh>
      {[
        { z: -2.5375, depth: 0.625 },
        { z: -0.95, depth: 0.25 },
        { z: 0.3625, depth: 0.075 },
      ].map(({ z, depth }) => (
        <mesh key={z} position={[3.72, 1.67, z]} castShadow receiveShadow>
          <boxGeometry args={[0.16, 1.3, depth]} />
          <WallMaterial />
        </mesh>
      ))}
      <mesh position={[3.72, 0.25, 1.725]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.5, 2.65]} />
        <WallMaterial />
      </mesh>
      <mesh position={[3.72, 0.52, 1.725]} castShadow>
        <boxGeometry args={[0.22, 0.055, 2.65]} />
        <meshStandardMaterial color={FRAME_COLOR} metalness={0.8} roughness={0.34} />
      </mesh>
      <mesh position={[0, 0.1, -2.75]} receiveShadow>
        <boxGeometry args={[7.35, 0.17, 0.045]} />
        <meshStandardMaterial color="#d4d9d7" roughness={0.7} />
      </mesh>
      <mesh position={[-3.62, 0.1, 0.1]} receiveShadow>
        <boxGeometry args={[0.045, 0.17, 5.7]} />
        <meshStandardMaterial color="#d4d9d7" roughness={0.7} />
      </mesh>
    </group>
  )
}

function Chalkboard() {
  return (
    <group position={[-0.35, 1.74, -2.735]}>
      <RoundedBox args={[4.4, 1.42, 0.1]} radius={0.035} smoothness={2} castShadow receiveShadow>
        <MetalMaterial />
      </RoundedBox>
      <mesh position={[0, 0, 0.06]} receiveShadow>
        <boxGeometry args={[4.22, 1.24, 0.025]} />
        <meshStandardMaterial color="#3f5550" roughness={0.88} />
      </mesh>
      {[
        [-1.45, 0.3, 0.68], [-0.51, 0.3, 0.16], [0.04, 0.3, 0.55],
        [-1.38, -0.03, 0.82], [-0.19, -0.03, 0.74],
        [-1.55, -0.35, 0.48], [-0.62, -0.35, 0.75],
      ].map(([x, y, width], index) => (
        <mesh key={index} position={[x, y, 0.077]}>
          <boxGeometry args={[width, 0.018, 0.003]} />
          <meshStandardMaterial color="#eef1eb" roughness={1} />
        </mesh>
      ))}
      <mesh position={[-0.51, 0.3, 0.078]}>
        <boxGeometry args={[0.018, 0.16, 0.003]} />
        <meshStandardMaterial color="#eef1eb" roughness={1} />
      </mesh>
      {/* 几何粉笔图形，无文字贴图和外部字体。 */}
      <mesh position={[1.2, 0.05, 0.079]} rotation={[0, 0, PI / 6]}>
        <ringGeometry args={[0.34, 0.355, 3]} />
        <meshStandardMaterial color="#eef1eb" roughness={1} />
      </mesh>
      <RoundedBox args={[4.36, 0.06, 0.24]} radius={0.018} smoothness={2} position={[0, -0.73, 0.1]} castShadow>
        <MetalMaterial />
      </RoundedBox>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-1.5 + i * 0.24, -0.683, 0.12]} rotation={[0, 0, PI / 2]} castShadow>
          <cylinderGeometry args={[0.014, 0.014, 0.15, 6]} />
          <meshStandardMaterial color={['#f4f3ed', '#e2d7b5', '#e2c9c6'][i]} roughness={1} />
        </mesh>
      ))}
      <RoundedBox args={[0.25, 0.08, 0.12]} radius={0.012} smoothness={2} position={[1.47, -0.66, 0.1]} castShadow>
        <meshStandardMaterial color="#a8aaa1" metalness={0} roughness={0.8} />
      </RoundedBox>
    </group>
  )
}

function Desk({ position, bookColor }: { position: [number, number, number]; bookColor: string }) {
  return (
    <group position={position}>
      <RoundedBox args={[1.08, 0.075, 0.66]} radius={0.035} smoothness={2} position={[0, 0.75, 0]} castShadow receiveShadow>
        <WoodMaterial />
      </RoundedBox>
      <mesh position={[0, 0.69, 0]} castShadow>
        <boxGeometry args={[0.91, 0.045, 0.5]} />
        <MetalMaterial />
      </mesh>
      <mesh position={[0, 0.52, -0.02]} castShadow receiveShadow>
        <boxGeometry args={[0.87, 0.04, 0.39]} />
        <WoodMaterial color="#c9c3b5" />
      </mesh>
      {[-0.43, 0.43].flatMap((x) => [-0.24, 0.24].map((z) => (
        <group key={`${x}:${z}`} position={[x, 0, z]}>
          <mesh position={[0, 0.37, 0]} castShadow>
            <cylinderGeometry args={[0.025, 0.028, 0.68, 8]} />
            <MetalMaterial color="#505856" />
          </mesh>
          <mesh position={[0, 0.047, 0]} castShadow>
            <cylinderGeometry args={[0.032, 0.033, 0.055, 8]} />
            <meshStandardMaterial color="#424a49" roughness={0.85} />
          </mesh>
        </group>
      )))}
      <group position={[-0.15, 0.8, -0.035]} rotation={[0, -0.13, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.33, 0.035, 0.24]} />
          <meshStandardMaterial color={bookColor} roughness={0.68} />
        </mesh>
        <mesh position={[0, 0.019, 0]} receiveShadow>
          <boxGeometry args={[0.3, 0.004, 0.21]} />
          <meshStandardMaterial color="#f6f5ef" roughness={0.93} />
        </mesh>
      </group>
      <mesh position={[0.2, 0.797, 0.02]} rotation={[0, 0.3, PI / 2]} castShadow>
        <cylinderGeometry args={[0.008, 0.008, 0.2, 6]} />
        <meshStandardMaterial color="#b7b19c" metalness={0} roughness={0.78} />
      </mesh>
    </group>
  )
}

function Chair({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <RoundedBox args={[0.45, 0.06, 0.43]} radius={0.025} smoothness={2} position={[0, 0.45, 0]} castShadow receiveShadow>
        <WoodMaterial color="#d8d2c4" />
      </RoundedBox>
      <RoundedBox args={[0.44, 0.27, 0.055]} radius={0.022} smoothness={2} position={[0, 0.76, 0.2]} rotation={[-0.08, 0, 0]} castShadow>
        <WoodMaterial color="#d8d2c4" />
      </RoundedBox>
      {[-0.17, 0.17].flatMap((x) => [-0.16, 0.16].map((z) => (
        <mesh key={`${x}:${z}`} position={[x, 0.24, z]} castShadow>
          <cylinderGeometry args={[0.021, 0.024, 0.42, 8]} />
          <MetalMaterial color="#505856" />
        </mesh>
      )))}
      {[-0.17, 0.17].map((x) => (
        <mesh key={x} position={[x, 0.64, 0.19]} castShadow>
          <cylinderGeometry args={[0.018, 0.018, 0.42, 8]} />
          <MetalMaterial color="#505856" />
        </mesh>
      ))}
    </group>
  )
}

const SEATS = [
  { x: -1.5, z: -1.05 }, { x: 0.85, z: -1.05 },
  { x: -1.5, z: 0.25 }, { x: 0.85, z: 0.25 },
  { x: -1.5, z: 1.55 }, { x: 0.85, z: 1.55 },
]
const NORMAL_SEATS = [0, 2, 3, 5]
const STUDENT_COLORS = ['#b0c9d8', '#d7c5be', '#d6d0b6', '#b5cbbd', '#c7c2d4', '#d8c2c6']

export default function Classroom3D({
  status = 'NORMAL',
  actionType = null,
  className = '',
  style,
}: Classroom3DProps) {
  const alert = alertOf(status)
  const seatIndexes = alert ? SEATS.map((_, i) => i) : NORMAL_SEATS
  return (
    <SceneContainer
      denseLandscape
      alert={alert}
      status={status}
      actionType={actionType}
      camera={[7.6, 7.4, 10.8]}
      target={[0, 0, 0]}
      fov={32}
      roomSize={[7.44, 5.9]}
      roomCenter={[0, 0.1]}
      roomHeight={2.7}
      className={`classroom-3d ${className}`}
      style={style}
    >
      <Room />
      <Chalkboard />
      {SEATS.map((seat, index) => (
        <group key={`${seat.x}:${seat.z}`}>
          <Desk position={[seat.x, 0, seat.z]} bookColor={STUDENT_COLORS[index]} />
          <Chair position={[seat.x, 0, seat.z + 0.57]} />
        </group>
      ))}
      {seatIndexes.map((seatIndex) => (
        <Person
          key={seatIndex}
          position={[SEATS[seatIndex].x, 0, SEATS[seatIndex].z + 0.54]}
          color={STUDENT_COLORS[seatIndex]}
          seated
        />
      ))}
      <WallFan position={[-3.58, 1.9, -0.35]} rotation={[0, PI / 2, 0]} scale={0.95} spinning={actionType === 'FAN'} />
      {WINDOW_Z.map((z) => (
        <SwingWindow
          key={z}
          position={[3.72, 0, z]}
          rotationY={-PI / 2}
          width={1.15}
          height={1.3}
          sill={1.02}
          open={actionType === 'WINDOW'}
        />
      ))}
    </SceneContainer>
  )
}

export { Classroom3D }
