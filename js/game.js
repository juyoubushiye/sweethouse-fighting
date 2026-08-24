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
  const spriteMetrics={
    player:{idle:[246,486],forward:[233,486],attack:[190,486],kick:[214,486],guard:[247,486],hurt:[284,486],victory:[171,486],special:[245,486]},
    cpu:{idle:[254,486],forward:[178,486],attack:[182,486],kick:[232,486],guard:[247,486],hurt:[194,486],victory:[184,482],special:[250,486]}
  };
  const assistArt = {
    player:'assets/chibi/helpers/wang-yihan-projectile.png',
    cpu:'assets/chibi/helpers/gong-taoran-projectile.png'
  };
  const corePoses=['idle','forward','attack','kick','guard','hurt'];
  const deferredPoses=['victory','special'];
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
  const PUSH_RADIUS=4.6,HURT_RADIUS=4.9;
  const MOVES=[
    {pose:'attack',startup:65,active:55,recovery:100,cancelStart:95,cancelEnd:205,reach:5.2,lunge:2.2,hitbox:{start:.13,end:.31},damage:7,knockback:3,strong:false,hitstop:40,hitstun:180,blockstun:110,guardDamage:10},
    {pose:'kick',startup:85,active:60,recovery:130,cancelStart:120,cancelEnd:260,reach:7,lunge:2.8,hitbox:{start:.12,end:.41},damage:9,knockback:3,strong:false,hitstop:50,hitstun:220,blockstun:120,guardDamage:13},
    {pose:'special',startup:120,active:75,recovery:260,cancelStart:0,cancelEnd:0,reach:9,lunge:3.6,hitbox:{start:.14,end:.43},damage:12,knockback:6,strong:true,hitstop:75,hitstun:320,blockstun:160,guardDamage:20}
  ];
  const HEAVY_MOVE={pose:'kick',startup:135,active:85,recovery:380,cancelStart:0,cancelEnd:0,reach:8.5,lunge:3.3,hitbox:{start:.12,end:.42},damage:16,knockback:7,strong:true,hitstop:90,hitstun:420,blockstun:190,guardDamage:30};
  const COUNTER_MOVE={pose:'special',startup:120,active:85,recovery:250,reach:8.5,lunge:4,hitbox:{start:.12,end:.44},damage:10,knockback:7,strong:true,hitstop:100,hitstun:420,blockstun:170,guardDamage:22};
  const state = {
    running:false, cinematic:false, time:60, last:0, timerAcc:0, sound:true, hitstopUntil:0,
    player:{el:$('player'),img:$('player').querySelector('img'),x:20,facing:1,hp:100,energy:0,cooldown:0,guard:false,guardGauge:100,guardRegenAt:0,guardBrokenUntil:0,blockstun:0,busy:0,pushRadius:PUSH_RADIUS,hurtRadius:HURT_RADIUS,motionOffset:0,comboStep:0,comboExpires:0,comboWindow:0,counterReadyUntil:0,attackToken:0,dashRemaining:0,dashVelocity:0,rollRemaining:0,rollDuration:0,rollStartX:0,rollTargetX:0,rollCooldown:0,invulnerableUntil:0,currentMove:null,moveStartedAt:0,action:null,poseState:null,inputBuffer:null},
    cpu:{el:$('cpu'),img:$('cpu').querySelector('img'),x:80,facing:-1,hp:100,energy:0,cooldown:0,guard:false,guardGauge:100,guardRegenAt:0,guardBrokenUntil:0,blockstun:0,busy:0,pushRadius:PUSH_RADIUS,hurtRadius:HURT_RADIUS,motionOffset:0,comboStep:0,comboExpires:0,comboWindow:0,counterReadyUntil:0,attackToken:0,dashRemaining:0,dashVelocity:0,rollRemaining:0,rollDuration:0,rollStartX:0,rollTargetX:0,rollCooldown:0,invulnerableUntil:0,currentMove:null,moveStartedAt:0,action:null,poseState:null,inputBuffer:null,aiState:'approach',aiUntil:0,aiComboRemaining:0,cpuCounterDelay:0}
  };
  let audio;
  function setFrame(f,who,pose){
    const src=art[who][pose], cached=assetCache.get(src);
    f.currentPose=pose;f.el.dataset.pose=pose;
    const nativeDirection=who==='player'?(['idle','guard'].includes(pose)?-1:1):(['forward','attack','kick'].includes(pose)?1:-1);
    const [anchor,baseline]=spriteMetrics[who][pose],mirrored=nativeDirection!==f.facing;
    const sourceShift=(256-anchor)/512*100;
    f.el.style.setProperty('--face-scale',mirrored?-1:1);
    f.el.style.setProperty('--sprite-shift',(mirrored?-sourceShift:sourceShift)+'%');
    f.el.style.setProperty('--sprite-lift',(486-baseline)/512*100+'%');
    // Online play used to replace the current frame before the next PNG had
    // arrived, briefly exposing the image alt text. Keep the last good frame
    // unless this one is known to be available.
    if(!failedAssets.has(src)&&(!assetsReady||cached?.complete&&cached.naturalWidth>0))f.img.src=loadedAsset(src);
  }
  function setMotion(f,motion=''){f.el.dataset.motion=motion;}
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
    Object.assign(f,{x,facing:who==='player'?1:-1,hp:100,energy:0,cooldown:0,guard:false,guardGauge:100,guardRegenAt:0,guardBrokenUntil:0,blockstun:0,busy:0,pushRadius:PUSH_RADIUS,hurtRadius:HURT_RADIUS,motionOffset:0,comboStep:0,comboExpires:0,comboWindow:0,counterReadyUntil:0,currentPose:'idle',attackToken:(f.attackToken||0)+1,dashRemaining:0,dashVelocity:0,rollRemaining:0,rollDuration:0,rollStartX:0,rollTargetX:0,rollCooldown:0,invulnerableUntil:0,currentMove:null,moveStartedAt:0,action:null,poseState:null,inputBuffer:null});
    if(who==='cpu')Object.assign(f,{aiState:'approach',aiUntil:0,aiComboRemaining:0,cpuCounterDelay:0});
    f.el.className = 'fighter ' + (who==='cpu'?'cpu face-left':'face-right');
    setMotion(f);
    if(who==='cpu')f.el.dataset.aiState='approach';
    setFrame(f,who,'idle');
  }
  function reset(){
    document.querySelectorAll('.assist-projectile').forEach(el=>el.remove());
    keys.clear();directionTap.a=0;directionTap.d=0;
    state.cinematic=false;state.hitstopUntil=0;game.classList.remove('hitstop');ultimateCutIn.className='ultimate-cut-in hidden';
    state.time=60; state.timerAcc=0; state.last=performance.now();
    resetFighter(state.player,20,'player'); resetFighter(state.cpu,80,'cpu');
    syncCollisionScale();updateHud();position();
  }
  function start(){
    if(!assetsReady)return;
    $('startOverlay').classList.add('hidden'); $('endOverlay').classList.add('hidden');
    reset(); state.running=true; announce('FIGHT!'); requestAnimationFrame(loop);
  }
  function position(){
    state.player.el.style.setProperty('--x',fighterCenter(state.player));
    state.cpu.el.style.setProperty('--x',fighterCenter(state.cpu));
  }
  function updateHud(){
    $('pHealth').style.width=state.player.hp+'%'; $('cHealth').style.width=state.cpu.hp+'%';
    $('pEnergy').style.width=Math.min(100,state.player.energy)+'%'; $('cEnergy').style.width=Math.min(100,state.cpu.energy)+'%';
    $('pGuard').style.width=state.player.guardGauge+'%';$('cGuard').style.width=state.cpu.guardGauge+'%';
    $('pGuard').classList.toggle('low',state.player.guardGauge<=30);$('cGuard').classList.toggle('low',state.cpu.guardGauge<=30);
    $('timer').textContent=String(Math.ceil(state.time)).padStart(2,'0');
  }
  function triggerHitstop(duration){
    const now=performance.now(),added=Math.max(0,now+duration-state.hitstopUntil);
    [state.player,state.cpu].forEach(f=>{
      if(f.currentMove)f.moveStartedAt+=added;
      for(const key of ['counterReadyUntil','guardBrokenUntil','guardRegenAt','invulnerableUntil'])if(f[key]>now)f[key]+=added;
      if(f.aiUntil>now)f.aiUntil+=added;
    });
    state.hitstopUntil=Math.max(state.hitstopUntil,now+duration);game.classList.add('hitstop');
  }
  function setPose(f,who,pose,duration=240){
    f.guard=false; f.el.classList.remove('guarding'); f.el.classList.remove('attacking','hurt','special');
    if(pose==='attack'||pose==='kick')f.el.classList.add('attacking');
    if(pose==='hurt')f.el.classList.add('hurt');
    if(pose==='special')f.el.classList.add('special');
    f.busy=Math.max(f.busy,duration);
    const sequences={
      attack:[['forward',0,'windup'],['forward',18,'coil'],['attack',38,'extend'],['attack',65,'impact'],['attack',105,'recoil'],['forward',150,'settle']],
      kick:[['forward',0,'windup'],['attack',45,'extend'],['kick',95,'impact'],['kick',140,'recoil']],
      special:[['guard',0,'windup'],['forward',55,'extend'],['special',105,'impact']],
      hurt:[['idle',0,'windup'],['hurt',35,'impact']]
    };
    const sequence=sequences[pose]||[[pose,0,'']];
    f.poseState={who,pose,duration,elapsed:0,sequence,index:0};setFrame(f,who,sequence[0][0]);setMotion(f,sequence[0][2]);
  }
  function updatePose(f,dt){
    const pose=f.poseState;if(!pose)return;
    pose.elapsed+=dt;
    while(pose.index+1<pose.sequence.length&&pose.elapsed>=pose.sequence[pose.index+1][1]){
      pose.index++;setFrame(f,pose.who,pose.sequence[pose.index][0]);setMotion(f,pose.sequence[pose.index][2]);
    }
    if(pose.elapsed>=pose.duration){
      f.poseState=null;setMotion(f);if(!f.guard)setFrame(f,pose.who,'idle');
      f.el.classList.remove('attacking','hurt','special');
    }
  }
  function passivePose(f,who,pose){
    if(f.busy>0||f.guard||f.currentPose===pose)return;
    setMotion(f);setFrame(f,who,pose);
  }
  function fighterCenter(f){return f.x+(f.motionOffset||0)}
  function pushCenter(f){return f.x}
  function directionBetween(from,to){return fighterCenter(to)>=fighterCenter(from)?1:-1}
  function directionFor(who,attacker,defender){
    if(attacker&&defender)return directionBetween(attacker,defender);
    const f=who==='player'?state.player:state.cpu;return f.action?.direction||f.facing||(who==='player'?1:-1);
  }
  function setFacing(f,opponent,who,force=false){
    if(!force&&(f.action||f.rollRemaining>0))return;
    const next=directionBetween(f,opponent);if(next===f.facing)return;
    f.facing=next;f.el.classList.toggle('face-right',next>0);f.el.classList.toggle('face-left',next<0);
    if(f.currentPose)setFrame(f,who,f.currentPose);
  }
  function updateFacing(force=false){setFacing(state.player,state.cpu,'player',force);setFacing(state.cpu,state.player,'cpu',force)}
  function syncCollisionScale(){
    const stageWidth=stage.getBoundingClientRect().width||1;
    [state.player,state.cpu].forEach(f=>{
      const renderedRatio=f.el.getBoundingClientRect().width/stageWidth*100;
      f.spriteRatio=renderedRatio;
      f.pushRadius=Math.max(PUSH_RADIUS,renderedRatio*.24);
      f.hurtRadius=Math.max(HURT_RADIUS,renderedRatio*.25);
    });
    resolvePushboxes();limitMotionOffsets();
  }
  function clampFighter(f){f.x=Math.max(7,Math.min(93,f.x))}
  function resolvePushboxes(a=state.player,b=state.cpu){
    clampFighter(a);clampFighter(b);if(a.rollRemaining>0||b.rollRemaining>0)return;
    let left=a,right=b;if(pushCenter(left)>pushCenter(right))[left,right]=[right,left];
    const minimum=left.pushRadius+right.pushRadius,gap=pushCenter(right)-pushCenter(left);
    if(gap>=minimum)return;
    const overlap=minimum-gap;left.x-=overlap/2;right.x+=overlap/2;clampFighter(left);clampFighter(right);
    const remaining=minimum-(pushCenter(right)-pushCenter(left));
    if(remaining>0){
      const rightRoom=93-pushCenter(right),shiftRight=Math.min(remaining,rightRoom);right.x+=shiftRight;left.x-=remaining-shiftRight;
      clampFighter(left);clampFighter(right);
    }
  }
  function limitMotionOffsets(a=state.player,b=state.cpu){
    if(a.rollRemaining>0||b.rollRemaining>0)return;
    let left=a,right=b;if(pushCenter(left)>pushCenter(right))[left,right]=[right,left];
    const available=Math.max(0,pushCenter(right)-pushCenter(left)-left.pushRadius-right.pushRadius);
    const closing=Math.max(0,left.motionOffset)-Math.min(0,right.motionOffset);
    if(closing>available&&closing>0){const scale=available/closing;left.motionOffset=Math.max(0,left.motionOffset)*scale;right.motionOffset=Math.min(0,right.motionOffset)*scale}
  }
  function bodyGap(a,b){return Math.max(0,Math.abs(fighterCenter(a)-fighterCenter(b))-a.pushRadius-b.pushRadius)}
  function attackBox(attacker,whoOrDirection,move){
    const direction=typeof whoOrDirection==='number'?whoOrDirection:directionFor(whoOrDirection,attacker,whoOrDirection==='player'?state.cpu:state.player),hitbox=move.hitbox;
    if(hitbox?.start!==undefined){
      const start=hitbox.start*attacker.spriteRatio,end=hitbox.end*attacker.spriteRatio;
      return {center:fighterCenter(attacker)+direction*(start+end)/2,radius:(end-start)/2,start,end};
    }
    const fallback=hitbox||{offset:move.reach*.5,radius:move.reach*.5};
    return {center:fighterCenter(attacker)+direction*(attacker.pushRadius+fallback.offset),radius:fallback.radius};
  }
  function hurtBox(f){return {center:fighterCenter(f),radius:f.hurtRadius}}
  function inAttackRange(attacker,defender,whoOrDirection,moveOrReach){
    const direction=typeof whoOrDirection==='number'?whoOrDirection:directionFor(whoOrDirection,attacker,defender);
    if(typeof moveOrReach==='number'){
      const forward=direction*(fighterCenter(defender)-fighterCenter(attacker));
      return forward>=0&&forward<=attacker.pushRadius+defender.hurtRadius+moveOrReach;
    }
    const hit=attackBox(attacker,direction,moveOrReach),hurt=hurtBox(defender);
    return Math.abs(hit.center-hurt.center)<=hit.radius+hurt.radius;
  }
  function cancelAction(f){f.attackToken++;f.action=null;f.currentMove=null;f.motionOffset=0;}
  function actionLunge(action){
    const move=action.move,elapsed=action.elapsed,lunge=move.lunge||0;
    if(elapsed<move.startup){const t=Math.max(0,elapsed/move.startup);return lunge*t*t*(3-2*t)}
    if(elapsed<=move.startup+move.active)return lunge;
    return lunge*Math.max(0,1-(elapsed-move.startup-move.active)/move.recovery);
  }
  function advanceAction(attacker,dt){
    const action=attacker.action;if(!action)return;
    action.elapsed+=dt;attacker.motionOffset=action.direction*actionLunge(action);
  }
  function resolveActionHit(attacker){
    const action=attacker.action;if(!action)return;
    const activeEnd=action.move.startup+action.move.active;
    if(!action.connected&&action.elapsed>=action.move.startup&&action.elapsed<=activeEnd&&inAttackRange(attacker,action.defender,action.direction,action.move)){
      const wasGuarding=action.defender.guard;
      action.connected=applyHit(attacker,action.defender,action.who,action.move.damage,action.move.strong,action.move.knockback,action.move.hitstun,action.move.blockstun,action.move.guardDamage,action.move.hitstop);
      if(action.connected&&action.label&&!wasGuarding)popup(action.label);
    }
  }
  function finishAction(attacker){
    if(attacker.action&&attacker.action.elapsed>=attacker.action.duration){attacker.action=null;attacker.currentMove=null;attacker.motionOffset=0}
  }
  function updateActions(dt){
    advanceAction(state.player,dt);advanceAction(state.cpu,dt);resolvePushboxes();limitMotionOffsets();
    resolveActionHit(state.player);resolveActionHit(state.cpu);finishAction(state.player);finishAction(state.cpu);
  }
  function attack(attacker,defender,who,kind='light'){
    if(!state.running||state.cinematic)return false;
    const now=performance.now(),direction=directionBetween(attacker,defender);attacker.facing=direction;
    if(now<attacker.counterReadyUntil){counterAttack(attacker,defender,who);return true}
    const elapsed=attacker.action?.elapsed||0,canCancel=attacker.currentMove?.cancelEnd>0&&elapsed>=attacker.currentMove.cancelStart&&elapsed<=attacker.currentMove.cancelEnd;
    if(attacker.cooldown>0||attacker.busy>0){
      if(!canCancel)return false;
      cancelAction(attacker);attacker.cooldown=0;attacker.busy=0;attacker.poseState=null;
    }
    let step=0,move;
    if(kind==='heavy'){
      attacker.comboStep=0;attacker.comboExpires=0;move=HEAVY_MOVE;
    }else{
      attacker.comboStep=attacker.comboWindow>0?(attacker.comboStep%3)+1:1;
      attacker.comboWindow=650;attacker.comboExpires=now+650;step=attacker.comboStep;move=MOVES[step-1];
    }
    const duration=move.startup+move.active+move.recovery;
    attacker.cooldown=duration;attacker.attackToken++;
    attacker.currentMove=move;attacker.moveStartedAt=now;attacker.motionOffset=0;
    attacker.action={move,defender,who,direction,elapsed:0,duration,connected:false,label:kind==='heavy'?'重击':step+' HIT'};
    setPose(attacker,who,move.pose,duration);
    beep(kind==='heavy'?135:(step===2?175:210),kind==='heavy'?0.09:0.05,(kind==='heavy'||step===3)?'sawtooth':'square');
    return true;
  }
  function applyHit(attacker,defender,who,base,strong=false,knockback=3,hitstun=360,blockstun=150,guardDamage=Math.round(base*1.5),hitstop=strong?95:60){
    const now=performance.now();
    if(now<defender.invulnerableUntil)return false;
    let guarded=defender.guard&&now>=defender.guardBrokenUntil,broken=false;
    if(guarded){
      defender.guardGauge=Math.max(0,defender.guardGauge-guardDamage);defender.guardRegenAt=now+900;
      if(defender.guardGauge<=0){guarded=false;broken=true;defender.guard=false;defender.blockstun=0;defender.guardBrokenUntil=now+900;defender.guardRegenAt=now+1350;defender.el.classList.remove('guarding','counter-ready');}
    }
    const damage=Math.max(1,Math.round(base*(broken?.65:(guarded?.28:1))));
    cancelAction(defender);defender.inputBuffer=null;defender.cooldown=0;defender.busy=0;defender.poseState=null;
    defender.dashRemaining=0;defender.el.classList.remove('dashing','backstepping');
    defender.hp=Math.max(0,defender.hp-damage);
    attacker.energy=Math.min(100,attacker.energy+(strong?7:15)); defender.energy=Math.min(100,defender.energy+7);
    const defenderWho=who==='player'?'cpu':'player';
    if(guarded){
      defender.blockstun=blockstun;defender.busy=Math.max(defender.busy,blockstun);
      defender.counterReadyUntil=now+650;
      defender.el.classList.add('counter-ready');
      popup('可反击!');
      if(defenderWho==='cpu'&&defender.aiState==='guard')defender.cpuCounterDelay=190;
    }else{
      if(broken)popup('破防!');
      setPose(defender,defenderWho,'hurt',broken?Math.max(700,hitstun):hitstun);
    }
    defender.x+=(fighterCenter(attacker)<fighterCenter(defender)?1:-1)*knockback;clampFighter(defender);resolvePushboxes();limitMotionOffsets();
    hitEffect(defender,damage,strong,guarded); updateHud(); position();
    triggerHitstop(guarded?Math.round(hitstop*.55):hitstop);
    beep(guarded?110:70,strong?.16:.08,guarded?'triangle':'sawtooth');
    if(defender.hp<=0)finish(who,'KO');
    return true;
  }
  function counterAttack(attacker,defender,who){
    if(!state.running||state.cinematic||performance.now()>=attacker.counterReadyUntil)return;
    attacker.counterReadyUntil=0; attacker.el.classList.remove('counter-ready');
    const duration=COUNTER_MOVE.startup+COUNTER_MOVE.active+COUNTER_MOVE.recovery;
    attacker.blockstun=0;guard(attacker,false,who);attacker.cooldown=duration;attacker.attackToken++;
    const direction=directionBetween(attacker,defender);attacker.facing=direction;
    attacker.currentMove=COUNTER_MOVE;attacker.moveStartedAt=performance.now();attacker.motionOffset=0;
    attacker.action={move:COUNTER_MOVE,defender,who,direction,elapsed:0,duration,connected:false,label:'反击命中'};
    setPose(attacker,who,'special',duration);popup('COUNTER!');
    beep(360,.11,'square');
  }
  function launchAssist(attacker,defender,who){
    if(!state.running||state.cinematic||attacker.cooldown>0||attacker.busy>0)return;
    if(!assetAvailable(art[who].special)||!assetAvailable(assistArt[who])){popup('援助准备中');return;}
    if(attacker.energy<100){beep(150,.06,'square');popup('能量未满');return;}
    attacker.energy=0; attacker.cooldown=1300; setPose(attacker,who,'special',980); updateHud();
    beep(310,.14,'sawtooth');showUltimate(who,()=>spawnAssist(attacker,defender,who));
  }
  function showUltimate(who,done){
    state.cinematic=true;keys.clear();state.player.inputBuffer=null;
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
    const direction=directionBetween(attacker,defender),shot=document.createElement('img');shot.className='assist-projectile '+(who==='cpu'?'cpu-shot ':'')+(direction<0?'face-left':'');shot.src=loadedAsset(assistArt[who]);shot.alt=who==='player'?'王艺菡援助':'龚陶然援助';stage.appendChild(shot);
    const start=fighterCenter(attacker)+direction*6,end=direction>0?106:-6,started=performance.now();let hit=false;
    function fly(now){
      if(!shot.isConnected)return; const t=Math.min(1,(now-started)/720), x=start+(end-start)*t; shot.style.left=x+'%';
      shot.style.bottom=(21+Math.sin(t*Math.PI)*8)+'%';
      if(!hit&&state.running&&Math.abs(x-fighterCenter(defender))<8){hit=true;applyHit(attacker,defender,who,18,true,9);popup(who==='player'?'王艺菡出击!':'龚陶然出击!');}
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
    const now=performance.now(),locked=f.guard&&f.blockstun>0;
    const next=locked||(on&&f.busy<=0&&f.guardGauge>0&&now>=f.guardBrokenUntil);
    if(next===f.guard)return;
    f.guard=next;f.poseState=null;setMotion(f);f.el.classList.toggle('guarding',next);
    setFrame(f,who,next?'guard':'idle');
  }
  function announce(text){ announcer.textContent=text; announcer.classList.remove('show'); void announcer.offsetWidth; announcer.classList.add('show'); }
  function finish(winner,reason){
    if(!state.running)return; state.running=false; announce(reason);
    const draw=winner==='draw', playerWon=winner==='player';
    state.player.poseState=null;state.cpu.poseState=null;state.player.action=null;state.cpu.action=null;
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
    const playerThreat=p.busy>0&&['forward','attack','kick','special'].includes(p.currentPose)&&bodyGap(p,c)<=MOVES[2].reach+1;
    if(playerThreat&&c.guardGauge>0&&now>=c.guardBrokenUntil){setAIState(c,'guard',360,now);return}
    if(c.guardGauge<=25&&gap<8){setAIState(c,'retreat',620,now);return}
    if(gap<1.6&&(c.cooldown>0||p.counterReadyUntil>now)){setAIState(c,'retreat',520,now);return}
    if(c.energy<100&&gap>10){setAIState(c,'charge',850,now);return}
    if(gap>5.5){setAIState(c,'approach',900,now);return}
    setAIState(c,'combo',1250,now);
  }
  function cpuThink(dt,now){
    const c=state.cpu,p=state.player;
    if(c.busy>0)return;
    setFacing(c,p,'cpu');
    const pressure=bodyGap(c,p)<=MOVES[2].reach&&p.comboStep===3&&p.comboWindow>0;
    if(pressure&&c.aiState!=='guard'&&c.guardGauge>0&&now>=c.guardBrokenUntil){setAIState(c,'guard',420,now)}
    if(!c.aiState||now>=c.aiUntil)chooseAIState(now);
    const gap=bodyGap(c,p);
    switch(c.aiState){
      case 'approach':
        guard(c,false,'cpu');
        if(gap<=4.5){setAIState(c,'combo',1250,now);passivePose(c,'cpu','idle');break}
        c.x+=directionBetween(c,p)*dt*.018;passivePose(c,'cpu','forward');
        break;
      case 'retreat':
        guard(c,false,'cpu');c.x-=directionBetween(c,p)*dt*.015;passivePose(c,'cpu','idle');
        break;
      case 'guard':
        guard(c,true,'cpu');
        break;
      case 'charge':
        guard(c,false,'cpu');passivePose(c,'cpu','guard');c.energy=Math.min(100,c.energy+dt*.012);
        if(c.energy>=100)setAIState(c,gap>5.5?'approach':'combo',700,now);
        break;
      case 'combo':
        guard(c,false,'cpu');
        if(gap>MOVES[2].reach){setAIState(c,'approach',700,now);break}
        if(c.aiComboRemaining<=0){setAIState(c,'retreat',520,now);break}
        if(c.cooldown<=0){
          if(c.energy>=100&&gap>2.5){launchAssist(c,p,'cpu');setAIState(c,'retreat',700,now)}
          else{attack(c,p,'cpu');c.aiComboRemaining--}
        }
        break;
    }
    clampFighter(c);resolvePushboxes(p,c);limitMotionOffsets(p,c);
  }
  function startDash(f,direction,who){
    const opponent=who==='player'?state.cpu:state.player,backstep=direction===-directionBetween(f,opponent);
    if(!state.running||state.cinematic||f.busy>0||f.rollRemaining>0)return false;
    if(f.guard){if(!backstep)return false;guard(f,false,who)}
    const duration=backstep?180:150;
    cancelAction(f);f.comboStep=0;f.comboExpires=0;
    f.dashRemaining=duration;f.dashVelocity=direction*(backstep?0.045:0.055);f.busy=duration;
    if(backstep)f.invulnerableUntil=performance.now()+90;
    f.el.classList.remove('dashing','backstepping');f.el.classList.add(backstep?'backstepping':'dashing');
    setFrame(f,who,backstep?'idle':'forward');beep(backstep?260:320,.045,'triangle');return true;
  }
  function startRoll(f,opponent,who){
    if(!state.running||state.cinematic||f.busy>0||f.rollRemaining>0||f.rollCooldown>0)return false;
    const direction=directionBetween(f,opponent),duration=420,clearance=f.pushRadius+opponent.pushRadius+1;
    guard(f,false,who);cancelAction(f);f.dashRemaining=0;f.el.classList.remove('dashing','backstepping');
    let target=opponent.x+direction*clearance;
    if(target>93){opponent.x=Math.max(7,opponent.x-(target-93));target=93}
    if(target<7){opponent.x=Math.min(93,opponent.x+(7-target));target=7}
    f.facing=direction;f.rollDuration=duration;f.rollRemaining=duration;f.rollStartX=f.x;f.rollTargetX=target;f.rollCooldown=900;f.busy=duration;f.invulnerableUntil=performance.now()+duration;
    f.el.classList.add('rolling');f.poseState=null;setMotion(f,'roll');setFrame(f,who,'forward');beep(390,.08,'triangle');return true;
  }
  function updateRoll(f,opponent,who,dt){
    if(f.rollRemaining<=0)return false;
    f.rollRemaining=Math.max(0,f.rollRemaining-dt);const t=1-f.rollRemaining/f.rollDuration,eased=t*t*(3-2*t);
    f.x=f.rollStartX+(f.rollTargetX-f.rollStartX)*eased;clampFighter(f);
    if(f.rollRemaining<=0){
      f.x=f.rollTargetX;f.busy=0;f.el.classList.remove('rolling');setMotion(f);setFacing(f,opponent,who,true);setFrame(f,who,'idle');resolvePushboxes(f,opponent);popup('闪身!');
    }
    return true;
  }
  function loop(now){
    if(!state.running)return;
    if(state.cinematic){state.last=now;requestAnimationFrame(loop);return;}
    if(now<state.hitstopUntil){state.last=now;requestAnimationFrame(loop);return;}
    game.classList.remove('hitstop');
    const rawDt=Math.max(0,now-state.last),dt=Math.min(40,rawDt); state.last=now;
    const p=state.player,c=state.cpu;
    updateActions(rawDt);
    [p,c].forEach(f=>{
      const wasBusy=f.busy;f.cooldown=Math.max(0,f.cooldown-rawDt);f.busy=Math.max(0,f.busy-rawDt);f.blockstun=Math.max(0,f.blockstun-rawDt);f.rollCooldown=Math.max(0,f.rollCooldown-rawDt);
      f.comboWindow=Math.max(0,f.comboWindow-rawDt);updatePose(f,rawDt);
      if(wasBusy>0&&f.busy<=0&&!f.action)f.currentMove=null;
      if(f.counterReadyUntil&&now>=f.counterReadyUntil){f.counterReadyUntil=0;f.el.classList.remove('counter-ready');}
      if(!f.guard&&now>=f.guardRegenAt&&f.guardGauge<100)f.guardGauge=Math.min(100,f.guardGauge+rawDt*.018);
    });
    if(c.cpuCounterDelay>0){c.cpuCounterDelay=Math.max(0,c.cpuCounterDelay-rawDt);if(c.cpuCounterDelay<=0)counterAttack(c,p,'cpu')}
    processInputBuffer(rawDt);
    updateFacing();
    const dir=(keys.has('d')?1:0)-(keys.has('a')?1:0),retreating=dir!==0&&dir===-p.facing;
    if(p.rollRemaining<=0&&p.dashRemaining<=0)guard(p,retreating,'player');else guard(p,false,'player');
    if(updateRoll(p,c,'player',rawDt)){
      // Rolling intentionally ignores pushboxes until Zhao Ying has crossed the opponent.
    }else if(p.dashRemaining>0){
      p.x+=p.dashVelocity*dt;p.dashRemaining=Math.max(0,p.dashRemaining-rawDt);
      if(p.dashRemaining<=0){p.el.classList.remove('dashing','backstepping');if(!p.guard)setFrame(p,'player','idle')}
    }else if(p.busy<=0){
      if(retreating&&p.guard)p.x+=dir*dt*.014;
      else if(!p.guard){
      p.x+=dir*dt*.025;passivePose(p,'player',dir?'forward':'idle');
      }
    }
    clampFighter(p);resolvePushboxes(p,c);limitMotionOffsets(p,c);cpuThink(dt,now);resolvePushboxes(p,c);limitMotionOffsets(p,c);
    state.timerAcc+=rawDt; if(state.timerAcc>=1000){state.time=Math.max(0,state.time-state.timerAcc/1000);state.timerAcc=0;if(state.time<=0)finish(p.hp===c.hp?'draw':(p.hp>c.hp?'player':'cpu'),'TIME');}
    position();updateHud();requestAnimationFrame(loop);
  }
  const directionTap={a:0,d:0},KEYBOARD_BUFFER=120,MOBILE_BUFFER=150;
  function requestAttack(kind,bufferWindow=KEYBOARD_BUFFER){
    if(!state.running||state.cinematic)return false;
    if(performance.now()>=state.hitstopUntil&&attack(state.player,state.cpu,'player',kind)){state.player.inputBuffer=null;return true}
    state.player.inputBuffer={kind,remaining:bufferWindow};return false;
  }
  function processInputBuffer(dt){
    const buffered=state.player.inputBuffer;if(!buffered)return;
    buffered.remaining-=dt;
    if(buffered.remaining<=0){state.player.inputBuffer=null;return}
    if(attack(state.player,state.cpu,'player',buffered.kind))state.player.inputBuffer=null;
  }
  function keyDown(key,bufferWindow=KEYBOARD_BUFFER){
    key=key.toLowerCase();const firstPress=!keys.has(key);keys.add(key);
    if(key==='j'||key==='i'){if(firstPress)requestAttack(key==='i'?'heavy':'light',bufferWindow);return}
    if((key==='a'||key==='d')&&firstPress){
      const now=performance.now();if(now-directionTap[key]<=260)startDash(state.player,key==='d'?1:-1,'player');directionTap[key]=now;
    }
    if(key==='l'&&firstPress)startRoll(state.player,state.cpu,'player');
    if(key==='k')launchAssist(state.player,state.cpu,'player');
  }
  function keyUp(key){keys.delete(key.toLowerCase());}
  window.addEventListener('keydown',e=>{const raw=e.key.toLowerCase(),key=raw==='j'&&e.shiftKey?'i':raw;if(['a','d','j','i','k','l'].includes(key)){e.preventDefault();if(!e.repeat)keyDown(key)}});
  window.addEventListener('keyup',e=>{keyUp(e.key);if(e.key.toLowerCase()==='j')keyUp('i')});
  window.addEventListener('resize',()=>{syncCollisionScale();position()});
  document.querySelectorAll('[data-key]').forEach(btn=>{
    const down=e=>{e.preventDefault();btn.classList.add('active');try{btn.setPointerCapture(e.pointerId)}catch{}keyDown(btn.dataset.key,MOBILE_BUFFER)};
    const up=e=>{e.preventDefault();btn.classList.remove('active');keyUp(btn.dataset.key)};
    btn.addEventListener('pointerdown',down);btn.addEventListener('pointerup',up);btn.addEventListener('pointercancel',up);
  });
  function beep(freq,duration,type){
    if(!state.sound)return; try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.35),audio.currentTime+duration);g.gain.setValueAtTime(.07,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);o.connect(g).connect(audio.destination);o.start();o.stop(audio.currentTime+duration);}catch{}
  }
  $('sound').onclick=()=>{state.sound=!state.sound;$('sound').textContent=state.sound?'♪':'×'};
  $('startBtn').onclick=start;$('restartBtn').onclick=start;
  if(new URLSearchParams(location.search).has('qa'))window.__fightQA={state,reset,attack,requestAttack,processInputBuffer,updateActions,triggerHitstop,applyHit,launchAssist,counterAttack,guard,setFrame,position,updateHud,syncCollisionScale,fighterCenter,pushCenter,bodyGap,attackBox,hurtBox,inAttackRange,resolvePushboxes,limitMotionOffsets,spriteMetrics,setFacing,updateFacing,setAIState,cpuThink,startDash,startRoll,updateRoll,MOVES,HEAVY_MOVE,supportsWebP,loadedAsset};
  reset();preloadAssets();
})();
