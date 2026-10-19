import type { AgentState, OfficeAgent } from "@avo/shared";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Kantor isometrik. Semua bentuk dibuat dari primitif (tanpa file model/tekstur) supaya ringan
// dan tidak perlu unduhan tambahan. Dimuat lazy dari Office.tsx.

const COLS = 4;
const GAP_X = 2.6;
const GAP_Z = 3.0;

const STATE_COLOR: Record<AgentState, string> = {
  idle: "#8b95a8",
  working: "#4f6bff",
  waiting: "#f5b83d",
  paused: "#6b7385",
  error: "#e5484d",
};

const ROLE: Record<string, { short: string; shirt: string }> = {
  manager: { short: "Manager", shirt: "#7c5cff" },
  analyst: { short: "Analyst", shirt: "#2fa8a0" },
  architect: { short: "Architect", shirt: "#d9822b" },
  designer: { short: "Designer", shirt: "#d94f8a" },
  frontend: { short: "Frontend", shirt: "#3b82f6" },
  backend: { short: "Backend", shirt: "#4caf50" },
  qa: { short: "QA", shirt: "#c9a227" },
  devops: { short: "DevOps", shirt: "#5b6577" },
};

const slot = (i: number): [number, number, number] => [
  ((i % COLS) - (COLS - 1) / 2) * GAP_X,
  0,
  (Math.floor(i / COLS) - 0.5) * GAP_Z,
];

function makeLabel(text: string, dark: boolean) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = dark ? "rgba(21,28,44,0.92)" : "rgba(255,255,255,0.94)";
    g.beginPath();
    g.roundRect(4, 8, 248, 48, 24);
    g.fill();
    g.fillStyle = dark ? "#e8ecf6" : "#111827";
    g.font = "600 28px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 33);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface DeskProps {
  agent: OfficeAgent;
  index: number;
  dark: boolean;
  reduced: boolean;
  onSelect: (id: string) => void;
}

function AgentDesk({ agent, index, dark, reduced, onSelect }: DeskProps) {
  const role = ROLE[agent.id] ?? { short: agent.id, shirt: "#5b6577" };
  const state = agent.state;
  const color = STATE_COLOR[state];
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Mesh>(null);

  const label = useMemo(() => makeLabel(role.short, dark), [role.short, dark]);
  useEffect(() => () => label.dispose(), [label]);

  useFrame(({ clock }) => {
    if (reduced || !body.current || !head.current || !armL.current || !armR.current) return;
    const t = clock.elapsedTime + index * 0.7;
    let bob = 0;
    let armA = -1.0;
    let armB = -1.0;
    let tilt = 0;
    let shake = 0;
    if (state === "working") {
      bob = Math.sin(t * 7) * 0.02;
      armA = -1.0 + Math.sin(t * 14) * 0.25;
      armB = -1.0 + Math.sin(t * 14 + Math.PI) * 0.25;
    } else if (state === "idle") {
      bob = Math.sin(t * 1.6) * 0.012;
      armA = armB = -0.25;
    } else if (state === "waiting") {
      armA = -2.6 + Math.sin(t * 5) * 0.25; // tangan terangkat
      armB = -0.25;
      tilt = Math.sin(t * 2) * 0.12;
    } else if (state === "paused") {
      armA = armB = -0.25;
    } else {
      shake = Math.sin(t * 30) * 0.015;
      armA = armB = -0.6;
    }
    body.current.position.y = bob;
    body.current.position.x = shake;
    head.current.rotation.z = tilt;
    armL.current.rotation.x = armA;
    armR.current.rotation.x = armB;
    if (marker.current) {
      marker.current.position.y = 2.05 + Math.sin(t * 4) * 0.08;
      marker.current.rotation.y = t * 2;
    }
  });

  const shirt = state === "paused" ? "#7a8396" : role.shirt;
  const screenOn = state === "working";

  return (
    <group
      position={slot(index)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        if (e.delta > 6) return; // geseran kamera, bukan ketukan
        e.stopPropagation();
        onSelect(agent.id);
      }}
    >
      {/* area ketuk yang lega untuk jari */}
      <mesh position={[0, 1, 0.4]} visible={false}>
        <boxGeometry args={[2.3, 2.2, 2.2]} />
      </mesh>

      {/* cincin status di lantai */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.35]}>
        <ringGeometry args={[1.2, 1.36, 40]} />
        <meshBasicMaterial color={color} transparent opacity={state === "idle" ? 0.4 : 0.95} />
      </mesh>

      {/* meja + monitor */}
      <mesh position={[0, 0.72, -0.2]}>
        <boxGeometry args={[1.9, 0.1, 0.95]} />
        <meshLambertMaterial color={dark ? "#3a4560" : "#b08968"} />
      </mesh>
      <mesh position={[-0.8, 0.36, -0.2]}>
        <boxGeometry args={[0.1, 0.72, 0.85]} />
        <meshLambertMaterial color={dark ? "#2a3349" : "#8d6e52"} />
      </mesh>
      <mesh position={[0.8, 0.36, -0.2]}>
        <boxGeometry args={[0.1, 0.72, 0.85]} />
        <meshLambertMaterial color={dark ? "#2a3349" : "#8d6e52"} />
      </mesh>
      <mesh position={[0, 1.1, -0.4]}>
        <boxGeometry args={[0.95, 0.58, 0.06]} />
        <meshLambertMaterial
          color={screenOn ? STATE_COLOR.working : "#1b2233"}
          emissive={screenOn ? STATE_COLOR.working : state === "error" ? STATE_COLOR.error : "#000000"}
          emissiveIntensity={screenOn ? 0.7 : state === "error" ? 0.45 : 0}
        />
      </mesh>
      <mesh position={[0, 0.84, -0.4]}>
        <boxGeometry args={[0.1, 0.14, 0.1]} />
        <meshLambertMaterial color="#1b2233" />
      </mesh>

      {/* kursi */}
      <mesh position={[0, 0.42, 0.7]}>
        <boxGeometry args={[0.62, 0.08, 0.62]} />
        <meshLambertMaterial color="#2b3246" />
      </mesh>
      <mesh position={[0, 0.2, 0.7]}>
        <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
        <meshLambertMaterial color="#2b3246" />
      </mesh>

      {/* avatar low-poly, menghadap monitor (-z) */}
      <group ref={body} position={[0, 0, 0.7]}>
        <mesh position={[0, 0.78, 0]}>
          <cylinderGeometry args={[0.24, 0.28, 0.6, 10]} />
          <meshLambertMaterial color={shirt} />
        </mesh>
        <mesh ref={head} position={[0, 1.27, 0]}>
          <sphereGeometry args={[0.21, 12, 10]} />
          <meshLambertMaterial color="#e7b98f" />
        </mesh>
        <group ref={armL} position={[-0.34, 1.0, 0]}>
          <mesh position={[0, -0.2, 0]}>
            <boxGeometry args={[0.11, 0.42, 0.11]} />
            <meshLambertMaterial color={shirt} />
          </mesh>
        </group>
        <group ref={armR} position={[0.34, 1.0, 0]}>
          <mesh position={[0, -0.2, 0]}>
            <boxGeometry args={[0.11, 0.42, 0.11]} />
            <meshLambertMaterial color={shirt} />
          </mesh>
        </group>
      </group>

      {/* penanda: menunggu persetujuan / bermasalah */}
      {(state === "waiting" || state === "error") && (
        <mesh ref={marker} position={[0, 2.05, 0.7]}>
          <octahedronGeometry args={[0.16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}

      <sprite position={[0, 2.5, 0.7]} scale={[1.7, 0.425, 1]}>
        <spriteMaterial map={label} transparent depthWrite={false} />
      </sprite>
    </group>
  );
}

// Kamera sentuh: satu jari memutar, dua jari mencubit untuk zoom dan menggeser. Dibatasi agar
// pengguna tidak "tersesat" di luar ruangan.
function Controls() {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const dom = useThree((s) => s.gl.domElement);
  const width = useThree((s) => s.size.width);
  const ref = useRef<OrbitControls | null>(null);

  useEffect(() => {
    const base = Math.max(width, 280) / 15;
    camera.zoom = base;
    camera.updateProjectionMatrix();

    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.minZoom = base * 0.7;
    c.maxZoom = base * 2.5;
    c.minPolarAngle = 0.55;
    c.maxPolarAngle = 1.2;
    c.minAzimuthAngle = Math.PI / 4 - 0.9;
    c.maxAzimuthAngle = Math.PI / 4 + 0.9;
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    const clamp = () => {
      const t = c.target;
      const cx = THREE.MathUtils.clamp(t.x, -4, 4);
      const cz = THREE.MathUtils.clamp(t.z, -3, 3);
      const dx = cx - t.x;
      const dz = cz - t.z;
      if (dx || dz) {
        t.x = cx;
        t.z = cz;
        camera.position.x += dx;
        camera.position.z += dz;
      }
    };
    c.addEventListener("change", clamp);
    ref.current = c;
    return () => {
      c.removeEventListener("change", clamp);
      c.dispose();
      ref.current = null;
    };
  }, [camera, dom, width]);

  useFrame(() => ref.current?.update());
  return null;
}

interface Props {
  agents: OfficeAgent[];
  dark: boolean;
  reduced: boolean;
  onSelect: (id: string) => void;
}

export default function Scene3D({ agents, dark, reduced, onSelect }: Props) {
  return (
    <Canvas
      orthographic
      dpr={[1, 1.5]}
      camera={{ position: [10, 10, 10], zoom: 30, near: -50, far: 200 }}
      gl={{ antialias: true, powerPreference: "low-power" }}
      aria-label={`Kantor 3D, ${agents.filter((a) => a.state === "working").length} agent bekerja`}
    >
      <color attach="background" args={[dark ? "#0c111d" : "#e8ecf1"]} />
      <ambientLight intensity={dark ? 1.1 : 1.25} />
      <directionalLight position={[6, 12, 5]} intensity={dark ? 1.4 : 1.6} />

      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[13, 0.12, 8.4]} />
        <meshLambertMaterial color={dark ? "#1a2236" : "#f4f6fa"} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[12.2, 7.6]} />
        <meshLambertMaterial color={dark ? "#202a42" : "#e3e8f0"} />
      </mesh>

      {agents.map((a, i) => (
        <AgentDesk key={a.id} agent={a} index={i} dark={dark} reduced={reduced} onSelect={onSelect} />
      ))}
      <Controls />
    </Canvas>
  );
}

