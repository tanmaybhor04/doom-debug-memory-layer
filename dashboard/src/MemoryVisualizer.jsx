import React, { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';

const CATEGORY_COLORS = {
  Standard:     0x06b6d4, // cyan
  Architecture: 0x8b5cf6, // purple
  Preference:   0x10b981, // emerald
  Profile:      0xf59e0b, // amber
  Custom:       0x60a5fa, // blue
  Rule:         0xf43f5e, // rose
};

function getColor(category) {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Custom;
}

export default function MemoryVisualizer({ memories }) {
  const mountRef = useRef(null);

  const setup = useCallback(() => {
    const container = mountRef.current;
    if (!container) return () => {};

    const W = container.clientWidth  || 400;
    const H = container.clientHeight || 260;

    // ── scene ──────────────────────────────────────────────────────────────
    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
    camera.position.set(0, 0, 9);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // ── lights ─────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const ptLight = new THREE.PointLight(0x22d3ee, 2.5, 20);
    ptLight.position.set(0, 0, 4);
    scene.add(ptLight);

    const rimLight = new THREE.PointLight(0x7c3aed, 1.5, 15);
    rimLight.position.set(-4, 3, -3);
    scene.add(rimLight);

    // ── star field ─────────────────────────────────────────────────────────
    const starGeo  = new THREE.BufferGeometry();
    const starPos  = new Float32Array(600);
    for (let i = 0; i < 600; i++) starPos[i] = (Math.random() - 0.5) * 60;
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x94a3b8, size: 0.08 }));
    scene.add(stars);

    // ── core sphere ────────────────────────────────────────────────────────
    const coreGeo  = new THREE.IcosahedronGeometry(1.1, 2);
    const coreMat  = new THREE.MeshPhongMaterial({
      color: 0x0ea5e9, emissive: 0x0369a1, wireframe: false,
      transparent: true, opacity: 0.85, shininess: 120,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // inner glow wireframe
    const wireMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.15, 2),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.25 }),
    );
    scene.add(wireMesh);

    // ── connection lines (from core to nodes) ──────────────────────────────
    const lineGroup = new THREE.Group();
    scene.add(lineGroup);

    // ── memory nodes ────────────────────────────────────────────────────────
    const nodeMeshes = [];
    const labelGeo   = new THREE.SphereGeometry(0.08, 8, 8); // tiny ring marker
    const count = Math.max(memories.length, 1);
    const ORBIT_RADII = [3.2, 4.2, 5.0]; // multi-ring orbits

    memories.forEach((mem, index) => {
      const color  = getColor(mem.category);
      const ring   = index % ORBIT_RADII.length;
      const radius = ORBIT_RADII[ring];
      const size   = 0.28 + (mem.priority ?? 0) * 0.01;

      // main node sphere
      const geo = new THREE.SphereGeometry(size, 20, 20);
      const mat = new THREE.MeshPhongMaterial({
        color, emissive: color, emissiveIntensity: 0.4,
        shininess: 180, transparent: true, opacity: 0.92,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData = {
        offset:  (index / count) * Math.PI * 2,
        ring,
        radius,
        speedMul: 0.6 + ring * 0.15,
        mem,
      };
      scene.add(mesh);
      nodeMeshes.push(mesh);

      // connecting line placeholder (updated each frame)
      const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18 });
      const line    = new THREE.Line(lineGeo, lineMat);
      lineGroup.add(line);
      mesh.userData.line = line;
    });

    // ── mouse orbit ────────────────────────────────────────────────────────
    let mouse = { x: 0, y: 0 };
    const onMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      mouse.x =  ((e.clientX - rect.left)  / rect.width  - 0.5) * 2;
      mouse.y = -((e.clientY - rect.top)   / rect.height - 0.5) * 2;
    };
    container.addEventListener('mousemove', onMouseMove);

    // ── resize handler ──────────────────────────────────────────────────────
    const onResize = () => {
      const W2 = container.clientWidth  || 400;
      const H2 = container.clientHeight || 260;
      camera.aspect = W2 / H2;
      camera.updateProjectionMatrix();
      renderer.setSize(W2, H2);
    };
    window.addEventListener('resize', onResize);

    // ── animation ───────────────────────────────────────────────────────────
    const clock = new THREE.Clock();
    let rafId;

    const animate = () => {
      rafId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // gentle camera sway following mouse
      camera.position.x += (mouse.x * 1.5 - camera.position.x) * 0.03;
      camera.position.y += (mouse.y * 1.0 - camera.position.y) * 0.03;
      camera.lookAt(scene.position);

      // pulse core
      const pulse = 1 + Math.sin(t * 2.2) * 0.04;
      coreMesh.scale.setScalar(pulse);
      wireMesh.scale.setScalar(pulse * 1.02);
      coreMesh.rotation.y += 0.006;
      coreMesh.rotation.x += 0.003;
      wireMesh.rotation.y -= 0.004;

      // point light pulse
      ptLight.intensity = 2.0 + Math.sin(t * 3) * 0.6;

      // orbit nodes
      nodeMeshes.forEach((mesh) => {
        const { offset, radius, speedMul, line } = mesh.userData;
        const angle = t * speedMul + offset;
        const incline = offset * 0.4;
        mesh.position.x = Math.cos(angle) * radius;
        mesh.position.z = Math.sin(angle) * radius * Math.cos(incline);
        mesh.position.y = Math.sin(angle) * radius * Math.sin(incline) + Math.sin(t + offset) * 0.3;
        mesh.rotation.y += 0.02;

        // update connecting line
        if (line) {
          const pts = [new THREE.Vector3(0, 0, 0), mesh.position.clone()];
          line.geometry.setFromPoints(pts);
          line.geometry.attributes.position.needsUpdate = true;
        }
      });

      stars.rotation.y += 0.0003;
      renderer.render(scene, camera);
    };
    animate();

    // ── cleanup ─────────────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafId);
      container.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);

      nodeMeshes.forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
      lineGroup.children.forEach((l) => { l.geometry.dispose(); l.material.dispose(); });
      coreGeo.dispose(); coreMat.dispose();
      starGeo.dispose();
      labelGeo.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [memories]);

  useEffect(() => {
    const cleanup = setup();
    return cleanup;
  }, [setup]);

  return (
    <div className="relative w-full h-64 rounded-xl overflow-hidden bg-black/30">
      <div ref={mountRef} className="w-full h-full" />
      {/* Legend */}
      <div className="absolute bottom-2 left-3 flex flex-wrap gap-x-3 gap-y-1 pointer-events-none">
        {Object.entries(CATEGORY_COLORS).slice(0, 5).map(([label, hex]) => (
          <span key={label} className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: `#${hex.toString(16).padStart(6, '0')}` }}
            />
            {label}
          </span>
        ))}
      </div>
      {/* node count badge */}
      <div className="absolute top-2 right-3 text-[10px] font-mono text-cyan-500 bg-black/40 px-2 py-0.5 rounded-full border border-cyan-900">
        {memories.length} nodes · mouse to rotate
      </div>
    </div>
  );
}
