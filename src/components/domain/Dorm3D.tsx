'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  AIRFLOW_COLOR,
  Person,
  SceneContainer,
  SwingWindow,
  WallMaterial,
  alertOf,
  type InteriorSceneProps,
} from './interiorShared'

/**
 * 低多边形 3D 宿舍微场景（zone-n 东区宿舍）：嵌套在区域详情弹窗中作为「内部实景模拟」。
 *
 * 布局：西墙一组上下铺（细长圆柱床柱 + 框架 + 两张床垫 + 扶梯），
 * 后墙一张公共书桌，两名学生常坐在书桌前。
 * 交互由两个 props 驱动：
 *   status     —— ALERT / CRITICAL（如温度异常）时环境光平滑转为暖红，
 *                 后墙上方浮现一台空调内机（从无到有放大进入）
 *   actionType —— 'FAN' 空调内机下吹出蓝色冷气流线并轻轻摆动；
 *                 'WINDOW' 后墙玻璃窗绕竖直铰链向外平滑旋开
 *
 * 相机：东南上方俯视——书桌、空调与窗户都在后墙，正对镜头。
 */

/* ---------------- 房间框架：地台 + 后墙 + 两侧墙（前侧开敞） ---------------- */
function Room() {
  return (
    <group>
      <mesh position={[0, -0.12, 0.05]} receiveShadow>
        <boxGeometry args={[6.8, 0.24, 5.7]} />
        <meshStandardMaterial color="#efece4" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.012, 0.05]} receiveShadow>
        <boxGeometry args={[6.3, 0.024, 5.2]} />
        <meshStandardMaterial color="#e0d8c6" roughness={0.9} />
      </mesh>

      {/* 后墙 z=-2.55 */}
      <mesh position={[0, 1.4, -2.55]} castShadow receiveShadow>
        <boxGeometry args={[6.3, 2.8, 0.16]} />
        <WallMaterial />
      </mesh>
      {/* 两侧墙 x=±3.15 */}
      {[-3.15, 3.15].map((x) => (
        <mesh key={x} position={[x, 1.4, 0.05]} castShadow receiveShadow>
          <boxGeometry args={[0.16, 2.8, 5.2]} />
          <WallMaterial />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- 上下铺：四根床柱 + 纵横框架 + 两张床垫 + 扶梯 ---------------- */
function BunkBed() {
  // 床体沿 z 轴摆放：长 1.8（z）× 宽 0.9（x），中心 (-2.3, -1.3)
  const cx = -2.3
  const cz = -1.3
  const posts: [number, number][] = [
    [cx - 0.45, cz - 0.9],
    [cx + 0.45, cz - 0.9],
    [cx - 0.45, cz + 0.9],
    [cx + 0.45, cz + 0.9],
  ]
  return (
    <group>
      {/* 四根细长圆柱床柱 */}
      {posts.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.925, z]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 1.85, 8]} />
          <meshStandardMaterial color="#7c878d" roughness={0.6} metalness={0.2} />
        </mesh>
      ))}
      {/* 两层侧梁与端梁 */}
      {[0.5, 1.52].map((y) => (
        <group key={y}>
          {[cx - 0.45, cx + 0.45].map((x) => (
            <mesh key={x} position={[x, y, cz]} castShadow>
              <boxGeometry args={[0.06, 0.08, 1.86]} />
              <meshStandardMaterial color="#8e979c" roughness={0.65} />
            </mesh>
          ))}
          {[cz - 0.9, cz + 0.9].map((z) => (
            <mesh key={z} position={[cx, y, z]} castShadow>
              <boxGeometry args={[0.96, 0.08, 0.06]} />
              <meshStandardMaterial color="#8e979c" roughness={0.65} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 两张床垫 + 枕头 */}
      {[
        { y: 0.56, color: '#7fa8c9' },
        { y: 1.58, color: '#e0a8b0' },
      ].map(({ y, color }) => (
        <group key={y}>
          <mesh position={[cx, y, cz]} castShadow>
            <boxGeometry args={[0.82, 0.14, 1.72]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
          <mesh position={[cx, y + 0.1, cz - 0.62]} castShadow>
            <boxGeometry args={[0.5, 0.08, 0.3]} />
            <meshStandardMaterial color="#f2ede4" roughness={0.95} />
          </mesh>
        </group>
      ))}
      {/* 上铺外侧护栏 */}
      <mesh position={[cx + 0.45, 1.8, cz]} castShadow>
        <boxGeometry args={[0.04, 0.28, 1.72]} />
        <meshStandardMaterial color="#8e979c" roughness={0.65} />
      </mesh>
      {/* 床尾扶梯：两根立柱 + 三级踏步 */}
      {[cx - 0.28, cx + 0.28].map((x) => (
        <mesh key={x} position={[x, 1.0, cz + 0.98]} castShadow>
          <boxGeometry args={[0.05, 1.1, 0.05]} />
          <meshStandardMaterial color="#7c878d" roughness={0.6} />
        </mesh>
      ))}
      {[0.75, 1.05, 1.35].map((y) => (
        <mesh key={y} position={[cx, y, cz + 0.98]} castShadow>
          <boxGeometry args={[0.6, 0.04, 0.05]} />
          <meshStandardMaterial color="#8e979c" roughness={0.65} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- 公共书桌：桌面 + 板腿 + 书本 + 两张圆凳 ---------------- */
function StudyDesk() {
  return (
    <group>
      <mesh position={[1.3, 0.72, -2.1]} castShadow receiveShadow>
        <boxGeometry args={[1.7, 0.07, 0.7]} />
        <meshStandardMaterial color="#b08968" roughness={0.8} />
      </mesh>
      {[0.55, 2.05].map((x) => (
        <mesh key={x} position={[x, 0.36, -2.1]} castShadow>
          <boxGeometry args={[0.06, 0.72, 0.6]} />
          <meshStandardMaterial color="#8c6a4f" roughness={0.85} />
        </mesh>
      ))}
      {/* 桌上书本 */}
      <mesh position={[0.9, 0.79, -2.2]} castShadow>
        <boxGeometry args={[0.32, 0.05, 0.24]} />
        <meshStandardMaterial color="#9db98a" roughness={0.9} />
      </mesh>
      <mesh position={[1.75, 0.78, -2.05]} rotation={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.28, 0.04, 0.2]} />
        <meshStandardMaterial color="#b39bc8" roughness={0.9} />
      </mesh>
      {/* 圆凳 */}
      {[0.9, 1.7].map((x) => (
        <mesh key={x} position={[x, 0.225, -1.5]} castShadow>
          <cylinderGeometry args={[0.16, 0.18, 0.45, 10]} />
          <meshStandardMaterial color="#a8adb3" roughness={0.85} />
        </mesh>
      ))}
    </group>
  )
}

/* ---------------- 空调内机：告警/排风时在后墙上浮现（damp 缩放进出） ---------------- */
function AirConditioner({ visible }: { visible: boolean }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame((_, delta) => {
    const s = THREE.MathUtils.damp(ref.current.scale.x, visible ? 1 : 0, 4, delta)
    ref.current.scale.setScalar(Math.max(s, 0.01))
    ref.current.visible = s > 0.02
  })
  return (
    <group ref={ref} position={[1.3, 2.14, -2.36]} scale={0.01}>
      {/* 机身 */}
      <mesh castShadow>
        <boxGeometry args={[1.15, 0.34, 0.24]} />
        <meshStandardMaterial color="#f4f6f4" roughness={0.5} />
      </mesh>
      {/* 前面板 */}
      <mesh position={[0, 0, 0.115]}>
        <boxGeometry args={[1.05, 0.26, 0.02]} />
        <meshStandardMaterial color="#e8ecee" roughness={0.45} />
      </mesh>
      {/* 出风口导风板 */}
      <mesh position={[0, -0.14, 0.1]}>
        <boxGeometry args={[0.95, 0.05, 0.06]} />
        <meshStandardMaterial color="#9aa4a8" roughness={0.6} />
      </mesh>
      {/* 运行指示灯 */}
      <mesh position={[0.45, -0.06, 0.125]}>
        <sphereGeometry args={[0.02, 8, 6]} />
        <meshStandardMaterial color="#54c8dd" emissive="#54c8dd" emissiveIntensity={1.6} />
      </mesh>
    </group>
  )
}

/* ---------------- 冷气流线：FAN 时从空调出风口向下吹出并轻轻摆动 ---------------- */
function coldStreamCurve(dx: number): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(dx, 0, 0.05),
    new THREE.Vector3(dx * 0.9, -0.45, 0.32),
    new THREE.Vector3(dx * 0.75, -0.9, 0.68),
    new THREE.Vector3(dx * 0.6, -1.25, 0.95),
  ])
}

function ColdAirflow() {
  const ref = useRef<THREE.Group>(null!)
  const curves = useMemo(() => [-0.32, 0, 0.32].map((dx) => coldStreamCurve(dx)), [])
  useFrame(({ clock }, delta) => {
    // 出现动画：从出风口向下生长
    const s = THREE.MathUtils.damp(ref.current.scale.y, 1, 3.5, delta)
    ref.current.scale.set(1, Math.max(s, 0.01), 1)
    // 气流整体轻微摆动，模拟风感
    ref.current.rotation.x = Math.sin(clock.elapsedTime * 2.1) * 0.045
  })
  return (
    <group ref={ref} position={[1.3, 1.94, -2.3]} scale={[1, 0.01, 1]}>
      {curves.map((curve, i) => (
        <mesh key={i}>
          <tubeGeometry args={[curve, 40, 0.018, 6, false]} />
          <meshStandardMaterial
            color={AIRFLOW_COLOR}
            transparent
            opacity={0.5}
            roughness={0.4}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

export default function Dorm3D({
  status = 'NORMAL',
  actionType = null,
  className = '',
  style,
}: InteriorSceneProps) {
  const alert = alertOf(status)
  const fanActive = actionType === 'FAN'
  // 温度异常（告警）或手动开启排风/空调时，空调内机出现
  const acVisible = alert || fanActive
  return (
    <SceneContainer
      alert={alert}
      camera={[4.6, 5.6, 6.2]}
      target={[0, 0.85, -0.4]}
      className={className}
      style={style}
    >
      <Room />
      <BunkBed />
      <StudyDesk />

      {/* 两名学生常坐书桌前 */}
      <Person position={[0.9, 0, -1.5]} color="#7fa8c9" seated />
      <Person position={[1.7, 0, -1.5]} color="#e3c878" seated />

      {/* 告警时浮现空调内机；FAN 时吹出冷气流线 */}
      <AirConditioner visible={acVisible} />
      {fanActive && <ColdAirflow />}

      {/* WINDOW：后墙玻璃窗向外旋开 */}
      <SwingWindow position={[-0.6, 0, -2.46]} width={1.15} height={1.25} open={actionType === 'WINDOW'} />
    </SceneContainer>
  )
}

export { Dorm3D }
