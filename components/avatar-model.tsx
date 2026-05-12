"use client";

import * as THREE from "three";

type AvatarModelProps = {
  visible: boolean;
  scale?: number;
  position?: [number, number, number];
};

export function AvatarModel({ visible, scale = 1, position = [0, 0, 0] }: AvatarModelProps) {
  // For now, create a simple parametric body shape using Three.js primitives
  // This is a placeholder until we can integrate a proper body model
  
  if (!visible) return null;

  return (
    <group position={position} scale={scale}>
      {/* Torso */}
      <mesh position={[0, 0.6, 0]}>
        <capsuleGeometry args={[0.2, 0.6, 8, 16]} />
        <meshStandardMaterial 
          color="#e8d4c0" 
          transparent 
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      
      {/* Head */}
      <mesh position={[0, 1.15, 0]}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial 
          color="#e8d4c0" 
          transparent 
          opacity={0.3}
        />
      </mesh>
      
      {/* Left arm */}
      <mesh position={[-0.25, 0.7, 0]} rotation={[0, 0, Math.PI / 6]}>
        <capsuleGeometry args={[0.05, 0.5, 8, 16]} />
        <meshStandardMaterial 
          color="#e8d4c0" 
          transparent 
          opacity={0.3}
        />
      </mesh>
      
      {/* Right arm */}
      <mesh position={[0.25, 0.7, 0]} rotation={[0, 0, -Math.PI / 6]}>
        <capsuleGeometry args={[0.05, 0.5, 8, 16]} />
        <meshStandardMaterial 
          color="#e8d4c0" 
          transparent 
          opacity={0.3}
        />
      </mesh>
      
      {/* Left leg */}
      <mesh position={[-0.1, 0.05, 0]}>
        <capsuleGeometry args={[0.08, 0.6, 8, 16]} />
        <meshStandardMaterial 
          color="#e8d4c0" 
          transparent 
          opacity={0.3}
        />
      </mesh>
      
      {/* Right leg */}
      <mesh position={[0.1, 0.05, 0]}>
        <capsuleGeometry args={[0.08, 0.6, 8, 16]} />
        <meshStandardMaterial 
          color="#e8d4c0" 
          transparent 
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}
