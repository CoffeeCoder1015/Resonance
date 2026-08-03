import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { AgentState, VisualTheme } from '../types/voice';

interface AvatarCanvasProps {
  state: AgentState;
  visualTheme: VisualTheme;
  volume: number;
  frequencies: Uint8Array;
  onAvatarClick?: () => void;
  preview?: boolean;
  /**
   * Whether this surface is currently visible enough to warrant an animation
   * loop. The scene stays allocated while inactive so resuming never rebuilds
   * its WebGL resources.
   */
  active?: boolean;
}

interface NBody {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  mass: number;
}

interface MemphisItem {
  mesh: THREE.Mesh;
  baseAngle: number;
  baseRadius: number;
  orbitSpeed: number;
  phase: number;
  spinX: number;
  spinY: number;
}

interface FlowerPetal {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  phase: number;
  radialOffset: number;
  flap: number;
  sway: number;
  stretch: number;
}

export const AvatarCanvas: React.FC<AvatarCanvasProps> = ({
  state,
  visualTheme,
  volume,
  frequencies,
  onAvatarClick,
  preview = false,
  active = true
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startAnimationRef = useRef<() => void>(() => {});
  const stopAnimationRef = useRef<() => void>(() => {});

  // Seed 1: Ceramic Clay
  const clayMeshRef = useRef<THREE.Mesh | null>(null);
  const clayOrigPositionsRef = useRef<Float32Array | null>(null);

  // Seed 2: Candy Collider
  const nbodyGroupRef = useRef<THREE.Group | null>(null);
  const nbodyPhysicsRef = useRef<NBody[]>([]);

  // Seed 3: Memphis Bloom
  const memphisGroupRef = useRef<THREE.Group | null>(null);
  const memphisItemsRef = useRef<MemphisItem[]>([]);
  const memphisCoreRef = useRef<THREE.Group | null>(null);

  // Seed 4: Pop Art Comic Burst
  const comicBallRef = useRef<THREE.Group | null>(null);
  const comicBurstARef = useRef<THREE.Group | null>(null);
  const comicBurstBRef = useRef<THREE.Group | null>(null);
  // Envelope-following motion state (kills the strobing spin)
  const comicMotionRef = useRef({ speedA: 0.0015, speedB: -0.0018, scale: 1, squash: 0 });

  // Seed 5: Superflat Smiling Flower
  const flowerRootRef = useRef<THREE.Group | null>(null);
  const flowerPetalsRef = useRef<FlowerPetal[]>([]);
  const flowerFaceRef = useRef<THREE.Mesh | null>(null);

  // Seed 6: Voxel Pulse Shell
  const voxelMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const voxelGroupRef = useRef<THREE.Group | null>(null);
  const voxelDataRef = useRef<{ dirs: Float32Array; count: number } | null>(null);

  // Live-signal refs (the render loop mounts once and reads through these)
  const smoothVolRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const stateRef = useRef<AgentState>(state);
  stateRef.current = state;
  const themeRef = useRef<VisualTheme>(visualTheme);
  themeRef.current = visualTheme;
  const freqsRef = useRef<Uint8Array>(frequencies);
  freqsRef.current = frequencies;
  const volumeRef = useRef<number>(volume);
  volumeRef.current = volume;
  const activeRef = useRef<boolean>(active);
  activeRef.current = active;

  // This effect only starts or cancels an existing loop. Scene construction
  // belongs to the mount effect below, so toggling activity never churns GPU
  // resources or discards live audio/state refs.
  useEffect(() => {
    if (active) startAnimationRef.current();
    else stopAnimationRef.current();
  }, [active]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    // ---------- Scene & Camera ----------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000);
    camera.position.z = preview ? 12 : 15;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1.15;
    rendererRef.current = renderer;

    while (mount.firstChild) mount.removeChild(mount.firstChild);
    mount.appendChild(renderer.domElement);

    // ---------- Sunny Studio Lighting ----------
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(-6, 8, 7);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xff90e8, 1.5);
    rimLight.position.set(6, -6, -4);
    scene.add(rimLight);

    const fillLight = new THREE.PointLight(0x40c9ff, 1.6, 18);
    fillLight.position.set(0, -3, 6);
    scene.add(fillLight);

    // ---------- Comic cel-band gradient map (3-tone) ----------
    const gradientMap = new THREE.DataTexture(new Uint8Array([90, 175, 255]), 3, 1, THREE.RedFormat);
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.needsUpdate = true;

    const makeOutlineMesh = (geo: THREE.BufferGeometry, scale: number) => {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
      mesh.scale.setScalar(scale);
      return mesh;
    };

    // =========================================================
    // SEED 1 — 3D BOUNCY CERAMIC CLAY BLOB
    // =========================================================
    const clayGeo = new THREE.SphereGeometry(2.35, 80, 80);
    const clayMesh = new THREE.Mesh(
      clayGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0xff69b4,
        emissive: 0x2d0014,
        metalness: 0.05,
        roughness: 0.55,
        clearcoat: 0.35,
        clearcoatRoughness: 0.2,
        reflectivity: 0.4
      })
    );
    clayMesh.scale.setScalar(0.86);
    scene.add(clayMesh);
    clayMeshRef.current = clayMesh;
    clayOrigPositionsRef.current = clayGeo.attributes.position.array.slice() as Float32Array;

    // =========================================================
    // SEED 2 — 3D POP TOY CANDY COLLIDER
    // =========================================================
    const nbodyGroup = new THREE.Group();
    const nbodyList: NBody[] = [];
    const candyColors = [0xff3b30, 0xffcc00, 0x00c7be, 0x5856d6, 0xff2d55];

    for (let i = 0; i < 110; i++) {
      const size = Math.random() * 0.22 + 0.08;
      const sMesh = new THREE.Mesh(
        new THREE.SphereGeometry(size, 24, 24),
        new THREE.MeshPhysicalMaterial({
          color: candyColors[i % candyColors.length],
          metalness: 0.1,
          roughness: 0.15,
          clearcoat: 0.9,
          clearcoatRoughness: 0.08,
          reflectivity: 0.9
        })
      );
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 1.2 + Math.random() * 2.1;
      const pos = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi)
      );
      sMesh.position.copy(pos);
      nbodyGroup.add(sMesh);
      nbodyList.push({
        mesh: sMesh,
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04, (Math.random() - 0.5) * 0.04),
        mass: size * 10
      });
    }
    scene.add(nbodyGroup);
    nbodyGroupRef.current = nbodyGroup;
    nbodyPhysicsRef.current = nbodyList;

    // =========================================================
    // SEED 3 — 3D MEMPHIS GEOMETRIC BLOOM
    // =========================================================
    const memphisGroup = new THREE.Group();
    const coreGroup = new THREE.Group();
    coreGroup.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 48, 48),
        new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.18, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 })
      )
    );
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.11, 20, 80),
      new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.3, metalness: 0.05 })
    );
    halo.rotation.x = Math.PI / 2.4;
    coreGroup.add(halo);
    scene.add(coreGroup);
    memphisCoreRef.current = coreGroup;

    const memphisGeos: THREE.BufferGeometry[] = [
      new THREE.ConeGeometry(0.55, 1.15, 28),
      new THREE.BoxGeometry(0.85, 0.85, 0.85),
      new THREE.TorusGeometry(0.5, 0.2, 18, 60),
      new THREE.TetrahedronGeometry(0.7),
      new THREE.CylinderGeometry(0.38, 0.38, 1.0, 28),
      new THREE.TorusKnotGeometry(0.42, 0.16, 72, 10),
      new THREE.SphereGeometry(0.55, 32, 32),
      new THREE.ConeGeometry(0.45, 0.95, 4),
      new THREE.BoxGeometry(0.6, 1.1, 0.6),
      new THREE.OctahedronGeometry(0.6)
    ];
    const memphisPalette = [0xe63946, 0xffd60a, 0x1d3557, 0x111111, 0xf8f9fa, 0xff006e, 0x457b9d, 0xffd60a, 0xe63946, 0x111111];

    const memItems: MemphisItem[] = [];
    memphisGeos.forEach((geo, idx) => {
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: memphisPalette[idx % memphisPalette.length], roughness: 0.35, metalness: 0.05 })
      );
      memphisGroup.add(mesh);
      memItems.push({
        mesh,
        baseAngle: (idx / memphisGeos.length) * Math.PI * 2,
        baseRadius: 2.7 + (idx % 3) * 0.35,
        orbitSpeed: (idx % 2 === 0 ? 1 : -1) * (0.14 + (idx % 4) * 0.05),
        phase: Math.random() * Math.PI * 2,
        spinX: 0.008 + Math.random() * 0.02,
        spinY: 0.01 + Math.random() * 0.022
      });
    });
    scene.add(memphisGroup);
    memphisGroupRef.current = memphisGroup;
    memphisItemsRef.current = memItems;

    // =========================================================
    // SEED 4 — 3D POP ART COMIC BURST (envelope-driven motion)
    // =========================================================
    const makeBurstGeo = (spikes: number, outer: number, inner: number) => {
      const shape = new THREE.Shape();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (i / (spikes * 2)) * Math.PI * 2;
        if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.4,
        bevelEnabled: true,
        bevelThickness: 0.1,
        bevelSize: 0.09,
        bevelSegments: 4 // crisper silhouette, less smear in motion
      });
      geo.center();
      return geo;
    };

    const burstBGeo = makeBurstGeo(10, 3.3, 2.2);
    const burstBGroup = new THREE.Group();
    burstBGroup.add(new THREE.Mesh(burstBGeo, new THREE.MeshToonMaterial({ color: 0xf8f9fa, gradientMap })));
    burstBGroup.add(makeOutlineMesh(burstBGeo, 1.06));
    burstBGroup.position.z = -0.35;
    scene.add(burstBGroup);
    comicBurstBRef.current = burstBGroup;

    const burstAGeo = makeBurstGeo(12, 2.85, 1.95);
    const burstAGroup = new THREE.Group();
    burstAGroup.add(new THREE.Mesh(burstAGeo, new THREE.MeshToonMaterial({ color: 0xe63946, gradientMap })));
    burstAGroup.add(makeOutlineMesh(burstAGeo, 1.06));
    burstAGroup.position.z = 0.05;
    scene.add(burstAGroup);
    comicBurstARef.current = burstAGroup;

    const ballGroup = new THREE.Group();
    const ballGeo = new THREE.SphereGeometry(1.35, 48, 48);
    ballGroup.add(new THREE.Mesh(ballGeo, new THREE.MeshToonMaterial({ color: 0xffd60a, gradientMap })));
    ballGroup.add(makeOutlineMesh(ballGeo, 1.07));
    ballGroup.position.z = 0.55;
    scene.add(ballGroup);
    comicBallRef.current = ballGroup;

    // =========================================================
    // SEED 5 — 3D SUPERFLAT SMILING FLOWER (Murakami)
    // Flat rainbow petals, zero shading, radial balance, kawaii face
    // =========================================================
    const flowerRoot = new THREE.Group();
    const petalPalette = [0xff006e, 0xffbe0b, 0xfb5607, 0x8338ec, 0x3a86ff, 0x06d6a0];
    const petals: FlowerPetal[] = [];

    for (let i = 0; i < 12; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.z = (i / 12) * Math.PI * 2;

      const petal = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 24, 24),
        // Fully unlit flat color = authentic Superflat uniformity
        new THREE.MeshBasicMaterial({ color: petalPalette[i % petalPalette.length] })
      );
      petal.scale.set(0.78, 1.5, 0.42);
      petal.position.y = 1.72;
      pivot.add(petal);
      flowerRoot.add(pivot);
      petals.push({
        pivot,
        mesh: petal,
        phase: (i / 12) * Math.PI * 2,
        radialOffset: 0,
        flap: 0,
        sway: 0,
        stretch: 0
      });
    }

    // Smiling kawaii face
    const face = new THREE.Mesh(
      new THREE.SphereGeometry(1.02, 48, 48),
      new THREE.MeshStandardMaterial({ color: 0xffd60a, roughness: 0.6, metalness: 0 })
    );
    flowerRoot.add(face);
    flowerFaceRef.current = face;

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 20), eyeMat);
    eyeL.position.set(-0.34, 0.24, 0.94);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 20), eyeMat);
    eyeR.position.set(0.34, 0.24, 0.94);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.085, 12, 28, Math.PI), eyeMat);
    smile.rotation.z = Math.PI; // lower-half arc = U-shaped grin
    smile.position.set(0, -0.12, 0.94);
    flowerRoot.add(eyeL, eyeR, smile);

    scene.add(flowerRoot);
    flowerRootRef.current = flowerRoot;
    flowerPetalsRef.current = petals;

    // =========================================================
    // SEED 6 — 3D VOXEL PULSE SHELL
    // Chunky cubes, quantized 5-color neobrutalist palette, traveling waves
    // =========================================================
    const voxelCount = 240;
    const voxelGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
    const voxelMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 });
    const voxelMesh = new THREE.InstancedMesh(voxelGeo, voxelMat, voxelCount);

    const voxelPalette = [0x111111, 0xf8f9fa, 0xe63946, 0xffd60a, 0x1d3557];
    const dirs = new Float32Array(voxelCount * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    const tmpColor = new THREE.Color();

    for (let i = 0; i < voxelCount; i++) {
      const y = 1 - (i / (voxelCount - 1)) * 2;
      const rad = Math.sqrt(1 - y * y);
      const theta = golden * i;
      dirs[i * 3] = Math.cos(theta) * rad;
      dirs[i * 3 + 1] = y;
      dirs[i * 3 + 2] = Math.sin(theta) * rad;

      tmpColor.setHex(voxelPalette[i % voxelPalette.length]);
      voxelMesh.setColorAt(i, tmpColor);
    }
    if (voxelMesh.instanceColor) voxelMesh.instanceColor.needsUpdate = true;

    const voxelGroup = new THREE.Group();
    voxelGroup.add(voxelMesh);
    scene.add(voxelGroup);
    voxelMeshRef.current = voxelMesh;
    voxelGroupRef.current = voxelGroup;
    voxelDataRef.current = { dirs, count: voxelCount };

    // ---------- Responsive camera ----------
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      cameraRef.current.aspect = w / h;
      cameraRef.current.position.z = preview ? 12 : h < 320 ? 17 : w < 640 ? 16.5 : 15;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);
    handleResize();

    // Reusable temps for the voxel loop
    const tmpMat = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    const upVec = new THREE.Vector3(0, 1, 0);
    const dirVec = new THREE.Vector3();

    let disposed = false;
    let isAnimating = false;

    const stopAnimation = () => {
      if (!isAnimating) return;
      isAnimating = false;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    // ---------- 60FPS Animation Loop ----------
    const animate = () => {
      animationFrameRef.current = null;
      if (disposed) {
        isAnimating = false;
        return;
      }

      timeRef.current += 0.016;
      const t = timeRef.current;
      const activeTheme = themeRef.current;
      const activeState = stateRef.current;
      const freqs = freqsRef.current;

      smoothVolRef.current = smoothVolRef.current * 0.82 + volumeRef.current * 0.18;
      const vol = smoothVolRef.current;

      let fSum = 0;
      for (let i = 0; i < Math.min(24, freqs.length); i++) fSum += freqs[i];
      const fAvg = fSum / (Math.min(24, freqs.length) * 255);

      const isListening = activeState === 'listening';
      const isSpeaking = activeState === 'speaking';
      const isBurst = isListening || isSpeaking;

      // Visibility toggles
      if (clayMeshRef.current) clayMeshRef.current.visible = activeTheme === 'clay-blob';
      if (nbodyGroupRef.current) nbodyGroupRef.current.visible = activeTheme === 'toy-collider';
      if (memphisGroupRef.current) memphisGroupRef.current.visible = activeTheme === 'memphis-bloom';
      if (memphisCoreRef.current) memphisCoreRef.current.visible = activeTheme === 'memphis-bloom';
      if (comicBallRef.current) comicBallRef.current.visible = activeTheme === 'comic-burst';
      if (comicBurstARef.current) comicBurstARef.current.visible = activeTheme === 'comic-burst';
      if (comicBurstBRef.current) comicBurstBRef.current.visible = activeTheme === 'comic-burst';
      if (flowerRootRef.current) flowerRootRef.current.visible = activeTheme === 'superflat-bloom';
      if (voxelGroupRef.current) voxelGroupRef.current.visible = activeTheme === 'voxel-pulse';

      // Theme-aware camera fit — generous safe frame, portrait pulls back further.
      if (cameraRef.current) {
        const baseZ =
          activeTheme === 'clay-blob' ? 14.8 :
          activeTheme === 'toy-collider' ? 14.8 :
          activeTheme === 'memphis-bloom' ? 15.8 :
          activeTheme === 'comic-burst' ? 15.6 :
          activeTheme === 'superflat-bloom' ? 15.2 :
          15.0;
        const aspect = cameraRef.current.aspect || 1;
        const framedZ = preview ? baseZ * 0.8 : baseZ;
        const targetZ = aspect < 1 ? Math.min(framedZ * (1 + (1 - aspect) * 1.4), framedZ * 2) : framedZ;
        cameraRef.current.position.z += (targetZ - cameraRef.current.position.z) * 0.05;
      }

      // --- SEED 1: CERAMIC CLAY BLOB ---
      if (activeTheme === 'clay-blob' && clayMeshRef.current && clayOrigPositionsRef.current) {
        const mesh = clayMeshRef.current;
        const posAttr = mesh.geometry.attributes.position;
        const origPos = clayOrigPositionsRef.current;

        mesh.rotation.y = t * 0.25;
        mesh.rotation.x = Math.sin(t * 0.4) * 0.2;

        for (let i = 0; i < posAttr.count; i++) {
          const ox = origPos[i * 3];
          const oy = origPos[i * 3 + 1];
          const oz = origPos[i * 3 + 2];
          const length = Math.sqrt(ox * ox + oy * oy + oz * oz);
          const nx = ox / length;
          const ny = oy / length;
          const nz = oz / length;

          let knob = 0;
          if (isBurst) {
            const fIdx = Math.floor(Math.abs(ny) * Math.min(26, freqs.length));
            const fVal = (freqs[fIdx] || 0) / 255;
            knob = Math.pow(Math.sin(nx * 5 + t * 5) * Math.cos(nz * 5 - t * 4), 2) * (fVal * 0.95 + vol * 0.5);
          } else if (activeState === 'processing') {
            knob = Math.sin(nx * 4 + t * 6) * Math.cos(ny * 4 - t * 6) * 0.25;
          } else {
            knob = Math.sin(nx * 3 + t * 1.6) * Math.cos(nz * 3 + t * 1.6) * 0.08;
          }

          const newLen = length + knob;
          posAttr.setXYZ(i, nx * newLen, ny * newLen, nz * newLen);
        }
        posAttr.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }

      // --- SEED 2: POP TOY CANDY COLLIDER ---
      else if (activeTheme === 'toy-collider' && nbodyGroupRef.current && nbodyPhysicsRef.current) {
        const bodies = nbodyPhysicsRef.current;
        nbodyGroupRef.current.rotation.y = t * 0.15;
        nbodyGroupRef.current.rotation.z = Math.sin(t * 0.3) * 0.1;

        const springK = isListening ? 0.052 : isSpeaking ? 0.046 : 0.062;
        const damping = isListening ? 0.9 : isSpeaking ? 0.88 : 0.86;
        const maxRadius = isListening ? 4.55 : isSpeaking ? 4.0 : 3.65;

        for (let i = 0; i < bodies.length; i++) {
          const b1 = bodies[i];
          const distToCenter = b1.pos.length() || 0.1;
          const outwardNormal = b1.pos.clone().normalize();

          b1.vel.addScaledVector(b1.pos, -springK);

          if (isBurst) {
            const fIdx = i % Math.min(30, freqs.length);
            const fVal = (freqs[fIdx] || 0) / 255;
            const force = isListening ? fVal * (0.12 + vol * 0.34) : fVal * (0.06 + vol * 0.16);
            b1.vel.addScaledVector(outwardNormal, force);
          }

          for (let j = i + 1; j < bodies.length; j++) {
            const b2 = bodies[j];
            const diff = b1.pos.clone().sub(b2.pos);
            const dist = diff.length();
            if (dist < 0.65) {
              const push = diff.normalize().multiplyScalar((0.65 - dist) * 0.05);
              b1.vel.add(push);
              b2.vel.sub(push);
            }
          }

          if (distToCenter > maxRadius) {
            const outwardSpeed = Math.max(0, b1.vel.dot(outwardNormal));
            b1.vel.addScaledVector(outwardNormal, -(distToCenter - maxRadius) * 0.2 - outwardSpeed * 0.75);
          }

          b1.vel.multiplyScalar(damping);
          b1.pos.add(b1.vel);

          if (b1.pos.length() > 6.2) {
            b1.pos.setLength(maxRadius);
            b1.vel.multiplyScalar(0.18);
          }

          b1.mesh.position.copy(b1.pos);
        }
      }

      // --- SEED 3: MEMPHIS GEOMETRIC BLOOM ---
      else if (activeTheme === 'memphis-bloom' && memphisGroupRef.current && memphisCoreRef.current) {
        const items = memphisItemsRef.current;
        const core = memphisCoreRef.current;

        memphisGroup.rotation.y = t * 0.12;
        core.rotation.y = t * 0.4;
        core.children[1].rotation.z = t * 0.8;
        core.scale.setScalar(1 + (isBurst ? vol * 0.25 + fAvg * 0.15 : Math.sin(t * 1.5) * 0.03));

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const fIdx = (i * 3) % Math.min(30, freqs.length);
          const fVal = (freqs[fIdx] || 0) / 255;

          const r = it.baseRadius + (isBurst ? vol * 1.3 + fVal * 0.6 : 0) + Math.sin(t * 1.5 + it.phase) * 0.18;
          const angle = it.baseAngle + t * it.orbitSpeed * (isBurst ? 1.6 : 1);

          it.mesh.position.set(Math.cos(angle) * r, Math.sin(angle) * r, Math.sin(t * 1.1 + it.phase) * 0.8);

          const spinMult = isBurst ? 2.2 + vol * 3 : 1;
          it.mesh.rotation.x += it.spinX * spinMult;
          it.mesh.rotation.y += it.spinY * spinMult;
          it.mesh.scale.setScalar(1 + (isBurst ? fVal * 0.3 : 0));
        }
      }

      // --- SEED 4: POP ART COMIC BURST (redesigned motion) ---
      // Rotation speed now *follows the smoothed audio envelope* instead of
      // accumulating a constant spin — bursts read as impact kicks, not a fan.
      else if (activeTheme === 'comic-burst' && comicBallRef.current && comicBurstARef.current && comicBurstBRef.current) {
        const ball = comicBallRef.current;
        const burstA = comicBurstARef.current;
        const burstB = comicBurstBRef.current;
        const m = comicMotionRef.current;

        const targetSpeedA = 0.0012 + (isBurst ? fAvg * vol * 0.028 : 0);
        const targetSpeedB = -(0.0015 + (isBurst ? fAvg * vol * 0.034 : 0));
        m.speedA += (targetSpeedA - m.speedA) * 0.12;
        m.speedB += (targetSpeedB - m.speedB) * 0.12;
        burstA.rotation.z += m.speedA;
        burstB.rotation.z += m.speedB;

        const targetScale = 1 + (isBurst ? vol * 0.16 + fAvg * 0.1 : 0);
        m.scale += (targetScale - m.scale) * 0.12;
        burstA.scale.setScalar(m.scale);
        burstB.scale.setScalar(m.scale * 0.88);

        const targetSquash = isBurst ? vol * 0.45 + fAvg * 0.3 : 0;
        m.squash += (targetSquash - m.squash) * 0.14;
        ball.scale.set(1 + m.squash * 0.1, 1 - m.squash * 0.09, 1);
        ball.rotation.z = Math.sin(t * 1.2) * 0.04;
        ball.position.y = Math.sin(t * 1.8) * 0.06;
      }

      // --- SEED 5: SUPERFLAT SMILING FLOWER ---
      else if (activeTheme === 'superflat-bloom' && flowerRootRef.current && flowerPetalsRef.current) {
        const root = flowerRootRef.current;
        const petalsArr = flowerPetalsRef.current;

        // Restore the original free-spinning-in-space character: a continuous
        // carousel spin paired with a slow 3D turn. The face itself stays at a
        // fixed scale so dialogue no longer makes it pulse smaller.
        root.rotation.x = 0;
        root.rotation.y = Math.sin(t * 0.5) * 0.16;
        root.rotation.z += isBurst ? 0.0022 + vol * 0.0035 : 0.0011;
        root.scale.setScalar(1);

        for (let i = 0; i < petalsArr.length; i++) {
          const p = petalsArr[i];
          const frequencyBandCount = Math.min(24, freqs.length);
          const fIdx = frequencyBandCount > 0 ? (i * 3) % frequencyBandCount : 0;
          const fVal = (freqs[fIdx] || 0) / 255;
          const idleWave = Math.sin(t * 0.9 + p.phase * 1.7);
          const dialogueRate = isSpeaking ? 4.8 : 2.6;
          const dialogueWave = Math.sin(t * dialogueRate - p.phase * 1.35);
          const bandEnergy = THREE.MathUtils.clamp(vol * 0.65 + fVal * 0.7, 0, 1);
          const activity =
            isSpeaking ? THREE.MathUtils.clamp(0.3 + bandEnergy * 0.85, 0, 1) :
            isListening ? THREE.MathUtils.clamp(0.14 + bandEnergy * 0.55, 0, 0.62) :
            activeState === 'processing' ? 0.2 :
            0;

          const targetRadial =
            idleWave * 0.025 +
            activity * (0.09 + Math.max(0, dialogueWave) * 0.23);
          const targetFlap =
            -0.018 -
            activity * (0.1 + (dialogueWave + 1) * (isSpeaking ? 0.15 : 0.075));
          const targetSway =
            idleWave * 0.018 +
            dialogueWave * activity * (isSpeaking ? 0.14 : 0.065);
          const targetStretch =
            activity * (0.025 + Math.max(0, dialogueWave) * 0.085);

          // Slightly different response rates create follow-through instead of
          // twelve petals snapping in mechanical unison.
          const response = 0.09 + (i % 4) * 0.012;
          p.radialOffset = THREE.MathUtils.lerp(p.radialOffset, targetRadial, response);
          p.flap = THREE.MathUtils.lerp(p.flap, targetFlap, response * 0.86);
          p.sway = THREE.MathUtils.lerp(p.sway, targetSway, response * 0.78);
          p.stretch = THREE.MathUtils.lerp(p.stretch, targetStretch, response * 0.72);

          p.pivot.rotation.z = p.phase + p.sway;
          p.pivot.rotation.x = p.flap;
          p.mesh.position.y = 1.72 + p.radialOffset;
          p.mesh.scale.set(
            0.78 * (1 - p.stretch * 0.18),
            1.5 * (1 + p.stretch),
            0.42
          );
        }

        if (flowerFaceRef.current) {
          flowerFaceRef.current.scale.setScalar(1);
          flowerFaceRef.current.position.set(0, 0, 0);
          flowerFaceRef.current.rotation.set(0, 0, 0);
        }
      }

      // --- SEED 6: VOXEL PULSE SHELL ---
      else if (activeTheme === 'voxel-pulse' && voxelMeshRef.current && voxelGroupRef.current && voxelDataRef.current) {
        const mesh = voxelMeshRef.current;
        const group = voxelGroupRef.current;
        const { dirs: d, count } = voxelDataRef.current;

        group.rotation.y = t * (isBurst ? 0.28 : 0.1);
        group.rotation.x = Math.sin(t * 0.4) * 0.12;

        const amp = isBurst ? 0.5 + vol * 0.7 : 0.12;

        for (let i = 0; i < count; i++) {
          const dx = d[i * 3];
          const dy = d[i * 3 + 1];
          const dz = d[i * 3 + 2];
          const az = Math.atan2(dz, dx);

          const fIdx = Math.floor(((az + Math.PI) / (Math.PI * 2)) * Math.min(24, freqs.length));
          const fVal = (freqs[fIdx] || 0) / 255;

          // Traveling wave around the shell + vertical band
          const wave = Math.sin(az * 3 + dy * 2.4 - t * 5);
          const pulse = Math.max(0, wave) * amp * (isBurst ? 0.4 + fVal * 0.8 : 0.5);

          const radius = 2.25 + pulse * 0.32 + (isBurst ? vol * 0.12 : 0);
          tmpPos.set(dx * radius, dy * radius, dz * radius);

          dirVec.set(dx, dy, dz);
          tmpQuat.setFromUnitVectors(upVec, dirVec);

          const s = 0.8 + pulse * 0.55;
          tmpScale.set(s, s, s);

          tmpMat.compose(tmpPos, tmpQuat, tmpScale);
          mesh.setMatrixAt(i, tmpMat);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }

      renderer.render(scene, camera);
      if (activeRef.current && !disposed) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        isAnimating = false;
      }
    };

    const startAnimation = () => {
      if (disposed || isAnimating) return;
      isAnimating = true;
      animate();
    };

    startAnimationRef.current = startAnimation;
    stopAnimationRef.current = stopAnimation;
    startAnimation();

    return () => {
      disposed = true;
      stopAnimation();
      startAnimationRef.current = () => {};
      stopAnimationRef.current = () => {};
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();

      const disposedTextures = new Set<THREE.Texture>();
      const disposeMaterial = (material: THREE.Material) => {
        Object.values(material).forEach(value => {
          if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose();
          }
        });
        material.dispose();
      };

      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry?.dispose();
          if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
          else disposeMaterial(object.material);
        }
      });
      gradientMap.dispose();

      if (rendererRef.current && rendererRef.current.domElement) {
        try { mount.removeChild(rendererRef.current.domElement); } catch (e) {}
        rendererRef.current.renderLists.dispose();
        rendererRef.current.dispose();
        rendererRef.current.forceContextLoss();
        rendererRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      className={`relative w-full h-full flex items-center justify-center select-none overflow-hidden ${
        onAvatarClick ? 'cursor-pointer' : 'cursor-default'
      }`}
      onClick={onAvatarClick}
      title={onAvatarClick ? 'Tap vibrant avatar to toggle acoustic listening' : 'Live avatar preview'}
    />
  );
};
