// ===== Biolunet — Lógica de la aplicación (v2: temario oficial) =====
'use strict';
const $ = (s, c = document) => c.querySelector(s);
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

// ---- Estado persistente ----
const KEY = 'biolunet_state_v2';
const state = loadState();
function loadState(){ try { return Object.assign(def(), JSON.parse(localStorage.getItem(KEY))); } catch(e){ return def(); } }
function def(){ return { quizzes:{}, temas:{}, minutos:0, biblioteca:[], modo:'estudio' }; }
function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }

let _start = Date.now();
setInterval(() => { const m = Math.floor((Date.now()-_start)/60000); if(m>=1){ state.minutos+=m; _start=Date.now(); save(); } }, 60000);

function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast._t); toast._t=setTimeout(()=>{t.hidden=true;},2200); }

// ---- Fondo de estrellas ----
(function stars(){
  const c=$('#stars'), x=c.getContext('2d'); let w,h,pts=[];
  function rz(){ w=c.width=innerWidth; h=c.height=innerHeight;
    pts=Array.from({length:Math.round(w*h/9000)},()=>({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.4+0.3,a:Math.random(),s:Math.random()*0.02+0.004})); }
  function loop(){ x.clearRect(0,0,w,h);
    for(const p of pts){ p.a+=p.s; const o=0.35+Math.abs(Math.sin(p.a))*0.65; x.beginPath(); x.arc(p.x,p.y,p.r,0,7); x.fillStyle='rgba(255,255,255,'+o+')'; x.fill(); }
    requestAnimationFrame(loop); }
  addEventListener('resize',rz); rz(); loop();
})();

// ---- PWA ----
if('serviceWorker' in navigator){ addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js').catch(()=>{})); }
let _deferred=null;
addEventListener('beforeinstallprompt',(e)=>{ e.preventDefault(); _deferred=e; $('#installBtn').hidden=false; });
$('#installBtn').addEventListener('click',async()=>{ if(!_deferred)return; _deferred.prompt(); await _deferred.userChoice; _deferred=null; $('#installBtn').hidden=true; });

// ---- Router (hash: #/materia/uIdx/tIdx) ----
const app = $('#app');
function go(hash){ location.hash = hash; }
function parseHash(){ return (location.hash.replace(/^#\/?/,'')||'home').split('/'); }
function render(){
  const p = parseHash();
  app.innerHTML=''; const view = el('<section class="view"></section>');
  try {
    if(p[0]==='home' || p[0]==='') viewHome(view);
    else if(p[0]==='buscar') viewBuscar(view);
    else if(p[0]==='glosario') viewGlosario(view);
    else if(p[0]==='progreso') viewProgreso(view);
    else if(p[0]==='materia'){
      if(p.length>=4 && p[3]==='quiz') viewQuizMateria(view,p[1]);
      else if(p.length>=4 && p[3]==='flash') viewFlashMateria(view,p[1]);
      else if(p.length>=4 && p[3]==='mapa') viewMapa(view,p[1]);
      else if(p.length>=3) viewTema(view,p[1],+p[2],+p[3]!==+p[3]?0:undefined,p);
      else viewMateria(view,p[1]);
    } else viewHome(view);
  } catch(err){ view.innerHTML='<div class="card">Error al mostrar la vista. <button class="btn" onclick="location.hash=\'home\'">Inicio</button></div>'; console.error(err); }
  app.appendChild(view);
  const navKey = p[0]==='materia'?'':p[0];
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active', b.dataset.nav===navKey));
  scrollTo({top:0,behavior:'smooth'});
}
addEventListener('hashchange',render);
document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.nav==='home'?'home':b.dataset.nav)));

// ---- Helpers de UI ----
function back(hash,label){ const b=el('<button class="back">← '+esc(label||'Volver')+'</button>'); b.onclick=()=>go(hash); return b; }
function chips(arr){ const w=el('<div class="result-chips"></div>'); (arr||[]).forEach(c=>w.appendChild(el('<span class="pill">'+esc(c)+'</span>'))); return w; }

function accordion(items){
  const wrap=el('<div></div>');
  items.forEach(([t,body])=>{
    const a=el('<div class="acc"><button>'+esc(t)+'<span>+</span></button><div class="body"><div>'+esc(body)+'</div></div></div>');
    a.querySelector('button').onclick=()=>{ a.classList.toggle('open'); a.querySelector('span').textContent=a.classList.contains('open')?'−':'+'; };
    wrap.appendChild(a);
  });
  return wrap;
}

function flashcards(cards){
  const wrap=el('<div class="grid"></div>');
  (cards||[]).forEach(([q,r])=>{
    const f=el('<div class="flash"><div class="flash-inner"><div class="flash-face flash-front">'+esc(q)+'</div><div class="flash-face flash-back">'+esc(r)+'</div></div></div>');
    f.onclick=()=>f.classList.toggle('flip'); wrap.appendChild(f);
  });
  if(!cards||!cards.length) wrap.appendChild(el('<p class="muted">Sin flashcards disponibles.</p>'));
  return wrap;
}

function tablaCuadro(cuadro){
  if(!cuadro) return el('<span></span>');
  const t=el('<div style="overflow-x:auto"><table class="cuadro"></table></div>');
  const tb=t.querySelector('table');
  if(cuadro.head){ const tr=el('<tr></tr>'); cuadro.head.forEach(h=>tr.appendChild(el('<th>'+esc(h)+'</th>'))); tb.appendChild(tr); }
  (cuadro.filas||[]).forEach(f=>{ const tr=el('<tr></tr>'); f.forEach(c=>tr.appendChild(el('<td>'+esc(c)+'</td>'))); tb.appendChild(tr); });
  return t;
}

// Quiz reutilizable. modo 'examen' oculta feedback hasta el final.
function quiz(idMateria, preguntas, modo){
  const wrap=el('<div></div>'); let idx=0, aciertos=0; const respuestas=[];
  const bar=el('<div class="progress-line"><i></i></div>'); const box=el('<div></div>');
  wrap.append(bar,box);
  function fin(){
    const pct=Math.round(aciertos/preguntas.length*100);
    if(idMateria){ state.quizzes[idMateria]=Math.max(state.quizzes[idMateria]||0,pct); save(); }
    box.innerHTML='<div class="card" style="text-align:center"><h3>🎉 Resultado</h3><p style="font-size:2rem;font-weight:800;color:#78ff78">'+aciertos+' / '+preguntas.length+'</p><p class="muted">'+pct+'% de aciertos</p></div>';
    if(modo==='examen'){ const rev=el('<div></div>'); preguntas.forEach((pg,i)=>{ const [q,ops,ok,fb]=pg; rev.appendChild(el('<div class="quiz-feedback">'+(respuestas[i]===ok?'✅ ':'❌ ')+esc(q)+'<br><b>Respuesta: </b>'+esc(ops[ok])+'. '+esc(fb)+'</div>')); }); box.appendChild(rev); }
    const rep=el('<button class="btn sec" style="margin-top:10px">Repetir</button>'); rep.onclick=()=>{ idx=0;aciertos=0;respuestas.length=0;pinta(); }; box.appendChild(rep);
    if(typeof refreshAch==='function') refreshAch();
  }
  function pinta(){
    bar.querySelector('i').style.width=(idx/preguntas.length*100)+'%';
    if(idx>=preguntas.length){ fin(); return; }
    const [q,ops,ok,fb]=preguntas[idx];
    box.innerHTML='<div class="card"><p class="muted">Pregunta '+(idx+1)+' de '+preguntas.length+' · '+(modo==='examen'?'Modo examen':'Modo estudio')+'</p><h3>'+esc(q)+'</h3></div>';
    const cont=box.querySelector('.card'); let hecha=false;
    ops.forEach((op,i)=>{ const b=el('<button class="quiz-opt">'+esc(op)+'</button>');
      b.onclick=()=>{ if(hecha)return; hecha=true; respuestas[idx]=i; if(i===ok)aciertos++;
        if(modo!=='examen'){ cont.querySelectorAll('.quiz-opt')[ok].classList.add('correct'); if(i!==ok)b.classList.add('wrong'); cont.appendChild(el('<div class="quiz-feedback">'+(i===ok?'✅ ¡Correcto! ':'❌ ')+esc(fb)+'</div>')); }
        const nx=el('<button class="btn" style="margin-top:12px">'+(idx+1<preguntas.length?'Siguiente →':'Ver resultado')+'</button>'); nx.onclick=()=>{ idx++; pinta(); }; cont.appendChild(nx);
      }; cont.appendChild(b);
    });
  }
  pinta(); return wrap;
}

// ---- Acceso a datos ----
function M(id){ return CONTENIDO[id]; }
function todosTemas(id){ const m=M(id); let a=[]; m.unidades.forEach((u,ui)=>u.temas.forEach((t,ti)=>a.push({u,ui,t,ti}))); return a; }
function contarTemas(id){ return todosTemas(id).length; }
function temasVistos(id){ return Object.keys(state.temas[id]||{}).length; }
function progMateria(id){ const tot=contarTemas(id)||1; return Math.min(100,Math.round(temasVistos(id)/tot*100)); }
function progGeneral(){ const ids=ORDER; return Math.round(ids.reduce((a,id)=>a+progMateria(id),0)/ids.length); }
function marcarTema(id,key){ state.temas[id]=state.temas[id]||{}; if(!state.temas[id][key]){ state.temas[id][key]=true; save(); } }

// Recopila flashcards / preguntas de una materia
function flashDe(id){ let a=[]; todosTemas(id).forEach(x=>(x.t.flashcards||[]).forEach(f=>a.push(f))); return a; }
function preguntasDe(id){ let a=[]; todosTemas(id).forEach(x=>(x.t.preguntas||[]).forEach(p=>a.push(p))); return a; }

// ================= HOME =================
function viewHome(view){
  const hero=el('<div class="hero"></div>');
  hero.appendChild(el('<div class="logo">🌙</div>'));
  hero.appendChild(el('<h1>Biolunet</h1>'));
  hero.appendChild(el('<canvas class="dna-wrap" id="dnaCanvas"></canvas>'));
  hero.appendChild(el('<p class="lead">Hay millones de especies, millones de ecosistemas y miles de millones de organismos vivos. Sin embargo, entre todo lo que existe, encontré a una persona capaz de dedicar horas a comprender cómo funciona la vida. Por eso nació Biolunet.</p>'));
  const cta=el('<button class="cta">Entrar al laboratorio 🧪</button>'); cta.onclick=()=>go('materia/'+ORDER[0]); hero.appendChild(cta);
  view.appendChild(hero);

  view.appendChild(el('<h2 class="section-title" style="margin-top:24px">📚 Materias</h2>'));
  const grid=el('<div class="grid"></div>');
  ORDER.forEach(id=>{ const m=M(id); const pct=progMateria(id);
    const c=el('<div class="card subject-card"><div class="ico">'+m.icono+'</div><h3>'+esc(m.nombre)+'</h3><p>'+m.unidades.length+' unidades · '+contarTemas(id)+' temas</p><div class="bar"><i></i></div><small class="muted">'+pct+'% explorado</small></div>');
    c.querySelector('.bar>i').style.width=pct+'%'; c.onclick=()=>go('materia/'+id); grid.appendChild(c);
  });
  view.appendChild(grid);
  view.appendChild(el('<p class="footer-note">Desarrollado especialmente para una futura bióloga extraordinaria 🌱</p>'));
  setTimeout(drawDNA,30);
}
function drawDNA(){ const c=$('#dnaCanvas'); if(!c)return; const x=c.getContext('2d'); const W=c.width=c.offsetWidth,H=c.height=70; let t=0;
  (function loop(){ if(!document.body.contains(c))return; x.clearRect(0,0,W,H); t+=0.04;
    for(let i=0;i<=W;i+=6){ const ph=i*0.05+t; const y1=H/2+Math.sin(ph)*24,y2=H/2+Math.sin(ph+Math.PI)*24;
      if(i%18===0){ x.strokeStyle='rgba(120,255,120,.35)'; x.beginPath(); x.moveTo(i,y1); x.lineTo(i,y2); x.stroke(); }
      x.fillStyle='#66BB6A'; x.beginPath(); x.arc(i,y1,2.2,0,7); x.fill(); x.fillStyle='#42a5f5'; x.beginPath(); x.arc(i,y2,2.2,0,7); x.fill(); }
    requestAnimationFrame(loop); })(); }

// ================= MATERIA (unidades → temas) =================
function viewMateria(view,id){
  const m=M(id); if(!m){ go('home'); return; }
  view.appendChild(back('home','Inicio'));
  view.appendChild(el('<h1 class="section-title">'+m.icono+' '+esc(m.nombre)+'</h1>'));
  if(m.intro) view.appendChild(el('<p class="intro">'+esc(m.intro)+'</p>'));
  // Herramientas de materia
  const tools=el('<div class="tabs"></div>');
  const mk=(lbl,hash)=>{ const b=el('<button>'+lbl+'</button>'); b.onclick=()=>go(hash); return b; };
  tools.append(mk('🧠 Mapa conceptual','materia/'+id+'/0/mapa'), mk('🃏 Flashcards','materia/'+id+'/0/flash'), mk('📝 Autoevaluación','materia/'+id+'/0/quiz'));
  view.appendChild(tools);
  const pl=el('<div class="progress-line"><i style="width:'+progMateria(id)+'%"></i></div>'); view.appendChild(pl);
  m.unidades.forEach((u,ui)=>{
    const acc=el('<div class="acc"><button>'+esc(u.nombre)+' <span>+</span></button><div class="body"><div class="uwrap"></div></div></div>');
    const inner=acc.querySelector('.uwrap');
    u.temas.forEach((t,ti)=>{ const visto=(state.temas[id]||{})[ui+'-'+ti];
      const item=el('<button class="tema-item">'+(visto?'✅ ':'• ')+esc(t.n)+'</button>');
      item.onclick=()=>go('materia/'+id+'/'+ui+'/'+ti); inner.appendChild(item);
    });
    acc.querySelector('button').onclick=()=>{ acc.classList.toggle('open'); acc.querySelector('span').textContent=acc.classList.contains('open')?'−':'+'; };
    view.appendChild(acc);
  });
}

// ================= TEMA (contenido didáctico completo) =================
function viewTema(view,id,ui,ti){
  const m=M(id); if(!m||!m.unidades[ui]||!m.unidades[ui].temas[ti]){ go('materia/'+id); return; }
  const u=m.unidades[ui], t=u.temas[ti];
  marcarTema(id, ui+'-'+ti);
  view.appendChild(back('materia/'+id, m.nombre));
  view.appendChild(el('<p class="muted" style="margin:2px 0">'+esc(u.nombre)+'</p>'));
  view.appendChild(el('<h1 class="section-title">'+esc(t.n)+'</h1>'));

  const sec=(titulo,ico)=>el('<h3 style="margin:18px 0 6px">'+ico+' '+esc(titulo)+'</h3>');
  const card=el('<div class="card"></div>'); view.appendChild(card);

  if(t.def){ card.appendChild(sec('Definición','📘')); card.appendChild(el('<p>'+esc(t.def)+'</p>')); }
  if(t.exp){ card.appendChild(sec('Explicación detallada','🔎')); card.appendChild(el('<p class="muted" style="line-height:1.8">'+esc(t.exp)+'</p>')); }
  if(t.clave&&t.clave.length){ card.appendChild(sec('Conceptos clave','🔑')); card.appendChild(chips(t.clave)); }
  if(t.ejemplos&&t.ejemplos.length){ card.appendChild(sec('Ejemplos biológicos reales','🧬')); const ul=el('<ul style="line-height:1.8;color:#a9c2b5"></ul>'); t.ejemplos.forEach(e=>ul.appendChild(el('<li>'+esc(e)+'</li>'))); card.appendChild(ul); }
  if(t.cuadro){ card.appendChild(sec('Cuadro comparativo','📊')); if(t.cuadro.titulo) card.appendChild(el('<p class="muted">'+esc(t.cuadro.titulo)+'</p>')); card.appendChild(tablaCuadro(t.cuadro)); }
  if(t.diagrama){ card.appendChild(sec('Diagrama conceptual','🧩')); card.appendChild(diagrama(t.diagrama)); }
  if(t.examen&&t.examen.length){ card.appendChild(sec('Datos importantes para el examen','⭐')); const ul=el('<ul style="line-height:1.8;color:#78ff78"></ul>'); t.examen.forEach(e=>ul.appendChild(el('<li>'+esc(e)+'</li>'))); card.appendChild(ul); }
  if(t.caso){ card.appendChild(sec('Caso práctico','🧪')); card.appendChild(el('<div class="quiz-feedback">'+esc(t.caso)+'</div>')); }
  if(t.flashcards&&t.flashcards.length){ view.appendChild(sec('Flashcards','🃏')); view.appendChild(flashcards(t.flashcards)); }
  if(t.preguntas&&t.preguntas.length){ view.appendChild(sec('Preguntas de repaso / ejercicio interactivo','❓')); view.appendChild(quiz(null,t.preguntas,'estudio')); }

  // Navegación entre temas
  const nav=el('<div class="row" style="margin-top:18px"></div>');
  const flat=todosTemas(id); const pos=flat.findIndex(x=>x.ui===ui&&x.ti===ti);
  if(pos>0){ const b=el('<button class="btn sec">← Tema anterior</button>'); b.onclick=()=>go('materia/'+id+'/'+flat[pos-1].ui+'/'+flat[pos-1].ti); nav.appendChild(b); }
  if(pos<flat.length-1){ const b=el('<button class="btn">Siguiente tema →</button>'); b.onclick=()=>go('materia/'+id+'/'+flat[pos+1].ui+'/'+flat[pos+1].ti); nav.appendChild(b); }
  view.appendChild(nav);
  if(typeof refreshAch==='function') refreshAch();
}

// Diagrama conceptual sencillo: nodo central → ramas
function diagrama(d){
  const wrap=el('<div class="diag"></div>');
  wrap.appendChild(el('<div class="diag-core">'+esc(d.centro)+'</div>'));
  const br=el('<div class="diag-branches"></div>');
  (d.ramas||[]).forEach(r=>br.appendChild(el('<div class="diag-node">'+esc(r)+'</div>')));
  wrap.appendChild(br); return wrap;
}

// ================= AUTOEVALUACIÓN / FLASH / MAPA DE MATERIA =================
function viewQuizMateria(view,id){
  const m=M(id); view.appendChild(back('materia/'+id,m.nombre));
  view.appendChild(el('<h1 class="section-title">📝 Autoevaluación · '+esc(m.nombre)+'</h1>'));
  const preg=preguntasDe(id);
  if(!preg.length){ view.appendChild(el('<div class="card muted">Esta materia aún no tiene preguntas cargadas.</div>')); return; }
  const sel=el('<div class="tabs"></div>');
  const be=el('<button>📖 Modo estudio</button>'), bx=el('<button>📝 Modo examen</button>');
  sel.append(be,bx); view.appendChild(sel);
  const host=el('<div></div>'); view.appendChild(host);
  function lanzar(modo){ be.classList.toggle('active',modo==='estudio'); bx.classList.toggle('active',modo==='examen'); state.modo=modo; save(); host.innerHTML=''; const barajado=preg.slice().sort(()=>Math.random()-0.5).slice(0,Math.min(12,preg.length)); host.appendChild(quiz(id,barajado,modo)); }
  be.onclick=()=>lanzar('estudio'); bx.onclick=()=>lanzar('examen'); lanzar(state.modo||'estudio');
}
function viewFlashMateria(view,id){
  const m=M(id); view.appendChild(back('materia/'+id,m.nombre));
  view.appendChild(el('<h1 class="section-title">🃏 Flashcards · '+esc(m.nombre)+'</h1>'));
  view.appendChild(el('<p class="muted">Toca cada tarjeta para girarla.</p>'));
  view.appendChild(flashcards(flashDe(id)));
}
function viewMapa(view,id){
  const m=M(id); view.appendChild(back('materia/'+id,m.nombre));
  view.appendChild(el('<h1 class="section-title">🧠 Mapa conceptual · '+esc(m.nombre)+'</h1>'));
  const tree=el('<div class="mapa"></div>');
  tree.appendChild(el('<div class="mapa-raiz">'+m.icono+' '+esc(m.nombre)+'</div>'));
  m.unidades.forEach(u=>{ const ub=el('<div class="mapa-unidad"><div class="mapa-u">'+esc(u.nombre)+'</div></div>'); const tl=el('<div class="mapa-temas"></div>'); u.temas.forEach(t=>tl.appendChild(el('<span class="mapa-tema">'+esc(t.n)+'</span>'))); ub.appendChild(tl); tree.appendChild(ub); });
  view.appendChild(tree);
}

// ================= BUSCADOR GLOBAL =================
function viewBuscar(view){
  view.appendChild(el('<h1 class="section-title">🔍 Buscador</h1>'));
  const inp=el('<input type="text" placeholder="Busca un tema, concepto o palabra..." style="width:100%;margin-bottom:12px">');
  view.appendChild(inp);
  const res=el('<div></div>'); view.appendChild(res);
  function buscar(q){
    res.innerHTML=''; q=(q||'').trim().toLowerCase(); if(q.length<2){ res.appendChild(el('<p class="muted">Escribe al menos 2 letras.</p>')); return; }
    let n=0;
    ORDER.forEach(id=>{ const m=M(id);
      todosTemas(id).forEach(x=>{ const t=x.t; const blob=(t.n+' '+(t.def||'')+' '+(t.exp||'')+' '+(t.clave||[]).join(' ')).toLowerCase();
        if(blob.includes(q)){ n++; const it=el('<div class="lib-item"><div><span class="pill">'+m.icono+' '+esc(m.nombre)+'</span><div style="margin-top:6px"><b>'+esc(t.n)+'</b></div><small class="muted">'+esc(x.u.nombre)+'</small></div></div>');
          const b=el('<button class="btn sec">Abrir</button>'); b.onclick=()=>go('materia/'+id+'/'+x.ui+'/'+x.ti); it.appendChild(b); res.appendChild(it); }
      });
    });
    if(!n) res.appendChild(el('<p class="muted">Sin resultados para “'+esc(q)+'”.</p>'));
    else res.insertBefore(el('<p class="muted">'+n+' resultado(s)</p>'), res.firstChild);
  }
  inp.oninput=()=>buscar(inp.value); inp.focus();
}

// ================= GLOSARIO GLOBAL =================
function viewGlosario(view){
  view.appendChild(el('<h1 class="section-title">📖 Glosario</h1>'));
  const filtro=el('<input type="text" placeholder="Filtrar términos..." style="width:100%;margin-bottom:12px">'); view.appendChild(filtro);
  const sel=el('<div class="tabs"></div>'); view.appendChild(sel);
  const host=el('<div></div>'); view.appendChild(host);
  const bTodas=el('<button class="active">Todas</button>'); sel.appendChild(bTodas);
  let materiaSel='';
  ORDER.forEach(id=>{ const b=el('<button>'+M(id).icono+'</button>'); b.title=M(id).nombre; b.onclick=()=>{ materiaSel=id; sel.querySelectorAll('button').forEach(x=>x.classList.remove('active')); b.classList.add('active'); pinta(); }; sel.appendChild(b); });
  bTodas.onclick=()=>{ materiaSel=''; sel.querySelectorAll('button').forEach(x=>x.classList.remove('active')); bTodas.classList.add('active'); pinta(); };
  function pinta(){
    host.innerHTML=''; const f=(filtro.value||'').toLowerCase(); const ids=materiaSel?[materiaSel]:ORDER; const items=[];
    ids.forEach(id=>todosTemas(id).forEach(x=>{ if(x.t.def) items.push([x.t.n,x.t.def]); }));
    const vis=items.filter(([n,d])=>!f||(n+d).toLowerCase().includes(f)).sort((a,b)=>a[0].localeCompare(b[0]));
    const c=el('<div class="card"></div>'); c.appendChild(accordion(vis)); host.appendChild(c);
    if(!vis.length) host.appendChild(el('<p class="muted">Sin términos.</p>'));
  }
  filtro.oninput=pinta; pinta();
}

// ================= PROGRESO / LOGROS =================
const LOGROS=[
  ['ini','🌱','Primeros pasos', ()=>temasVistos(ORDER[0])+ORDER.reduce((a,id)=>a+temasVistos(id),0)>=1],
  ['exp','🔬','Exploradora', ()=>ORDER.reduce((a,id)=>a+temasVistos(id),0)>=20],
  ['quiz','📝','Autoevaluadora', ()=>Object.values(state.quizzes).filter(p=>p>0).length>=1],
  ['maestra','🎓','Maestra de materia', ()=>ORDER.some(id=>progMateria(id)>=100)],
  ['dedic','⏰','Estudiante dedicada', ()=>state.minutos>=15],
  ['estrella','🌟','Bióloga estelar', ()=>progGeneral()>=100]
];
function refreshAch(){ if((parseHash()[0])==='progreso') render(); }
function viewProgreso(view){
  view.appendChild(el('<h1 class="section-title">🏅 Mi progreso</h1>'));
  const g=progGeneral();
  const ring=el('<div class="card" style="text-align:center"><h3>Avance general</h3><div class="ring"><span>'+g+'%</span></div><p class="muted">¡Sigue así!</p></div>');
  ring.querySelector('.ring').style.setProperty('--p',g); view.appendChild(ring);
  const stats=el('<div class="stats"></div>');
  const totalVistos=ORDER.reduce((a,id)=>a+temasVistos(id),0);
  stats.appendChild(el('<div class="stat"><div class="big">'+state.minutos+'</div><small class="muted">minutos de estudio</small></div>'));
  stats.appendChild(el('<div class="stat"><div class="big">'+Object.values(state.quizzes).filter(p=>p>0).length+'</div><small class="muted">autoevaluaciones</small></div>'));
  stats.appendChild(el('<div class="stat"><div class="big">'+totalVistos+'</div><small class="muted">temas estudiados</small></div>'));
  const sc=el('<div class="card"></div>'); sc.appendChild(stats); view.appendChild(sc);
  view.appendChild(el('<h2 class="section-title">Materias</h2>'));
  const mg=el('<div class="card"></div>');
  ORDER.forEach(id=>{ const p=progMateria(id); mg.appendChild(el('<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between"><span>'+M(id).icono+' '+esc(M(id).nombre)+'</span><b>'+p+'%</b></div><div class="progress-line"><i style="width:'+p+'%"></i></div></div>')); });
  view.appendChild(mg);
  view.appendChild(el('<h2 class="section-title">🏆 Logros</h2>'));
  const bg=el('<div class="badges"></div>');
  LOGROS.forEach(([k,e,nom,cond])=>{ const on=cond(); bg.appendChild(el('<div class="badge '+(on?'on':'')+'"><div class="e">'+e+'</div><div><b>'+esc(nom)+'</b></div><small>'+(on?'¡Desbloqueado!':'Por conseguir')+'</small></div>')); });
  view.appendChild(bg);
  view.appendChild(el('<div class="card" style="margin-top:18px;text-align:center;background:linear-gradient(135deg,rgba(46,125,50,.3),rgba(21,101,192,.25))"><h3>🔬 Observación Final</h3><p class="intro" style="border:none;font-size:1.05rem">“Después de analizar ecosistemas, organismos, genes y modelos matemáticos, Biolunet concluye que algunas personas tienen la curiosidad necesaria para cambiar el mundo. Sigue explorando. 🌱”</p></div>'));
}

// ---- Arranque ----
render();
