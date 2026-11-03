'use client'

const GROUND_Y = -0.28

function Tree({ position, height, color, cone = false }: {
  position: [number, number]; height: number; color: string; cone?: boolean
}) {
  const radius = height > 1.3 ? 0.47 : 0.36
  return <group name="landscape-tree" position={[position[0], GROUND_Y, position[1]]}>
    <mesh position={[0, height * 0.275, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.045, 0.075, height * 0.55, 7]} />
      <meshStandardMaterial color="#A29987" roughness={0.95} />
    </mesh>
    <mesh position={[0, height * (cone ? 0.635 : 0.68), 0]}
      scale={cone ? [1, 1, 1] : [radius, height * 0.32, radius]} castShadow receiveShadow>
      {cone ? <coneGeometry args={[radius, height * 0.73, 7]} /> : <sphereGeometry args={[1, 8, 6]} />}
      <meshStandardMaterial color={color} roughness={0.92} flatShading />
    </mesh>
  </group>
}

function Lamp({ position, height }: { position: [number, number]; height: number }) {
  return <group name="landscape-lamp" position={[position[0], GROUND_Y, position[1]]}>
    <mesh position={[0, 0.03, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.11, 0.13, 0.06, 8]} />
      <meshStandardMaterial color="#8E9994" roughness={0.7} />
    </mesh>
    <mesh position={[0, (height - 0.12) / 2, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[0.027, 0.035, height - 0.12, 8]} />
      <meshStandardMaterial color="#7E8C85" roughness={0.55} metalness={0.15} />
    </mesh>
    <mesh position={[0, height - 0.085, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.18, 0.17, 0.18]} />
      <meshStandardMaterial color="#FFF8DF" emissive="#FFF0BD" emissiveIntensity={0.5} roughness={0.6} />
    </mesh>
    <mesh position={[0, height + 0.015, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.23, 0.03, 0.23]} />
      <meshStandardMaterial color="#7E8C85" roughness={0.65} />
    </mesh>
  </group>
}

export function EnvironmentProps({ size: [width, depth], center: [cx, cz] }: {
  size: [number, number]; center: [number, number]
}) {
  const x = width / 2
  const z = depth / 2
  const bushes = [
    [-width * 0.35, z + 1.22, 0.32],
    [width * 0.14, z + 1.21, 0.3],
    [width * 0.17, -z - 1.2, 0.36],
    [-x - 1.2, -depth * 0.28, 0.31],
    [-x - 1.2, depth * 0.33, 0.32],
    [x + 1.22, depth * 0.1, 0.3],
  ]
  return <group name="exterior-environment" position={[cx, 0, cz]}>
    <mesh name="landscape-ground" position={[0, GROUND_Y - 0.08, 0]} castShadow receiveShadow>
      <boxGeometry args={[width + 3.4, 0.16, depth + 3.4]} />
      <meshStandardMaterial color="#F0F4F1" roughness={0.95} />
    </mesh>

    {/* 承台填平原室内底座与外部地面之间的高度差。 */}
    <mesh name="landscape-foundation" position={[0, -0.24, 0]} castShadow receiveShadow>
      <boxGeometry args={[width + 0.4, 0.08, depth + 0.4]} />
      <meshStandardMaterial color="#e2e7e5" roughness={0.88} />
    </mesh>
    {/* The ring stays beyond the room plinth; the front spur meets it edge to edge. */}
    {[-1, 1].map(side => <group key={side}>
      <mesh name="landscape-path" position={[0, GROUND_Y + 0.018, side * (z + 0.55)]} castShadow receiveShadow>
        <boxGeometry args={[width + 2.1, 0.036, 0.4]} />
        <meshStandardMaterial color="#D9DFDC" roughness={0.98} />
      </mesh>
      <mesh name="landscape-path" position={[side * (x + 0.75), GROUND_Y + 0.018, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.4, 0.036, depth + 0.7]} />
        <meshStandardMaterial color="#D9DFDC" roughness={0.98} />
      </mesh>
    </group>)}
    <mesh name="landscape-path" position={[0, GROUND_Y + 0.018, z + 1.225]} castShadow receiveShadow>
      <boxGeometry args={[0.48, 0.036, 0.95]} />
      <meshStandardMaterial color="#D9DFDC" roughness={0.98} />
    </mesh>

    {/* 与前方纵向支路拼成十字路口，端面相接而非共面叠放。 */}
    {[-1, 1].map(side => <mesh key={`cross-${side}`} name="landscape-path"
      position={[side * 0.45, GROUND_Y + 0.018, z + 1.225]} castShadow receiveShadow>
      <boxGeometry args={[0.42, 0.036, 0.32]} />
      <meshStandardMaterial color="#D9DFDC" roughness={0.98} />
    </mesh>)}

    <Tree position={[-x - 1.05, -z - 1.06]} height={3.35} color="#9EB69C" />
    <Tree position={[x + 0.95, -z - 1.08]} height={1.62} color="#A8BDA5" cone />
    <Tree position={[-x - 1.13, -0.3]} height={1.48} color="#B3C8AD" />
    <Tree position={[-x - 1.02, z + 1.18]} height={0.94} color="#ABC3A5" cone />
    <Tree position={[x + 1.03, z + 1.17]} height={1.06} color="#9FB99D" />

    {bushes.map(([bx, bz, radius], index) => <mesh key={index} name="landscape-bush"
      position={[bx, GROUND_Y, bz]} scale={[radius, radius * 0.72, radius * 0.85]} castShadow receiveShadow>
      <sphereGeometry args={[1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
      <meshStandardMaterial color={index % 2 ? '#B8CBB0' : '#A9C1A6'} roughness={0.95} flatShading />
    </mesh>)}

    <Lamp position={[-width * 0.24, -z - 1.22]} height={1.22} />
    <Lamp position={[-x - 1.23, depth * 0.13]} height={1.05} />
    <Lamp position={[width * 0.34, z + 1.21]} height={0.88} />

    <group name="landscape-bench" position={[-width * 0.17, GROUND_Y, z + 1.2]}>
      {[-0.13, 0, 0.13].map(seatZ => <mesh key={seatZ} position={[0, 0.33, seatZ]} castShadow receiveShadow>
        <boxGeometry args={[1.16, 0.07, 0.11]} />
        <meshStandardMaterial color="#B8B5A7" roughness={0.9} />
      </mesh>)}
      <mesh position={[0, 0.52, -0.19]} castShadow receiveShadow>
        <boxGeometry args={[1.16, 0.17, 0.06]} />
        <meshStandardMaterial color="#B8B5A7" roughness={0.9} />
      </mesh>
      {[-0.44, 0.44].map(legX => <group key={legX}>
        {[-0.13, 0.13].map(legZ => <mesh key={legZ} position={[legX, 0.15, legZ]} castShadow receiveShadow>
          <boxGeometry args={[0.045, 0.3, 0.045]} />
          <meshStandardMaterial color="#89958D" roughness={0.72} metalness={0.12} />
        </mesh>)}
        <mesh position={[legX, 0.45, -0.19]} castShadow receiveShadow>
          <boxGeometry args={[0.04, 0.3, 0.04]} />
          <meshStandardMaterial color="#89958D" roughness={0.72} />
        </mesh>
      </group>)}
    </group>
  </group>
}
