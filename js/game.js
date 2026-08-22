(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const game = $('game'), stage = $('stage'), announcer = $('announcer'), combatToast = $('combatToast'), ultimateCutIn = $('ultimateCutIn');
  const supportsWebP=(()=>{try{return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp')}catch{return false}})();
  const preferredAsset=src=>{
    if(!supportsWebP)return src;
    if(src==='assets/arena.png'&&matchMedia('(max-width:760px), (pointer:coarse)').matches)return 'assets/arena-mobile.webp';
    return src.replace(/\.png$/i,'.webp');
  };
  const keys = new Set();
  const art = {
    player:{
      idle:'assets/chibi/zhao-ying/00-idle.png', forward:'assets/chibi/zhao-ying/01-forward.png',
      attack:'assets/chibi/zhao-ying/02-punch.png', kick:'assets/chibi/zhao-ying/03-kick.png',
      guard:'assets/chibi/zhao-ying/04-guard.png', hurt:'assets/chibi/zhao-ying/05-hurt.png',
      victory:'assets/chibi/zhao-ying/06-victory.png', special:'assets/chibi/zhao-ying/07-special.png'
    },
    cpu:{
      idle:'assets/chibi/zhong-yajing/00-idle.png', forward:'assets/chibi/zhong-yajing/01-forward.png',
      attack:'assets/chibi/zhong-yajing/02-punch.png', kick:'assets/chibi/zhong-yajing/03-kick.png',
      guard:'assets/chibi/zhong-yajing/04-guard.png', hurt:'assets/chibi/zhong-yajing/05-hurt.png',
      victory:'assets/chibi/zhong-yajing/06-victory.png', special:'assets/chibi/zhong-yajing/07-special.png'
    }
  };
  const assistArt = {
    player:'assets/chibi/helpers/wang-yihan-projectile.png',
    cpu:'assets/chibi/helpers/gong-taoran-projectile.png'
  };
  const corePoses=['idle','forward','attack','guard','hurt'];
  const deferredPoses=['kick','victory','special'];
  const assetGroups={
    critical:[
      'assets/arena.png',
      ...corePoses.map(pose=>art.player[pose]),...corePoses.map(pose=>art.cpu[pose])
    ],
    deferred:[
      ...deferredPoses.map(pose=>art.player[pose]),...deferredPoses.map(pose=>art.cpu[pose]),
      ...Object.values(assistArt)
    ]
  };
  const assetCache = new Map();
  const failedAssets = new Set();
  let assetsReady = false;
  const loadedAsset=src=>assetCache.get(src)?.src||preferredAsset(src);
  const assetAvailable=src=>{const image=assetCache.get(src);return !!(image?.complete&&image.naturalWidth>0)};
  const BODY_RADIUS=4.2, MIN_CENTER_DISTANCE=BODY_RADIUS*2+1.2;
  const MOVES=[
    {pose:'attack',startup:80,active:65,recovery:90,reach:5.2,damage:7,knockback:3,strong:false},
    {pose:'kick',startup:105,active:75,recovery:95,reach:7,damage:9,knockback:3,strong:false},
    {pose:'special',startup:150,active:90,recovery:150,reach:9,damage:12,knockback:6,strong:true}
  ];
  const COUNTER_MOVE={startup:120,active:85,recovery:250,reach:8.5,damage:10,knockback:7,strong:true};
  const state = {
    running:false, cinematic:false, time:60, last:0, timerAcc:0, sound:true,
    player:{el:$('player'), img:$('player').querySelector('img'), x:20, hp:100, energy:0, cooldown:0, guard:false, busy:0, bodyRadius:BODY_RADIUS, comboStep:0, comboExpires:0, counterReadyUntil:0, attackToken:0},
    cpu:{el:$('cpu'), img:$('cpu').querySelector('img'), x:80, hp:100, energy:0, cooldown:0, guard:false, busy:0, bodyRadius:BODY_RADIUS, comboStep:0, comboExpires:0, counterReadyUntil:0, attackToken:0, aiState:'approach', aiUntil:0, aiComboRemaining:0}
  };
  let audio;
  function clearFrameTimers(f){(f.frameTimers||[]).forEach(clearTimeout);f.frameTimers=[];}
  function setFrame(f,who,pose){
    const src=art[who][pose], cached=assetCache.get(src);
    f.currentPose=pose;f.el.dataset.pose=pose;
    // Online play used to replace the current frame before the next PNG had
    // arrived, briefly exposing the image alt text. Keep the last good frame
    // unless this one is known to be available.
    if(!failedAssets.has(src)&&(!assetsReady||cached?.complete&&cached.naturalWidth>0))f.img.src=loadedAsset(src);
  }
  async function preloadGroup(group,onProgress=()=>{}){
    const sources=[...new Set(group)],cached=sources.filter(assetAvailable);let completed=cached.length;
    onProgress(completed,sources.length);
    const pending=sources.filter(src=>!assetAvailable(src));
    const results=await Promise.allSettled(pending.map(src=>new Promise((resolve,reject)=>{
      const image=new Image(),preferred=preferredAsset(src);let triedFallback=false;assetCache.set(src,image);
      image.onload=()=>{failedAssets.delete(src);completed++;onProgress(completed,sources.length);resolve(src)};
      image.onerror=()=>{
        if(!triedFallback&&preferred!==src){triedFallback=true;image.src=src;return;}
        failedAssets.add(src);completed++;onProgress(completed,sources.length);reject(new Error(src));
      };
      image.src=preferred;
    })));
    return results.filter(result=>result.status==='rejected');
  }
  async function preloadAssets(){
    let completed=0;
    const failures=await preloadGroup(assetGroups.critical,(done,total)=>{
      completed=done;$('loadStatus').textContent=`正在准备基础素材 ${Math.round(done/total*100)}%`;
    });
    if(failures.length){
      $('loadStatus').textContent=`有 ${failures.length} 个素材加载失败，请刷新页面重试`;
      $('loadStatus').classList.add('error');
      $('startBtn').textContent='素材加载失败';
      return;
    }
    assetsReady=true;
    $('loadStatus').textContent='基础素材就绪，扩展动作后台加载中';
    $('startBtn').disabled=false;$('startBtn').textContent='开始对决';
    const deferredFailures=await preloadGroup(assetGroups.deferred);
    $('loadStatus').textContent=deferredFailures.length?`基础素材已就绪，${deferredFailures.length} 个扩展素材不可用`:'全部素材就绪';
    $('loadStatus').classList.toggle('error',deferredFailures.length>0);
  }
  function resetFighter(f, x, who){
    clearTimeout(f.poseTimer); clearTimeout(f.moveTimer); clearFrameTimers(f);
    Object.assign(f,{x,hp:100,energy:0,cooldown:0,guard:false,busy:0,bodyRadius:BODY_RADIUS,comboStep:0,comboExpires:0,counterReadyUntil:0,currentPose:'idle',attackToken:(f.attackToken||0)+1});
    if(who==='cpu')Object.assign(f,{aiState:'approach',aiUntil:0,aiComboRemaining:0});
    f.el.className = 'fighter ' + (who==='cpu'?'cpu face-left':'face-right');
    if(who==='cpu')f.el.dataset.aiState='approach';
    setFrame(f,who,'idle');
  }
  function reset(){
    document.querySelectorAll('.assist-projectile').forEach(el=>el.remove());
    state.cinematic=false;ultimateCutIn.className='ultimate-cut-in hidden';
    state.time=60; state.timerAcc=0; state.last=performance.now();
    resetFighter(state.player,20,'player'); resetFighter(state.cpu,80,'cpu');
    updateHud(); position();
  }
  function start(){
    if(!assetsReady)return;
    $('startOverlay').classList.add('hidden'); $('endOverlay').classList.add('hidden');
    reset(); state.running=true; announce('FIGHT!'); requestAnimationFrame(loop);
  }
  function position(){
    state.player.el.style.setProperty('--x',state.player.x);
    state.cpu.el.style.setProperty('--x',state.cpu.x);
  }
  function updateHud(){
    $('pHealth').style.width=state.player.hp+'%'; $('cHealth').style.width=state.cpu.hp+'%';
    $('pEnergy').style.width=Math.min(100,state.player.energy)+'%'; $('cEnergy').style.width=Math.min(100,state.cpu.energy)+'%';
    $('timer').textContent=String(Math.ceil(state.time)).padStart(2,'0');
  }
  function setPose(f,who,pose,duration=240){
    f.guard=false; f.el.classList.remove('guarding'); f.el.classList.remove('attacking','hurt','special');
    if(pose==='attack'||pose==='kick')f.el.classList.add('attacking');
    if(pose==='hurt')f.el.classList.add('hurt');
    if(pose==='special')f.el.classList.add('special');
    f.busy=Math.max(f.busy,duration);
    clearTimeout(f.poseTimer);clearFrameTimers(f);f.poseToken=(f.poseToken||0)+1;const token=f.poseToken;
    const sequences={
      attack:[['forward',0],['attack',55]],
      kick:[['forward',0],['attack',55],['kick',120]],
      special:[['guard',0],['forward',65],['special',135]],
      hurt:[['idle',0],['hurt',45]]
    };
    (sequences[pose]||[[pose,0]]).forEach(([frame,at])=>{
      const apply=()=>{if(f.poseToken===token)setFrame(f,who,frame)};
      if(at===0)apply();else f.frameTimers.push(setTimeout(apply,at));
    });
    f.poseTimer=setTimeout(()=>{
      if(!f.guard)setFrame(f,who,'idle');
      f.el.classList.remove('attacking','hurt','special');
    },duration);
  }
  function passivePose(f,who,pose){
    if(f.busy>0||f.guard||f.currentPose===pose)return;
    setFrame(f,who,pose);
  }
  function bodyGap(a,b){return Math.max(0,Math.abs(a.x-b.x)-a.bodyRadius-b.bodyRadius)}
  function inAttackRange(attacker,defender,who,reach){
    const forward=who==='player'?defender.x-attacker.x:attacker.x-defender.x;
    return forward>=0&&forward<=attacker.bodyRadius+defender.bodyRadius+reach;
  }
  function queueStrike(attacker,defender,who,move,token,label){
    setTimeout(()=>{
      if(!state.running||state.cinematic||attacker.attackToken!==token)return;
      const activeUntil=performance.now()+move.active;
      function activeFrame(now){
        if(!state.running||state.cinematic||attacker.attackToken!==token)return;
        if(inAttackRange(attacker,defender,who,move.reach)){
          attacker.attackToken++;
          applyHit(attacker,defender,who,move.damage,move.strong,move.knockback);
          if(label)popup(label);
        }else if(now<activeUntil)requestAnimationFrame(activeFrame);
      }
      requestAnimationFrame(activeFrame);
    },move.startup);
  }
  function attack(attacker,defender,who){
    if(!state.running || state.cinematic || attacker.cooldown>0 || attacker.busy>0) return;
    if(performance.now()<attacker.counterReadyUntil){ counterAttack(attacker,defender,who); return; }
    const now=performance.now();
    attacker.comboStep=now<=attacker.comboExpires?(attacker.comboStep%3)+1:1;
    attacker.comboExpires=now+650;
    const step=attacker.comboStep,move=MOVES[step-1],duration=move.startup+move.active+move.recovery;
    attacker.cooldown=duration;attacker.attackToken++;const token=attacker.attackToken;
    setPose(attacker,who,move.pose,duration);
    beep(step===2?175:210,.05,step===3?'sawtooth':'square');
    queueStrike(attacker,defender,who,move,token,step+' HIT');
  }
  function applyHit(attacker,defender,who,base,strong=false,knockback=3){
    const guarded=defender.guard, damage=Math.max(1,Math.round(base*(guarded?.28:1)));
    defender.attackToken++;
    defender.hp=Math.max(0,defender.hp-damage);
    attacker.energy=Math.min(100,attacker.energy+(strong?7:15)); defender.energy=Math.min(100,defender.energy+7);
    const defenderWho=who==='player'?'cpu':'player';
    if(guarded){
      defender.counterReadyUntil=performance.now()+650;
      defender.el.classList.add('counter-ready');
      setTimeout(()=>{if(performance.now()>=defender.counterReadyUntil)defender.el.classList.remove('counter-ready')},670);
      popup('可反击!');
      if(defenderWho==='cpu'&&defender.aiState==='guard')setTimeout(()=>counterAttack(defender,attacker,'cpu'),190);
    } else setPose(defender,defenderWho,'hurt',360);
    defender.x+=(attacker.x<defender.x?1:-1)*knockback; defender.x=Math.max(8,Math.min(92,defender.x));
    hitEffect(defender,damage,strong,guarded); updateHud(); position();
    beep(guarded?110:70,strong?.16:.08,guarded?'triangle':'sawtooth');
    if(defender.hp<=0)finish(who,'KO');
  }
  function counterAttack(attacker,defender,who){
    if(!state.running||state.cinematic||performance.now()>=attacker.counterReadyUntil)return;
    attacker.counterReadyUntil=0; attacker.el.classList.remove('counter-ready');
    const duration=COUNTER_MOVE.startup+COUNTER_MOVE.active+COUNTER_MOVE.recovery;
    guard(attacker,false,who);attacker.cooldown=duration;attacker.attackToken++;const token=attacker.attackToken;
    setPose(attacker,who,'special',duration);popup('COUNTER!');
    beep(360,.11,'square');
    queueStrike(attacker,defender,who,COUNTER_MOVE,token,'反击命中');
  }
  function launchAssist(attacker,defender,who){
    if(!state.running||state.cinematic||attacker.cooldown>0||attacker.busy>0)return;
    if(!assetAvailable(art[who].special)||!assetAvailable(assistArt[who])){popup('援助准备中');return;}
    if(attacker.energy<40){beep(150,.06,'square');popup('能量不足');return;}
    attacker.energy-=40; attacker.cooldown=1300; setPose(attacker,who,'special',980); updateHud();
    beep(310,.14,'sawtooth');showUltimate(who,()=>spawnAssist(attacker,defender,who));
  }
  function showUltimate(who,done){
    state.cinematic=true;keys.clear();
    ultimateCutIn.className='ultimate-cut-in '+(who==='cpu'?'cpu-cut ':'')+'play';
    $('ultMain').src=loadedAsset(art[who].special);$('ultHelper').src=loadedAsset(assistArt[who]);
    $('ultMain').alt=who==='player'?'赵颖必杀':'钟雅静必杀';$('ultHelper').alt=who==='player'?'王艺菡':'龚陶然';
    $('ultTitle').textContent=who==='player'?'赵颖 × 王艺菡 · 飞援':'钟雅静 × 龚陶然 · 突击';
    game.classList.add('special-flash');beep(who==='player'?330:260,.32,'sawtooth');
    setTimeout(()=>{
      ultimateCutIn.className='ultimate-cut-in hidden';game.classList.remove('special-flash');state.cinematic=false;state.last=performance.now();done();
    },1050);
  }
  function spawnAssist(attacker,defender,who){
    if(!state.running)return;
    const shot=document.createElement('img'); shot.className='assist-projectile '+(who==='cpu'?'cpu-shot':''); shot.src=loadedAsset(assistArt[who]); shot.alt=who==='player'?'王艺菡援助':'龚陶然援助'; stage.appendChild(shot);
    const start=attacker.x+(who==='player'?6:-6), end=who==='player'?106:-6, started=performance.now(); let hit=false;
    function fly(now){
      if(!shot.isConnected)return; const t=Math.min(1,(now-started)/720), x=start+(end-start)*t; shot.style.left=x+'%';
      shot.style.bottom=(21+Math.sin(t*Math.PI)*8)+'%';
      if(!hit&&state.running&&Math.abs(x-defender.x)<8){hit=true;applyHit(attacker,defender,who,18,true,9);popup(who==='player'?'王艺菡出击!':'龚陶然出击!');}
      if(t<1&&state.running)requestAnimationFrame(fly);else shot.remove();
    }
    requestAnimationFrame(fly);
  }
  function popup(text){combatToast.textContent=text;combatToast.classList.remove('show');void combatToast.offsetWidth;combatToast.classList.add('show');}
  function hitEffect(target,damage,special,guarded){
    const box=target.el.getBoundingClientRect(), host=game.getBoundingClientRect();
    const fx=document.createElement('div'); fx.className='hit-fx'+(special?' special-hit':'');
    fx.style.left=(box.left-host.left+box.width/2)+'px'; fx.style.top=(box.top-host.top+box.height*.42)+'px'; game.appendChild(fx); setTimeout(()=>fx.remove(),420);
    const num=document.createElement('div'); num.className='damage'; num.textContent=guarded?'挡':('-'+damage);
    num.style.left=(box.left-host.left+box.width*.35)+'px'; num.style.top=(box.top-host.top+box.height*.2)+'px'; game.appendChild(num); setTimeout(()=>num.remove(),750);
    game.classList.remove('shake'); void game.offsetWidth; game.classList.add('shake'); setTimeout(()=>game.classList.remove('shake'),300);
  }
  function guard(f,on,who){
    const next=on&&f.busy<=0;
    if(next===f.guard)return;
    f.guard=next;f.el.classList.toggle('guarding',next);
    setFrame(f,who,next?'guard':'idle');
  }
  function announce(text){ announcer.textContent=text; announcer.classList.remove('show'); void announcer.offsetWidth; announcer.classList.add('show'); }
  function finish(winner,reason){
    if(!state.running)return; state.running=false; announce(reason);
    const draw=winner==='draw', playerWon=winner==='player';
    clearTimeout(state.player.poseTimer);clearTimeout(state.cpu.poseTimer);
    if(!draw){
      const victor=playerWon?state.player:state.cpu, loser=playerWon?state.cpu:state.player;
      const victorWho=playerWon?'player':'cpu', loserWho=playerWon?'cpu':'player';
      setFrame(victor,victorWho,'victory');setFrame(loser,loserWho,'hurt');
    }
    setTimeout(()=>{
      $('resultTitle').textContent=draw?'平局':(playerWon?'赵颖获胜':'钟雅静获胜');
      $('resultText').textContent=draw?'两个人都没有分出胜负。':(playerWon?'漂亮的放学后一击！':'钟雅静抓住了破绽。再试一次吧。');
      $('endOverlay').classList.remove('hidden');
    },850);
  }
  function setAIState(c,name,duration,now=performance.now()){
    if(name==='combo'&&c.aiState!=='combo')c.aiComboRemaining=3;
    c.aiState=name;c.aiUntil=now+duration;c.el.dataset.aiState=name;
    c.el.classList.toggle('charging',name==='charge');
    if(name!=='guard')guard(c,false,'cpu');
  }
  function chooseAIState(now){
    const c=state.cpu,p=state.player,gap=bodyGap(c,p);
    const playerThreat=p.busy>0&&['forward','attack','kick','special'].includes(p.currentPose)&&inAttackRange(p,c,'player',MOVES[2].reach+1);
    if(playerThreat){setAIState(c,'guard',360,now);return}
    if(gap<1.6&&(c.cooldown>0||p.counterReadyUntil>now)){setAIState(c,'retreat',520,now);return}
    if(c.energy<15&&gap>10){setAIState(c,'charge',850,now);return}
    if(gap>5.5){setAIState(c,'approach',900,now);return}
    setAIState(c,'combo',1250,now);
  }
  function cpuThink(dt,now){
    const c=state.cpu,p=state.player;
    if(c.busy>0)return;
    const pressure=bodyGap(c,p)<=MOVES[2].reach&&p.comboStep===3&&p.comboExpires>now;
    if(pressure&&c.aiState!=='guard'){setAIState(c,'guard',420,now)}
    if(!c.aiState||now>=c.aiUntil)chooseAIState(now);
    const gap=bodyGap(c,p);
    switch(c.aiState){
      case 'approach':
        guard(c,false,'cpu');
        if(gap<=4.5){setAIState(c,'combo',1250,now);passivePose(c,'cpu','idle');break}
        c.x-=dt*.018;passivePose(c,'cpu','forward');
        break;
      case 'retreat':
        guard(c,false,'cpu');c.x+=dt*.015;passivePose(c,'cpu','idle');
        break;
      case 'guard':
        guard(c,true,'cpu');
        break;
      case 'charge':
        guard(c,false,'cpu');passivePose(c,'cpu','guard');c.energy=Math.min(100,c.energy+dt*.012);
        if(c.energy>=40)setAIState(c,gap>5.5?'approach':'combo',700,now);
        break;
      case 'combo':
        guard(c,false,'cpu');
        if(gap>MOVES[2].reach){setAIState(c,'approach',700,now);break}
        if(c.aiComboRemaining<=0){setAIState(c,'retreat',520,now);break}
        if(c.cooldown<=0){
          if(c.energy>=40&&gap>2.5){launchAssist(c,p,'cpu');setAIState(c,'retreat',700,now)}
          else{attack(c,p,'cpu');c.aiComboRemaining--}
        }
        break;
    }
    c.x=Math.max(p.x+MIN_CENTER_DISTANCE,Math.min(93,c.x));
  }
  function loop(now){
    if(!state.running)return;
    if(state.cinematic){state.last=now;requestAnimationFrame(loop);return;}
    const rawDt=Math.max(0,now-state.last),dt=Math.min(40,rawDt); state.last=now;
    const p=state.player,c=state.cpu;
    [p,c].forEach(f=>{
      f.cooldown=Math.max(0,f.cooldown-rawDt);f.busy=Math.max(0,f.busy-rawDt);
      if(f.counterReadyUntil&&now>=f.counterReadyUntil){f.counterReadyUntil=0;f.el.classList.remove('counter-ready');}
    });
    guard(p,keys.has('l'),'player');
    if(p.busy<=0&&!p.guard){
      const dir=(keys.has('d')?1:0)-(keys.has('a')?1:0);
      p.x+=dir*dt*.025;passivePose(p,'player',dir?'forward':'idle');
    }
    p.x=Math.max(7,Math.min(c.x-MIN_CENTER_DISTANCE,p.x));cpuThink(dt,now);c.x=Math.max(p.x+MIN_CENTER_DISTANCE,Math.min(93,c.x));
    state.timerAcc+=rawDt; if(state.timerAcc>=1000){state.time=Math.max(0,state.time-state.timerAcc/1000);state.timerAcc=0;if(state.time<=0)finish(p.hp===c.hp?'draw':(p.hp>c.hp?'player':'cpu'),'TIME');}
    position();updateHud();requestAnimationFrame(loop);
  }
  function keyDown(key){ key=key.toLowerCase(); keys.add(key); if(key==='j')attack(state.player,state.cpu,'player'); if(key==='k')launchAssist(state.player,state.cpu,'player'); }
  function keyUp(key){keys.delete(key.toLowerCase());}
  window.addEventListener('keydown',e=>{if(['a','d','j','k','l'].includes(e.key.toLowerCase())){e.preventDefault();keyDown(e.key)}});
  window.addEventListener('keyup',e=>keyUp(e.key));
  document.querySelectorAll('[data-key]').forEach(btn=>{
    const down=e=>{e.preventDefault();btn.classList.add('active');keyDown(btn.dataset.key)};
    const up=e=>{e.preventDefault();btn.classList.remove('active');keyUp(btn.dataset.key)};
    btn.addEventListener('pointerdown',down);btn.addEventListener('pointerup',up);btn.addEventListener('pointercancel',up);btn.addEventListener('pointerleave',up);
  });
  function beep(freq,duration,type){
    if(!state.sound)return; try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.35),audio.currentTime+duration);g.gain.setValueAtTime(.07,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}catch{}
  }
  $('sound').onclick=()=>{state.sound=!state.sound;$('sound').textContent=state.sound?'♪':'×'};
  $('startBtn').onclick=start;$('restartBtn').onclick=start;
  if(new URLSearchParams(location.search).has('qa'))window.__fightQA={state,attack,launchAssist,counterAttack,guard,setFrame,position,updateHud,bodyGap,inAttackRange,setAIState,cpuThink,MOVES,supportsWebP,loadedAsset};
  reset();preloadAssets();
})();
