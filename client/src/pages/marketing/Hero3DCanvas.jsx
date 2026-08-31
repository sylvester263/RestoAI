import { Suspense, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, useTexture, Float, Environment } from '@react-three/drei';
import whatsappChat from '../../assets/marketing/whatsapp-chat.webp';

// The screen face is a plane laid directly on top of the phone body rather
// than a texture on the RoundedBox itself — RoundedBox's UVs aren't suited
// to a single flat image per face.
function PhoneMesh({ reducedMotion }) {
  const texture = useTexture(whatsappChat);
  const groupRef = useRef();
  const { pointer } = useThree();

  // A full 360° spin periodically turns the screen edge-on or away from the
  // camera, killing legibility — sway gently around the front-facing pose
  // instead, per impl-26's "alive, not a spinning demo" instruction.
  useFrame((state) => {
    const group = groupRef.current;
    if (!group || reducedMotion) return;
    const sway = Math.sin(state.clock.elapsedTime * 0.35) * 0.35;
    const targetY = -0.3 + sway - pointer.x * 0.15;
    const targetX = 0.05 + pointer.y * 0.1;
    group.rotation.y += (targetY - group.rotation.y) * 0.04;
    group.rotation.x += (targetX - group.rotation.x) * 0.04;
  });

  const phone = (
    <group ref={groupRef} rotation={[0.05, -0.3, 0]}>
      <RoundedBox args={[2, 4.1, 0.22]} radius={0.18} smoothness={6}>
        <meshStandardMaterial color="#111318" roughness={0.35} metalness={0.4} />
      </RoundedBox>
      <mesh position={[0, 0, 0.115]}>
        <planeGeometry args={[1.82, 3.86]} />
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    </group>
  );

  // Float adds its own continuous animation loop — skip it entirely under
  // reduced motion rather than trying to zero out its internal speed.
  if (reducedMotion) return phone;
  return (
    <Float speed={1.4} rotationIntensity={0.15} floatIntensity={0.6}>
      {phone}
    </Float>
  );
}

export default function Hero3DCanvas({ reducedMotion }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 6.2], fov: 32 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.1} />
      <directionalLight position={[-4, -2, -3]} intensity={0.35} color="#8ab4ff" />
      <Suspense fallback={null}>
        <PhoneMesh reducedMotion={reducedMotion} />
        <Environment preset="city" />
      </Suspense>
    </Canvas>
  );
}
