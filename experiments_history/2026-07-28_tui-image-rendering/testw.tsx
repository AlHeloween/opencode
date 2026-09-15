import { createTuiApp, Box, Text } from '@opentui/react';
import { ThreeRenderable, SuperSampleType } from '@opentui/three';
import { Scene, PerspectiveCamera, BoxGeometry, MeshBasicMaterial, Mesh, WebGPURenderer } from 'three';
import process from 'node:process';

async function main() {
  // 1. Detect if the user is running WezTerm
  const isWezTerm = process.env.TERM_PROGRAM === 'WezTerm';
  
  // Choose optimal sampling based on WezTerm availability (fallback if standard CMD)
  const chosenSample = isWezTerm ? SuperSampleType.BRAILLE : SuperSampleType.HALF_BLOCK;

  // 2. Initialize Three.js Environment
  const scene = new Scene();
  const camera = new PerspectiveCamera(75, 1, 0.1, 1000);
  const renderer = new WebGPURenderer();
  await renderer.init();

  // Create a 3D mesh player asset
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial({ color: 0x00ffcc, wireframe: isWezTerm }); 
  const cube = new Mesh(geometry, material);
  scene.add(cube);
  camera.position.z = 3;

  // 3. Mount to OpenTUI Bridge
  const three3DPlayer = new ThreeRenderable({
    renderer,
    scene,
    camera,
    superSample: chosenSample
  });

  // 4. Create the TUI Application Structure
  const app = createTuiApp(() => {
    return (
      <Box width="100%" height="100%" flexDirection="column" backgroundColor="#1a1a1a">
        {/* Header Bar */}
        <Box width="100%" height={3} backgroundColor="#2d2d2d" padding={1}>
          <Text style={{ bold: true, color: '#ffffff' }}>
            🛸 WezTerm 3D Mesh Player {isWezTerm ? "[Kitty Protocol Active]" : "[Legacy Mode]"}
          </Text>
        </Box>

        {/* The Viewport Container */}
        <Box flexGrow={1} style={{ justifyContent: 'center', alignItems: 'center' }}>
          <three3DPlayer.Component />
        </Box>

        {/* Footer controls */}
        <Box width="100%" height={2} paddingLeft={1}>
          <Text style={{ color: '#888888' }}>Controls: Hold [A/D] to Rotate Cam | [Q] to Quit</Text>
        </Box>
      </Box>
    );
  });

  // 5. Active Keyboard Hold/Release Listeners via WezTerm Terminal hooks
  let rotationSpeed = 0;

  app.on('keydown', (event) => {
    if (event.key === 'a') rotationSpeed = -0.05;
    if (event.key === 'd') rotationSpeed = 0.05;
    if (event.key === 'q') process.exit(0);
  });

  // Thanks to WezTerm supporting the Kitty Protocol, this release trigger fires instantly!
  app.on('keyup', (event) => {
    if (event.key === 'a' || event.key === 'd') {
      rotationSpeed = 0; // Stop rotating the player instantly when key is lifted
    }
  });

  // 6. Game/Player Render Tick Loop
  function tick() {
    cube.rotation.y += 0.01;      // Idle spin
    camera.rotation.y += rotationSpeed; // Manual control spin
    
    app.requestUpdate(); // Tells OpenTUI to repaint the tree
    setTimeout(tick, 16); // Target ~60 FPS
  }

  tick();
}

main().catch(console.error);
