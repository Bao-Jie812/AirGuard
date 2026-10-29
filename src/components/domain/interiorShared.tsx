'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import * as THREE from 'three'
import type { ZoneStatus } from '../../data/types'

/** 全部使用程序几何；三个房间共用状态、材质与动画，无外部模型或贴图。 */
export type InteriorAction = 'FAN' | 'WINDOW' | null
export interface InteriorSceneProps {
  status?: ZoneStatus
  actionType?: InteriorAction
  className?: string
  style?: CSSProperties
}
type V3 = [number, number, number]
const PI = Math.PI
export const alertOf = (status: ZoneStatus | undefined) => status === 'ALERT' || status === 'CRITICAL'
export const WALL_COLOR = '#f0f2f1'
export const FRAME_COLOR = '#cdd4d5'
export const SKIN_COLOR = '#f2d3b8'
export const AIRFLOW_COLOR = '#acd5e7'

/** 世界坐标程序纹理：跨原有地砖连续，不需要外部图片或改动 UV/顶点。 */
function SurfaceMaterial({ color, floor }: { color: string; floor: boolean }) {
  const compile = useCallback<THREE.MeshStandardMaterial['onBeforeCompile']>((shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSurfaceWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vSurfaceWorld;
      float surfaceNoise(vec3 p) { return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      float gridLine(vec2 p) {
        vec2 cell = abs(fract(p - 0.5) - 0.5);
        vec2 width = max(fwidth(p), vec2(0.001));
        vec2 line = 1.0 - smoothstep(vec2(0.0), width * 1.25, cell);
        return max(line.x, line.y);
      }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      float grain = surfaceNoise(floor(vSurfaceWorld * 180.0));
      float detail = 1.0 - smoothstep(0.008, 0.04, length(fwidth(vSurfaceWorld)));
      diffuseColor.rgb *= 1.0 + (grain - 0.5) * 0.018 * detail;
      ${floor ? `float grid = gridLine(vSurfaceWorld.xz * 4.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.83,0.85,0.86), grid * 0.32);` : ''}
    `)
  }, [floor])
  return <meshStandardMaterial color={color} roughness={floor ? 0.7 : 0.86} metalness={0}
    onBeforeCompile={compile} customProgramCacheKey={() => floor ? 'interior-grid-v3' : 'interior-wall-v3'} />
}
export function WallMaterial() { return <SurfaceMaterial color={WALL_COLOR} floor={false} /> }
export function FloorMaterial({ color = '#eef1f2' }: { color?: string }) {
  return <SurfaceMaterial color={color} floor />
}

export function LightRig({ alert, windowOpen = false, reducedMotion = false }: {
  alert: boolean; windowOpen?: boolean; reducedMotion?: boolean
}) {
  const amb = useRef<THREE.AmbientLight>(null!)
  const hemi = useRef<THREE.HemisphereLight>(null!)
  const sun = useRef<THREE.DirectionalLight>(null!)
  const alarm = useRef<THREE.PointLight>(null!)
  const blend = useRef(0)
  const daylight = useRef(0)
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1)
    blend.current = THREE.MathUtils.damp(blend.current, alert ? 1 : 0, 5, dt)
    daylight.current = THREE.MathUtils.damp(daylight.current, windowOpen ? 1 : 0, 4, dt)
    const a = blend.current
    // 告警只驱动局部红灯；主照明保持中性色，墙面不会整体染红。
    const pulse = reducedMotion ? 0.7 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * PI * 2 * 1.15)
    amb.current.intensity = 0.34 + daylight.current * 0.04
    hemi.current.intensity = 0.5
    sun.current.intensity = 2.15 + daylight.current * 0.08
    alarm.current.intensity = a * (1.2 + pulse * 3)
  })
  return <>
    <ambientLight name="interior-ambient" ref={amb} intensity={0.34} color="#ffffff" />
    <hemisphereLight ref={hemi} args={['#ffffff', '#bfc7c5', 0.5]} />
    <directionalLight name="interior-key-light" ref={sun} position={[-3, 9, 5]} color="#fffaf1" intensity={2.15} castShadow
      shadow-mapSize={[2048, 2048]} shadow-camera-left={-8} shadow-camera-right={8}
      shadow-camera-top={8} shadow-camera-bottom={-8} shadow-camera-near={0.5}
      shadow-camera-far={28} shadow-bias={-0.00015} shadow-normalBias={0.025} />
    <pointLight name="interior-alarm-light" ref={alarm} position={[0, 0.65, 0]} color="#ef5365" intensity={0} distance={3.6} decay={2} />
    {/* 代码生成的反射环境，让金属与木面有高光；frames=1 不会每帧重算。 */}
    <Environment resolution={64} frames={1} environmentIntensity={0.45}>
      <color attach="background" args={['#dce3e5']} />
      <Lightformer position={[0, 5, 0]} rotation={[-PI / 2, 0, 0]} scale={[8, 8, 1]} color="#ffffff" intensity={2} />
      <Lightformer position={[5, 2, 1]} rotation={[0, -PI / 2, 0]} scale={[5, 3, 1]} color="#f0f7ff" intensity={1.5} />
    </Environment>
  </>
}

/** 独立的效果层：贴近原地面/墙角的细发光边，不修改房间和家具几何。 */
function WarningEdges({ alert, watch, reducedMotion, size, center, height }: {
  alert: boolean; watch: boolean; reducedMotion: boolean; size: [number, number]; center: [number, number]; height: number
}) {
  const root = useRef<THREE.Group>(null!)
  const amount = useRef(0)
  const colors = useMemo(() => ({ idle: new THREE.Color('#8cbfac'), watch: new THREE.Color('#deb38a'), alert: new THREE.Color('#ee4e61'), base: new THREE.Color('#8cbfac') }), [])
  useFrame(({ clock }, delta) => {
    amount.current = THREE.MathUtils.damp(amount.current, alert ? 1 : 0, 5, Math.min(delta, 0.1))
    colors.base.lerp(watch ? colors.watch : colors.idle, 1 - Math.exp(-5 * Math.min(delta, 0.1)))
    const pulse = reducedMotion ? 0.7 : 0.5 + Math.sin(clock.elapsedTime * PI * 2 * 1.15) * 0.5
    root.current.children.forEach(child => {
      const material = (child as THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>).material
      material.color.copy(colors.base).lerp(colors.alert, amount.current)
      material.emissive.copy(colors.base).lerp(colors.alert, amount.current)
      material.emissiveIntensity = THREE.MathUtils.lerp(0.18, 0.8 + 1.6 * pulse, amount.current)
    })
  })
  // 地面条避开踢脚线，竖条从踢脚线上方开始。
  const w = size[0] - 0.28, d = size[1] - 0.28
  const wallW = size[0] - 0.2, wallD = size[1] - 0.2
  return <group name="warning-edges" ref={root} position={[center[0], 0, center[1]]}>
    {[-d / 2, d / 2].map(z => <mesh key={`z${z}`} position={[0, 0.047, z]}>
      <boxGeometry args={[w, 0.024, 0.032]} /><meshStandardMaterial color="#8cbfac" emissive="#8cbfac" emissiveIntensity={0.18} roughness={0.45} toneMapped={false} />
    </mesh>)}
    {[-w / 2, w / 2].map(x => <mesh key={`x${x}`} position={[x, 0.047, 0]}>
      <boxGeometry args={[0.032, 0.024, d]} /><meshStandardMaterial color="#8cbfac" emissive="#8cbfac" emissiveIntensity={0.18} roughness={0.45} toneMapped={false} />
    </mesh>)}
    {[-wallW / 2, wallW / 2].map(x => <mesh key={`corner${x}`} position={[x, (height + 0.16) / 2, -wallD / 2]}>
      <boxGeometry args={[0.028, height - 0.2, 0.028]} /><meshStandardMaterial color="#8cbfac" emissive="#8cbfac" emissiveIntensity={0.18} roughness={0.45} toneMapped={false} />
    </mesh>)}
  </group>
}

interface SceneContainerProps {
  alert: boolean
  status?: ZoneStatus
  actionType?: InteriorAction
  camera: V3
  target?: V3
  fov?: number
  className?: string
  style?: CSSProperties
  roomSize?: [number, number]
  roomCenter?: [number, number]
  roomHeight?: number
  children: ReactNode
}
export function SceneContainer({ alert, status, actionType = null, camera, target = [0, 0.8, 0], fov = 30,
  className = '', style, roomSize = [7.44, 5.9], roomCenter = [0, 0.1], roomHeight = 2.7, children }: SceneContainerProps) {
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return <div className={`interior-3d ${className}`} style={{
    position: 'relative', width: '100%', height: '100%', minHeight: 200,
    overflow: 'hidden', borderRadius: 12, background: '#F0F4F8', ...style,
  }}>
    <Canvas flat shadows="soft" dpr={[1, 1.5]} camera={{ position: camera, fov, near: 0.1, far: 80 }}
      fallback={<div style={{ padding: 24 }}>浏览器无法显示 WebGL 场景，请开启硬件加速。</div>}>
      <color attach="background" args={['#F0F4F8']} />
      <LightRig alert={alert} windowOpen={actionType === 'WINDOW'} reducedMotion={reducedMotion} />
      {children}
      <WarningEdges alert={alert} watch={status === 'WATCH'} reducedMotion={reducedMotion} size={roomSize} center={roomCenter} height={roomHeight} />
      <OrbitControls target={target} enableZoom={false} enablePan={false} enableDamping dampingFactor={0.08}
        minPolarAngle={0.55} maxPolarAngle={1.05} minAzimuthAngle={0.35} maxAzimuthAngle={0.95} />
      <EffectComposer multisampling={0} enableNormalPass={false}>
        <N8AO aoRadius={0.3} intensity={3} distanceFalloff={0.8} color="#394542" quality="medium" />
        <Bloom intensity={0.16} luminanceThreshold={1} luminanceSmoothing={0.3} mipmapBlur />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <SMAA />
      </EffectComposer>
    </Canvas>
  </div>
}

export function Person({ position, color, seated = false }: { position: V3; color: string; seated?: boolean }) {
  const y = seated ? 0.24 : 0
  return <group position={position}>
    <mesh position={[0, y + 0.39, 0]} castShadow receiveShadow>
      <capsuleGeometry args={[0.14, 0.5, 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
    <mesh position={[0, y + 0.92, 0]} castShadow>
      <sphereGeometry args={[0.13, 16, 12]} /><meshStandardMaterial color={SKIN_COLOR} roughness={0.76} />
    </mesh>
    <mesh position={[0, y + 0.97, -0.015]} castShadow>
      <sphereGeometry args={[0.132, 12, 8, 0, PI * 2, 0, PI * 0.48]} />
      <meshStandardMaterial color="#3d3432" roughness={0.94} />
    </mesh>
  </group>
}

const SOFT_PARTICLE_VERTEX = `
          attribute float aAlpha;
          attribute float aSize;
          uniform float uPixelHeight;
          uniform float uDpr;
          varying float vAlpha;
          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * viewPosition;
            float depth = projectionMatrix[3][3] == 0.0 ? max(0.1, -viewPosition.z) : 1.0;
            float worldScale = length(modelMatrix[0].xyz);
            gl_PointSize = clamp(aSize * worldScale * uPixelHeight * projectionMatrix[1][1] * 0.5 / depth,
              0.65 * uDpr, 14.0 * uDpr);
            vAlpha = aAlpha;
          }
        `
const SOFT_PARTICLE_FRAGMENT = `
          uniform vec3 uColor;
          varying float vAlpha;
          void main() {
            vec2 uv = gl_PointCoord * 2.0 - 1.0;
            float soft = 1.0 - smoothstep(0.05, 1.0, dot(uv, uv));
            float alpha = vAlpha * soft;
            if (alpha < 0.001) discard;
            gl_FragColor = vec4(uColor, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        `

/** 局部 +Z 喷出柔和微粒；一个 Points draw call，关闭时渐隐并保留各粒子的进度。 */
export function AirFlow({ active, position = [0, 0, 0], rotation = [0, 0, 0], length = 2.15, radius = 0.36 }: {
  active: boolean; position?: V3; rotation?: V3; length?: number; radius?: number
}) {
  const root = useRef<THREE.Group>(null!)
  const geometry = useRef<THREE.BufferGeometry>(null!)
  const material = useRef<THREE.ShaderMaterial>(null!)
  const light = useRef<THREE.PointLight>(null!)
  const amount = useRef(0)
  const time = useRef(0)
  const particles = useMemo(() => {
    const count = 64
    const positions = new Float32Array(count * 3), alpha = new Float32Array(count)
    const sizes = new Float32Array(count), phase = new Float32Array(count)
    const speed = new Float32Array(count), angles = new Float32Array(count), radial = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      // 固定种子让重渲染和截图可复现；黄金角避免粒子排成同心环。
      const seed = ((i * 73 + 19) % 127) / 127
      phase[i] = i / count
      speed[i] = 0.38 + seed * 0.22
      angles[i] = i * 2.39996323
      radial[i] = 0.15 + Math.sqrt(seed) * 0.85
      sizes[i] = 0.065 + seed * 0.035
    }
    return { count, positions, alpha, sizes, phase, speed, angles, radial }
  }, [])
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#79b3cf') },
    uPixelHeight: { value: 1 }, uDpr: { value: 1 },
  }), [])
  useFrame((state, delta) => {
    if (!active && amount.current === 0) return
    const a = THREE.MathUtils.damp(amount.current, active ? 1 : 0, active ? 4.5 : 3.5, delta)
    amount.current = a < 0.001 && !active ? 0 : a
    root.current.visible = amount.current > 0.001
    light.current.intensity = amount.current * 0.65
    if (!root.current.visible) return
    const dt = Math.min(delta, 0.1)
    time.current += dt
    // R3F 会复制传入的 uniform 项；逐帧写实际材质，不能只改初始化对象。
    material.current.uniforms.uDpr.value = state.gl.getPixelRatio()
    material.current.uniforms.uPixelHeight.value = state.size.height * state.gl.getPixelRatio()
    const { count, positions, alpha, phase, speed, angles, radial } = particles
    for (let i = 0; i < count; i++) {
      const p = (phase[i] + dt * speed[i]) % 1
      phase[i] = p
      const angle = angles[i], spread = radius * (0.72 + p * 1.35) * radial[i]
      const wave = radius * (0.025 + p * 0.13)
      positions[i * 3] = Math.cos(angle) * spread + Math.sin(time.current * 2.3 + angle + p * 4) * wave
      positions[i * 3 + 1] = Math.sin(angle) * spread * 0.72 + Math.sin(time.current * 1.8 + angle * 1.7 + p * 5) * wave
      positions[i * 3 + 2] = p * length
      // 起点和终点透明，远处衰减；循环复用粒子时没有硬切跳点。
      alpha[i] = a * 1.2 * Math.sin(p * Math.PI) * (1 - p)
    }
    geometry.current.attributes.position.needsUpdate = true
    geometry.current.attributes.aAlpha.needsUpdate = true
  })
  return <group ref={root} name="airflow" position={position} rotation={rotation} visible={false}>
    {/* 声明式几何和材质由 R3F 释放，避免 StrictMode 中手动提前 dispose。 */}
    <points name="airflow-particles" frustumCulled={false}>
      <bufferGeometry ref={geometry}>
        <bufferAttribute attach="attributes-position" args={[particles.positions, 3]} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-aAlpha" args={[particles.alpha, 1]} usage={THREE.DynamicDrawUsage} />
        <bufferAttribute attach="attributes-aSize" args={[particles.sizes, 1]} />
      </bufferGeometry>
      <shaderMaterial ref={material} transparent depthWrite={false} blending={THREE.NormalBlending} uniforms={uniforms}
        vertexShader={SOFT_PARTICLE_VERTEX} fragmentShader={SOFT_PARTICLE_FRAGMENT} />
    </points>
    <pointLight ref={light} name="airflow-light" position={[0, 0, 0.38]} color="#a9e5fa"
      intensity={0} distance={2.4} decay={2} castShadow={false} />
  </group>
}

/** 风扇原点在转子中心，正面为 +Z；机身常驻，FAN 控制加速/减速与风效。 */
export function WallFan({ position, rotation = [0, 0, 0], scale = 1, spinning, airflowLength = 2.15 }: {
  position: V3; rotation?: V3; scale?: number; spinning: boolean; airflowLength?: number
}) {
  const blades = useRef<THREE.Group>(null!)
  const motor = useRef<THREE.Group>(null!)
  const blur = useRef<THREE.MeshBasicMaterial>(null!)
  const speed = useRef(0)
  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1)
    speed.current = THREE.MathUtils.damp(speed.current, spinning ? 72 : 0, spinning ? 3.5 : 2.4, dt)
    blades.current.rotation.z = (blades.current.rotation.z + speed.current * dt) % (PI * 2)
    const power = speed.current / 72
    blades.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 81) * 0.007 * power)
    motor.current.rotation.x = Math.sin(clock.elapsedTime * 57) * 0.003 * power
    motor.current.position.x = Math.sin(clock.elapsedTime * 63) * 0.0015 * power
    blur.current.opacity = power * 0.17
  })
  return <group name="wall-fan" position={position} rotation={rotation} scale={scale}>
    <group ref={motor}>
      <mesh position={[0, 0, -0.15]} rotation={[PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.13, 0.22, 24]} />
        <meshStandardMaterial color="#c4ccce" metalness={0.9} roughness={0.24} />
      </mesh>
      {[-0.08, 0.13].map(z => <mesh key={z} position={[0, 0, z]} castShadow>
        <torusGeometry args={[0.45, 0.026, 8, 48]} />
        <meshStandardMaterial color="#b8c5cb" metalness={0.88} roughness={0.24} />
      </mesh>)}
      <group ref={blades} name="fan-rotor">
        {[0, 1, 2, 3].map(i => <group key={i} rotation={[0, 0, i * PI / 2]}>
          <mesh position={[0.04, 0.23, 0]} rotation={[0.22, 0.1, -0.28]} scale={[0.105, 0.22, 0.025]} castShadow>
            <sphereGeometry args={[1, 14, 10]} />
            <meshStandardMaterial color="#c1cbcf" metalness={0.88} roughness={0.26} />
          </mesh>
        </group>)}
      </group>
      {/* 半透明转盘模拟高速残影，不依赖后处理。 */}
      <mesh position={[0, 0, 0.07]}>
        <ringGeometry args={[0.1, 0.42, 48]} />
        <meshBasicMaterial ref={blur} color="#b9dbe8" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {[0.17, 0.29, 0.39].map(r => <mesh key={r} position={[0, 0, 0.14]} castShadow>
        <torusGeometry args={[r, 0.007, 4, 40]} />
        <meshStandardMaterial color="#b5c1c7" metalness={0.86} roughness={0.28} />
      </mesh>)}
      {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[0, 0, 0.14]} rotation={[0, 0, i * PI / 8]} castShadow>
        <boxGeometry args={[0.012, 0.87, 0.012]} />
        <meshStandardMaterial color="#b5c1c7" metalness={0.86} roughness={0.28} />
      </mesh>)}
      <mesh position={[0, 0, 0.14]} rotation={[PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.083, 0.083, 0.09, 20]} />
        <meshStandardMaterial color="#d2d8da" metalness={0.86} roughness={0.22} />
      </mesh>
    </group>
    <AirFlow active={spinning} position={[0, 0, 0.2]} length={airflowLength} radius={0.36} />
  </group>
}

/** 微尘独立于通风粒子：缓慢漂浮在开窗光束内部，单个 Points 批次。 */
function WindowDust({ active, width }: { active: boolean; width: number }) {
  const points = useRef<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>(null!)
  const amount = useRef(0)
  const time = useRef(0)
  const data = useMemo(() => {
    const count = 40
    const positions = new Float32Array(count * 3), alpha = new Float32Array(count)
    const sizes = new Float32Array(count), phases = new Float32Array(count)
    for (let i = 0; i < count; i++) { phases[i] = i / count; sizes[i] = 0.04 + (i % 5) * 0.006 }
    return { count, positions, alpha, sizes, phases }
  }, [])
  const uniforms = useMemo(() => ({
    uColor: { value: new THREE.Color('#8cabbc') }, uPixelHeight: { value: 1 }, uDpr: { value: 1 },
  }), [])
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    amount.current = THREE.MathUtils.damp(amount.current, active ? 1 : 0, 4.5, dt)
    points.current.visible = amount.current > 0.002
    if (!points.current.visible) return
    time.current += dt
    const { positions, alpha, phases, count } = data
    for (let i = 0; i < count; i++) {
      const p = phases[i] = (phases[i] + dt * (0.055 + (i % 7) * 0.005)) % 1
      const angle = i * 2.39996323, r = width * (0.12 + p * 0.37) * (0.3 + (i % 9) / 13)
      positions[i * 3] = Math.cos(angle) * r + Math.sin(time.current * 0.7 + i) * 0.025
      positions[i * 3 + 1] = Math.sin(angle) * r + Math.cos(time.current * 0.55 + i) * 0.025
      positions[i * 3 + 2] = 0.12 + p * 3.05
      alpha[i] = amount.current * Math.sin(p * PI) * 0.85
    }
    points.current.geometry.attributes.position.needsUpdate = true
    points.current.geometry.attributes.aAlpha.needsUpdate = true
    points.current.material.uniforms.uPixelHeight.value = state.size.height * state.gl.getPixelRatio()
    points.current.material.uniforms.uDpr.value = state.gl.getPixelRatio()
  })
  return <points ref={points} name="window-dust" visible={false} frustumCulled={false}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[data.positions, 3]} usage={THREE.DynamicDrawUsage} />
      <bufferAttribute attach="attributes-aAlpha" args={[data.alpha, 1]} usage={THREE.DynamicDrawUsage} />
      <bufferAttribute attach="attributes-aSize" args={[data.sizes, 1]} />
    </bufferGeometry>
    <shaderMaterial transparent depthWrite={false} uniforms={uniforms}
      vertexShader={SOFT_PARTICLE_VERTEX} fragmentShader={SOFT_PARTICLE_FRAGMENT} />
  </points>
}

/** SpotLight 负责表面照明，透明光体近似可见散射；不做昂贵的体积光线步进。 */
function WindowIllumination({ open, width, height, sill }: { open: boolean; width: number; height: number; sill: number }) {
  const light = useRef<THREE.SpotLight>(null!)
  const beam = useRef<THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>>(null!)
  const breeze = useRef<THREE.Group>(null!)
  const progress = useRef(0)
  const target = useMemo(() => new THREE.Object3D(), [])
  const uniforms = useMemo(() => ({ uOpen: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color('#f5f9fa') } }), [])
  const curves = useMemo(() => [-1, 0, 1].map(i => new THREE.CatmullRomCurve3(
    Array.from({ length: 9 }, (_, j) => {
      const p = j / 8
      return new THREE.Vector3(i * width * 0.23 + Math.sin(p * PI * 2 + i) * 0.06,
        -p * 0.3 + Math.sin(p * PI * 2 + i) * 0.04, p * 1.8)
    }),
  )), [width])
  const originY = sill + height * 0.7
  useFrame(({ clock }, delta) => {
    progress.current = THREE.MathUtils.damp(progress.current, open ? 1 : 0, 4.5, Math.min(delta, 0.1))
    const a = progress.current
    beam.current.material.uniforms.uOpen.value = a
    breeze.current.children.forEach(child => {
      const material = (child as THREE.Mesh<THREE.TubeGeometry, THREE.ShaderMaterial>).material
      material.uniforms.uOpen.value = a
      material.uniforms.uTime.value = clock.elapsedTime
    })
    light.current.intensity = a * 10
    light.current.visible = a > 0.005
    beam.current.visible = a > 0.005
    breeze.current.visible = a > 0.005
    breeze.current.rotation.y = Math.sin(clock.elapsedTime * 1.2) * 0.025
  })
  return <group name="window-illumination">
    <primitive object={target} position={[0, Math.max(0.15, originY - 1.75), 2.65]} />
    <spotLight ref={light} name="window-spotlight" position={[0, originY, -0.12]} target={target}
      color="#fffaf0" intensity={0} angle={0.36} penumbra={0.8} distance={6} decay={2} castShadow
      shadow-mapSize={[512, 512]} shadow-camera-near={0.05} shadow-camera-far={7} shadow-normalBias={0.02} />
    <group position={[0, originY, 0.05]} rotation={[0.58, 0, 0]}>
      <WindowDust active={open} width={width} />
      <mesh ref={beam} name="window-light-volume" position={[0, 0, 1.6]} rotation={[PI / 2, 0, 0]} visible={false}>
        <cylinderGeometry args={[width * 0.82, width * 0.22, 3.2, 32, 1, true]} />
        <shaderMaterial uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} blending={THREE.NormalBlending}
          vertexShader={`varying vec2 vUv; varying vec3 vNormalView; varying vec3 vView;
            void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.0);vView=-mv.xyz;
              vNormalView=normalMatrix*normal;gl_Position=projectionMatrix*mv;}`}
          fragmentShader={`uniform float uOpen; uniform vec3 uColor; varying vec2 vUv; varying vec3 vNormalView; varying vec3 vView;
            void main(){float along=vUv.y;float facing=pow(abs(dot(normalize(vNormalView),normalize(vView))),1.3);
              float alpha=uOpen*0.48*(0.25+0.75*facing)*smoothstep(0.0,0.12,along)*(1.0-smoothstep(0.2,1.0,along));
              gl_FragColor=vec4(uColor,alpha);
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`} />
      </mesh>
    </group>
    <group ref={breeze} name="window-breeze" position={[0, sill + height * 0.5, 0.1]} visible={false}>
      {curves.map((curve, i) => <mesh key={i}>
        <tubeGeometry args={[curve, 28, 0.009, 5, false]} />
        <shaderMaterial uniforms={uniforms} transparent depthWrite={false}
          vertexShader={`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`}
          fragmentShader={`uniform float uOpen;uniform float uTime;uniform vec3 uColor;varying vec2 vUv;
            void main(){float p=fract(vUv.x-uTime*0.38);float trail=smoothstep(0.0,0.12,p)*(1.0-smoothstep(0.12,0.5,p));
              gl_FragColor=vec4(uColor,uOpen*trail*0.38*sin(vUv.x*3.14159));
              #include <tonemapping_fragment>
              #include <colorspace_fragment>
            }`} />
      </mesh>)}
    </group>
  </group>
}

/** 局部 XY 为墙面，室内为 +Z。墙体需在 width × height 范围留洞；不放实心背板。 */
export function SwingWindow({ position, rotationY = 0, width = 1.15, height = 1.3, sill = 1, open }: {
  position: V3; rotationY?: number; width?: number; height?: number; sill?: number; open: boolean
}) {
  const hinge = useRef<THREE.Group>(null!)
  const openness = useRef(0)
  useFrame((_, delta) => {
    openness.current = THREE.MathUtils.damp(openness.current, open ? 1 : 0, 4.5, Math.min(delta, 0.1))
    const a = openness.current
    hinge.current.rotation.y = a * PI / 2
  })
  const w = width, h = height
  return <group name="swing-window" position={position} rotation={[0, rotationY, 0]}>
    {[sill - 0.03, sill + h + 0.03].map(y => <mesh key={y} position={[0, y, 0]} castShadow receiveShadow>
      <boxGeometry args={[w + 0.16, 0.08, 0.18]} />
      <meshStandardMaterial color={FRAME_COLOR} metalness={0.4} roughness={0.38} />
    </mesh>)}
    {[-w / 2 - 0.03, w / 2 + 0.03].map(x => <mesh key={x} position={[x, sill + h / 2, 0]} castShadow>
      <boxGeometry args={[0.08, h + 0.16, 0.18]} />
      <meshStandardMaterial color={FRAME_COLOR} metalness={0.4} roughness={0.38} />
    </mesh>)}
    <mesh position={[0, sill - 0.08, 0.07]} castShadow receiveShadow>
      <boxGeometry args={[w + 0.28, 0.09, 0.36]} />
      <meshStandardMaterial color="#e1e5e4" roughness={0.7} />
    </mesh>
    <group ref={hinge} name="window-hinge" position={[-w / 2, sill, -0.1]}>
      {/* 玻璃不投不透明矩形阴影；固定框和窗扇框仍投影。 */}
      <mesh position={[w / 2, h / 2, 0]}>
        <boxGeometry args={[w - 0.1, h - 0.1, 0.018]} />
        <meshPhysicalMaterial color="#dceef4" transparent opacity={0.23} roughness={0.09}
          metalness={0.03} clearcoat={1} clearcoatRoughness={0.07} ior={1.46} reflectivity={0.6}
          envMapIntensity={1.2} depthWrite={false} />
      </mesh>
      {[0.025, h - 0.025].map(y => <mesh key={y} position={[w / 2, y, 0]} castShadow>
        <boxGeometry args={[w, 0.05, 0.065]} /><meshStandardMaterial color="#c1c9ca" metalness={0.6} roughness={0.3} />
      </mesh>)}
      {[0.025, w - 0.025].map(x => <mesh key={x} position={[x, h / 2, 0]} castShadow>
        <boxGeometry args={[0.05, h, 0.065]} /><meshStandardMaterial color="#c1c9ca" metalness={0.6} roughness={0.3} />
      </mesh>)}
      <mesh position={[w - 0.1, h * 0.45, 0.055]} castShadow>
        <boxGeometry args={[0.035, 0.16, 0.045]} /><meshStandardMaterial color="#526574" metalness={0.85} roughness={0.24} />
      </mesh>
    </group>
    <WindowIllumination open={open} width={w} height={h} sill={sill} />
  </group>
}

