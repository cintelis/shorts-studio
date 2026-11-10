p = 'lib/factory.js'; s = open(p, encoding='utf-8').read()
def sub(a, b, cnt=1):
    global s
    assert a in s, a[:80]
    s = s.replace(a, b, cnt)

# R4 pallet + static boxes on it / on the shelf
sub("      const pal = palG.clone(true); pal.rotation.y = PI / 2; pal.position.set(ax + 0.8, 0, zP); world.add(pal);",
    "      const pal = palG.clone(true); pal.rotation.y = PI / 2; pal.position.set(ax + 0.8, 0, zP); world.add(pal);\n      AUD.virt.push({ M: new THREE.Matrix4().makeTranslation(ax + 0.8, 0.072, zP), h: [0.4, 0.072, 0.6], name: 'pallet' });")
sub("for (const [i, dz] of pre) { const m = mkBox('290x290x290_' + (1 + (i % 2))); m.position.set(sx + 0.2, shelfH[i], zS + dz); }",
    "for (const [i, dz] of pre) { const m = mkBox('290x290x290_' + (1 + (i % 2))); m.position.set(sx + 0.2, shelfH[i], zS + dz); AUD.statItems = AUD.statItems || []; AUD.statItems.push({ mesh: m, h: [0.145, 0.145, 0.145], name: 'shelf-prebox' }); }")
sub("place(m, frontOf(ax, zP, 0, 0.6, 0.144 + layer * 0.29, lat)); }",
    "place(m, frontOf(ax, zP, 0, 0.6, 0.144 + layer * 0.29, lat)); AUD.statItems = AUD.statItems || []; AUD.statItems.push({ mesh: m, h: [0.145, 0.145, 0.145], name: 'pallet-box' }); }")
# machine beds as supports
sub("      const BED = 0.635;", "      const BED = 0.635; AUD.sups.push({ M: new THREE.Matrix4().makeTranslation(rx, BED - 0.05, PRESS.z), h: [0.42, 0.05, 0.22], name: 'press-bed' });")
sub("      const rx = 5.95, rz = MILL.z, b = nb('mill', rx, rz, PI / 2);", "      AUD.sups.push({ M: new THREE.Matrix4().makeTranslation(5.2, 0.785 - 0.05, MILL.z), h: [0.25, 0.05, 0.3], name: 'mill-bed' });\n      const rx = 5.95, rz = MILL.z, b = nb('mill', rx, rz, PI / 2);")
# Han's arm sample points (v4 arm) for the audit
sub("    const armG = put(arm, 1, -4.35, 1.6, -PI / 2); arm.scene.position.y = -0.116;",
    "    const armG = put(arm, 1, -4.35, 1.6, -PI / 2); arm.scene.position.y = -0.116;\n    armG.updateMatrixWorld(true); armG.traverse((o) => { if (o.isMesh) { const P = o.geometry.attributes.position; for (let i = 0; i < P.count; i += 7) AUD.armPts.push([V3(P.getX(i), P.getY(i), P.getZ(i)).applyMatrix4(o.matrixWorld), 0, 'hans-arm']); } });")
# items + audit context
sub("  // ---------------------------------------------------------------- post",
"""  function objStatus(q, t) {
    const o = q.o, tl = t - (q.bot.shift || 0);
    if (o.visibleFrom !== undefined && tl < o.visibleFrom) return null;
    if (o.hideAfterT !== undefined && t > o.hideAfterT) return null;
    let M = null, held = null, belt = false;
    const hj = (b, j) => { M = b.objAt(j, tl); if (tl >= j.tPick && (!j.Wp || tl < j.tPlace)) held = b.name; };
    if (q.job2 && tl >= q.job2.tR0) hj(q.bot2, q.job2);
    else if (q.belt && tl >= q.belt.t0) { M = objPose(q, t); belt = true; }
    else if (tl < q.job.tPick && o.pre) { M = o.pre(tl); belt = true; }
    else hj(q.bot, q.job);
    if (q.cobotHeld) { const c = q.cobotHeld(t); if (c) { M = c.M; held = c.held; } if (c && c.hidden) return null; }
    if (!M) return null;
    let h = o.halfW > 0.3 ? [0.301, 0.115, 0.201] : o.halfW > 0.15 ? [0.145, 0.145, 0.145] : [0.12, 0.045, 0.08];
    if (o.squashAt !== undefined && t > o.squashAt) h = [h[0] * 1.12, h[1] * 0.55, h[2] * 1.12];
    const Mc = M.clone().multiply(new THREE.Matrix4().makeTranslation(0, h[1], 0));
    return { M: Mc, h, held, belt };
  }
  function auditCtx() {
    return {
      rigs: rigs.slice(0, bots.length), botNames: bots.map((b) => b.name),
      staticBoxes: () => [...AUD.boxes.filter((b) => b.parent !== cart && b.o.visible).map((b) => { b.o.updateMatrixWorld(true); return { M: b.o.matrixWorld.clone(), h: b.h, name: b.name }; }), ...AUD.virt],
      supports: () => [...AUD.boxes.filter((b) => b.parent !== cart).map((b) => ({ M: b.o.matrixWorld.clone(), h: b.h, name: b.name })), ...AUD.virt, ...AUD.sups],
      items: (t) => { const out = []; objs.forEach((q, i) => { const st = objStatus(q, t); if (st) out.push({ name: `${st.h[0] > 0.3 ? 'crate' : st.h[0] > 0.15 && st.h[1] > 0.1 ? 'box' : 'part'}#${i}@${q.bot.name}`, ...st }); });
        for (const si of AUD.statItems || []) { si.mesh.updateMatrixWorld(true); out.push({ name: si.name, M: si.mesh.matrixWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0, si.h[1], 0)), h: si.h, held: null, belt: false }); }
        return out; },
      cobotSamples: () => (cobotArm ? cobotArm.samples() : AUD.armPts),
    };
  }

  // ---------------------------------------------------------------- post""")
sub("let millRuns = [],", "let cobotArm = null, millRuns = [],")
sub("    composer.render();\n  }", "    if (!s.noDraw) composer.render();\n  }")
sub("  return { load, render, project, anchors: ANCH };", "  return { load, render, project, anchors: ANCH, auditCtx };")
open(p, 'w', encoding='utf-8').write(s)
print('ok')
