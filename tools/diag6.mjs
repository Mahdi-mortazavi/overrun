import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror',e=>console.log('ERR',e.message));
p.on('console',m=>console.log('C['+m.type()+']',m.text().slice(0,300)));
await p.goto('http://localhost:4173/?debug', { waitUntil:'networkidle' });
await p.waitForFunction(()=>window.__overrun && window.__overrun.state==='title',{timeout:60000});
await p.evaluate(()=>document.querySelectorAll('#modeGrid .mode')[0].querySelector('[data-a="solo"]').click());
await p.waitForFunction(()=>window.__overrun.state==='play',{timeout:20000});
await p.waitForTimeout(1000);
console.log(await p.evaluate(()=>{
  const a=window.__overrun, s=a.stage;
  s.composer=null;
  const gl = s.renderer.getContext();
  // Compile a bare standard material and inspect the program log.
  const props = s.renderer.properties;
  let report=[];
  s.scene.traverse(o=>{
    if (!o.material || Array.isArray(o.material)) return;
    if (o.material.type!=='MeshStandardMaterial') return;
    const mp = props.get(o.material);
    const prog = mp && mp.currentProgram;
    if (!prog) return;
    const gp = prog.program;
    if (!gp) return;
    const linked = gl.getProgramParameter(gp, gl.LINK_STATUS);
    const log = gl.getProgramInfoLog(gp);
    report.push({ name:o.name||o.type, linked, log: (log||'').slice(0,200), uniforms: Object.keys(prog.getUniforms().map||{}).length });
  });
  return JSON.stringify(report.slice(0,4), null, 1);
}));
console.log(await p.evaluate(()=>{
  const s=window.__overrun.stage;
  const f=window.__overrun.arena.floor;
  const mp = s.renderer.properties.get(f.material);
  const prog = mp && mp.currentProgram;
  if(!prog) return 'no program';
  const src = prog.fragmentShader || '';
  return JSON.stringify({ hasLights: src.includes('RE_Direct'), hasEnv: src.includes('envMap'),
    numDirLights: (src.match(/NUM_DIR_LIGHTS (\d+)/)||[])[1],
    numHemi: (src.match(/NUM_HEMI_LIGHTS (\d+)/)||[])[1],
    toneMap: src.includes('toneMapping') });
}));
await b.close();
