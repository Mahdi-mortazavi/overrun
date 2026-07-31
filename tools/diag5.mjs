import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://localhost:4173/?debug', { waitUntil:'networkidle' });
await p.waitForFunction(()=>window.__overrun && window.__overrun.state==='title',{timeout:60000});
await p.evaluate(()=>document.querySelectorAll('#modeGrid .mode')[0].querySelector('[data-a="solo"]').click());
await p.waitForFunction(()=>window.__overrun.state==='play',{timeout:20000});
await p.waitForTimeout(1000);
await p.evaluate(()=>{ window.__overrun.stage.composer=null; });

// A: floor -> basic material
await p.evaluate(()=>{
  const a=window.__overrun, f=a.arena.floor;
  const M = f.material.constructor;
  void M;
  const proto = Object.getPrototypeOf(f.material);
  void proto;
  // build a MeshBasicMaterial by cloning from an existing basic material in the scene
  let basicProto=null;
  a.stage.scene.traverse(o=>{ if(o.material && o.material.type==='MeshBasicMaterial' && !basicProto) basicProto=o.material; });
  if (basicProto) { const m = basicProto.clone(); m.map = f.material.map; m.color.setHex(0xffffff); m.transparent=false; m.blending=0; m.depthWrite=true; f.material = m; }
  return !!basicProto;
});
await p.waitForTimeout(500);
await p.screenshot({path:'shots/diag-basicfloor.png'});

// B: disable shadows
await p.evaluate(()=>{ const s=window.__overrun.stage; s.renderer.shadowMap.enabled=false; s.sun.castShadow=false; s.scene.traverse(o=>{if(o.material)o.material.needsUpdate=true;}); });
await p.waitForTimeout(600);
await p.screenshot({path:'shots/diag-noshadow.png'});

// C: turn tone mapping off
await p.evaluate(()=>{ const s=window.__overrun.stage; s.renderer.toneMapping = 0; s.scene.traverse(o=>{if(o.material)o.material.needsUpdate=true;}); });
await p.waitForTimeout(600);
await p.screenshot({path:'shots/diag-notonemap.png'});
await b.close();
