'use client'

import RippleGrid from './RippleGrid'

export default function AppBackground() {
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'fixed', top: 0, left: 0, zIndex: -1 }}>
      <RippleGrid
        enableRainbow={false}
        gridColor="#1e602d"
        rippleIntensity={0.02}
        gridSize={12}
        gridThickness={50}
        fadeDistance={5}
        vignetteStrength={0.5}
        glowIntensity={0.3}
        opacity={0.85}
        gridRotation={0}
        mouseInteraction={false}
        mouseInteractionRadius={0.9}
      />
    </div>
  )
}
