'use client'

import { useCallback } from 'react'
import type * as THREE from 'three'

type V3 = [number, number, number]
const GROUND = -0.28

function Block({ position, size, color, name = 'garden-block' }: {
  position: V3; size: V3; color: string; name?: string
}) {
  return <mesh name={name} position={position} castShadow receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={0.85} />
  </mesh>
}

/** 网格画在底座本身，免去几十个独立细线网格的绘制开销。 */
function PedestalMaterial() {
  const compile = useCallback<THREE.MeshStandardMaterial['onBeforeCompile']>(shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPedestal; varying vec3 vFace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPedestal = position; vFace = normal;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPedestal; varying vec3 vFace;
    `).replace('#include <color_fragment>', `#include <color_fragment>
      vec2 p = abs(vFace.y) > 0.5 ? vPedestal.xz : (abs(vFace.x) > 0.5 ? vPedestal.zy : vPedestal.xy);
      p *= 2.5;
      vec2 cell = abs(fract(p - 0.5) - 0.5);
      vec2 line = 1.0 - smoothstep(vec2(0.0), max(fwidth(p), vec2(0.001)) * 1.1, cell);
      diffuseColor.rgb *= 1.0 - max(line.x, line.y) * 0.2;
    `)
  }, [])
  return <meshStandardMaterial color="#dce4e7" roughness={0.7} metalness={0.08}
    onBeforeCompile={compile} customProgramCacheKey={() => 'garden-pedestal-grid-v5'} />
}

function Tree({ x, z, height, radius, color, cone = false }: {
  x: number; z: number; height: number; radius: number; color: string; cone?: boolean
}) {
  return <group name="garden-tree" position={[x, GROUND + 0.01, z]}>
    <mesh position={[0, height * 0.28, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.12, 0.18, height * 0.56, 9]} />
      <meshStandardMaterial color="#99816a" roughness={0.95} />
    </mesh>
    <mesh position={[0, height * 0.69, 0]} scale={cone ? [1, 1, 1] : [radius, height * 0.31, radius * 0.94]} castShadow receiveShadow>
      {cone ? <coneGeometry args={[radius, height * 0.76, 10]} /> : <sphereGeometry args={[1, 12, 8]} />}
      <meshStandardMaterial color={color} roughness={0.92} flatShading />
    </mesh>
    {!cone && <mesh position={[radius * 0.45, height * 0.64, 0.08]} scale={[radius * 0.65, height * 0.23, radius * 0.7]} castShadow receiveShadow>
      <sphereGeometry args={[1, 10, 7]} />
      <meshStandardMaterial color={color} roughness={0.94} flatShading />
    </mesh>}
  </group>
}

function Bench({ x, z, facing = 0 }: { x: number; z: number; facing?: number }) {
  return <group name="garden-bench" position={[x, GROUND + 0.016, z]} rotation={[0, facing, 0]}>
    {[-0.15, 0, 0.15].map(t => <Block key={t} position={[0, 0.42, t]} size={[1.4, 0.075, 0.12]} color="#baa78a" />)}
    {[0.59, 0.76].map(y => <Block key={y} position={[0, y, -0.23]} size={[1.4, 0.13, 0.065]} color="#baa78a" />)}
    {[-0.53, 0.53].map(t => <group key={t}>
      <Block position={[t, 0.2, 0]} size={[0.075, 0.4, 0.38]} color="#737f79" />
      <Block position={[t, 0.59, -0.23]} size={[0.055, 0.38, 0.055]} color="#737f79" />
    </group>)}
  </group>
}

function Lamp({ x, z }: { x: number; z: number }) {
  return <group name="garden-lamp" position={[x, GROUND, z]}>
    <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.12, 0.15, 0.08, 12]} />
      <meshStandardMaterial color="#66736d" roughness={0.7} />
    </mesh>
    <mesh position={[0, 0.7, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.04, 0.05, 1.4, 10]} />
      <meshStandardMaterial color="#64716d" metalness={0.5} roughness={0.4} />
    </mesh>
    <mesh position={[0, 1.44, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.27, 0.24, 0.27]} />
      <meshStandardMaterial color="#fffdf3" emissive="#fff7dd" emissiveIntensity={1.05} roughness={0.4} />
    </mesh>
    <Block position={[0, 1.58, 0]} size={[0.32, 0.04, 0.32]} color="#74827b" />
  </group>
}

/** 教室专用的密植外围；坐标由原房间尺寸推导，窗户右侧留出开启走廊。 */
export function ClassroomGarden({ size: [width, depth], center }: {
  size: [number, number]; center: [number, number]
}) {
  const x = width / 2, z = depth / 2
  const trees: [number, number, number, number, string, boolean][] = [
    [-x - 1.75, -z - 1.65, 3.65, 1.02, '#92ad89', false],
    [-width * 0.27, -z - 1.65, 3.85, 1.04, '#a6bd97', true],
    [0, -z - 1.85, 4, 1.08, '#89a980', false],
    [width * 0.28, -z - 1.65, 3.7, 1, '#a3ba96', false],
    [x + 1.7, -z - 1.65, 3.6, 1.02, '#93b18b', true],
    [-x - 1.8, -0.8, 3.3, 1, '#a9bf9c', false],
    [-x - 1.8, z * 0.65, 2.85, 0.95, '#8eac85', false],
    [-x - 1.75, z + 1.7, 2.15, 0.84, '#a4bc98', true],
    [x + 2, z * 0.65, 2.85, 0.96, '#97b28a', false],
    [x + 1.75, z + 1.7, 2.15, 0.84, '#a5bf9a', false],
  ]
  const lawns: [V3, V3][] = [
    [[0, GROUND + 0.005, -z - 1.65], [width + 5.6, 0.01, 2.25]],
    [[-x - 1.75, GROUND + 0.005, -0.15], [2.15, 0.01, depth + 1.35]],
    [[x + 2.18, GROUND + 0.005, -0.15], [1.6, 0.01, depth + 1.35]],
    [[-x - 1.25, GROUND + 0.005, z + 2.1], [3, 0.01, 1.55]],
    [[x + 1.25, GROUND + 0.005, z + 2.1], [3, 0.01, 1.55]],
  ]
  return <group name="classroom-garden" position={[center[0], 0, center[1]]}>
    <mesh name="sandtable-pedestal" position={[0, -0.53, 0]} castShadow receiveShadow>
      <boxGeometry args={[width + 7.2, 0.18, depth + 6.8]} />
      <PedestalMaterial />
    </mesh>
    <Block name="garden-ground" position={[0, -0.36, 0]} size={[width + 6.4, 0.16, depth + 6]} color="#f0f4f1" />
    <Block name="garden-foundation" position={[0, -0.24, 0]} size={[width + 0.4, 0.08, depth + 0.4]} color="#e2e7e5" />
    {lawns.map(([position, size], i) => <Block key={i} name="garden-lawn" position={position} size={size} color={i % 2 ? '#d5e3cb' : '#dce8d3'} />)}

    {/* 主路与支路按端面拼接，交叉处不叠放共面面片。 */}
    <Block name="garden-path" position={[0, GROUND + 0.012, z + 1]} size={[width + 5.8, 0.024, 0.6]} color="#e0e4e2" />
    <Block name="garden-path" position={[0, GROUND + 0.012, z + 2.15]} size={[0.75, 0.024, 1.7]} color="#e0e4e2" />
    <Block name="garden-path" position={[0, GROUND + 0.012, z + 0.5]} size={[0.75, 0.024, 0.4]} color="#e0e4e2" />
    <Block name="garden-path" position={[x + 1, GROUND + 0.012, -0.25]} size={[0.65, 0.024, depth + 1.9]} color="#e0e4e2" />
    <Block name="garden-path" position={[x + 0.5, GROUND + 0.012, 0]} size={[0.35, 0.024, 0.55]} color="#e0e4e2" />
    <Block name="garden-path" position={[x + 2.1, GROUND + 0.012, 0]} size={[1.55, 0.024, 0.55]} color="#e0e4e2" />
    {[0, 1, 2].map(i => <Block key={i} name="garden-step" position={[0, -0.04 - i * 0.075, z + 0.18 + i * 0.17]}
      size={[1.15, 0.13, 0.17]} color="#e4e8e6" />)}

    {trees.map(([tx, tz, height, radius, color, cone], i) => <Tree key={i} x={tx} z={tz} height={height} radius={radius} color={color} cone={cone} />)}
    {/* 密集球簇组成后侧树墙，较低的高度给室内保留可视空间。 */}
    {Array.from({ length: 15 }, (_, i) => <mesh key={i} name="garden-hedge" position={[-x - 1.7 + i * (width + 3.4) / 14, GROUND + 0.48, -z - 1.8]}
      scale={[0.58, 0.62 + (i % 3) * 0.12, 0.58]} castShadow receiveShadow>
      <sphereGeometry args={[1, 10, 7]} />
      <meshStandardMaterial color={i % 2 ? '#a9bf9d' : '#9ab68e'} roughness={0.95} flatShading />
    </mesh>)}
    {[-1, 1].map(side => <group key={side}>
      <Block position={[side * 1.65, GROUND + 0.008, z + 1.85]} size={[1.8, 0.016, 0.85]} color="#e3e8e4" />
      <Bench x={side * 1.65} z={z + 1.85} />
      <Lamp x={side * 0.78} z={z + 2.65} />
    </group>)}
    <group name="garden-pond" position={[x + 0.3, GROUND, z + 2.25]}>
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.72, 0.75, 0.1, 40]} />
        <meshStandardMaterial color="#c5d4d5" roughness={0.62} />
      </mesh>
      <mesh position={[0, 0.106, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.61, 0.61, 0.01, 40]} />
        <meshPhysicalMaterial color="#aacddd" roughness={0.2} metalness={0.08} clearcoat={0.9} />
      </mesh>
      <mesh position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[0.66, 0.052, 8, 40]} />
        <meshStandardMaterial color="#d8e2e1" roughness={0.65} />
      </mesh>
    </group>
  </group>
}
