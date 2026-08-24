const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync(edgePath)?{executablePath:edgePath}:{}) });
  const errors = [];
  for (const profile of [
    { name: 'desktop', viewport: { width: 1180, height: 720 }, mobile: false },
    { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
  ]) {
    const page = await browser.newPage({ viewport: profile.viewport, isMobile: profile.mobile });
    page.on('pageerror', error => errors.push(`${profile.name}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${profile.name}: ${message.text()}`); });
    const url = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/') + '?qa=1';
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => [...document.images].filter(image=>image.getAttribute('src')).every(image => image.complete && image.naturalWidth > 0));
    await page.waitForFunction(() => !document.querySelector('#startBtn').disabled);
    const manual=await page.evaluate(() => {
      const details=document.querySelector('.manual');details.open=true;
      return {desktop:/A \/ D/.test(details.textContent),roll:/无敌翻滚/.test(details.textContent),mobile:/手机操作/.test(details.textContent),ultimate:/满 100/.test(details.textContent),scrollable:document.querySelector('.start-panel').scrollHeight>=document.querySelector('.start-panel').clientHeight};
    });
    if(!manual.desktop||!manual.roll||!manual.mobile||!manual.ultimate)errors.push(`${profile.name}: control manual incomplete ${JSON.stringify(manual)}`);
    await page.locator('.manual').evaluate(el=>el.open=false);
    const delivery = await page.evaluate(() => ({
      webp:window.__fightQA.supportsWebP,
      fighter:document.querySelector('#player img').src,
      arena:document.querySelector('.arena-bg').currentSrc,
      titleStroke:parseFloat(getComputedStyle(document.querySelector('.ult-title')).webkitTextStrokeWidth),
      titleWeight:parseInt(getComputedStyle(document.querySelector('.ult-title')).fontWeight,10)
    }));
    if(delivery.webp&&!delivery.fighter.endsWith('.webp'))errors.push(`${profile.name}: WebP fighter delivery missing`);
    if(profile.mobile&&delivery.webp&&!delivery.arena.endsWith('arena-mobile.webp'))errors.push(`${profile.name}: mobile arena optimization missing`);
    if(profile.mobile&&(delivery.titleStroke>2||delivery.titleWeight>700))errors.push(`${profile.name}: mobile ultimate typography is too heavy`);
    await page.click('#startBtn');
    if(profile.name==='desktop'){
      await page.evaluate(() => {
        const cpu=document.querySelector('#cpu');window.__qaAIStates=[cpu.dataset.aiState];
        new MutationObserver(()=>window.__qaAIStates.push(cpu.dataset.aiState)).observe(cpu,{attributes:true,attributeFilter:['data-ai-state']});
      });
      await page.waitForTimeout(5000);
      const autonomousStates=await page.evaluate(()=>[...new Set(window.__qaAIStates)]);
      if(!autonomousStates.includes('charge'))errors.push('desktop: autonomous AI never entered charge');
    }
    await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.position();q.updateHud();
    });
    const idleFacing = await page.locator('#player').evaluate(el => ({pose:el.dataset.pose,transform:getComputedStyle(el.querySelector('img')).transform}));
    if(idleFacing.pose!=='idle'||idleFacing.transform==='none')errors.push(`${profile.name}: Zhao Ying idle facing fix missing`);
    const guardFacing = await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player;q.guard(p,true,'player');
      const facing={pose:p.el.dataset.pose,transform:getComputedStyle(p.img).transform};q.guard(p,false,'player');return facing;
    });
    if(guardFacing.pose!=='guard'||guardFacing.transform==='none')errors.push(`${profile.name}: Zhao Ying guard does not face opponent`);
    const cpuFacing = await page.evaluate(() => {
      const q=window.__fightQA,c=q.state.cpu,read=()=>new DOMMatrix(getComputedStyle(c.img).transform).a;
      q.setFrame(c,'cpu','idle');const idle=read();q.setFrame(c,'cpu','forward');const forward=read();
      q.setFrame(c,'cpu','guard');const guard=read();q.setFrame(c,'cpu','idle');return {idle,forward,guard};
    });
    if(cpuFacing.idle<=0||cpuFacing.forward>=0||cpuFacing.guard<=0)errors.push(`${profile.name}: Zhong Yajing movement facing normalization missing ${JSON.stringify(cpuFacing)}`);

    const spriteAnchors = await page.evaluate(() => {
      const q=window.__fightQA,residuals=[];
      for(const who of ['player','cpu'])for(const [pose,[anchor,baseline]] of Object.entries(q.spriteMetrics[who])){
        const f=q.state[who==='player'?'player':'cpu'];q.setFrame(f,who,pose);
        const style=getComputedStyle(f.img),mirrored=new DOMMatrix(style.transform).a<0;
        const shift=parseFloat(f.el.style.getPropertyValue('--sprite-shift'))||0,lift=parseFloat(f.el.style.getPropertyValue('--sprite-lift'))||0;
        const displayedAnchor=mirrored?512-anchor:anchor;
        residuals.push({who,pose,x:Math.abs((displayedAnchor-256)/512*100+shift),y:Math.abs((baseline-486)/512*100+lift)});
      }
      q.setFrame(q.state.player,'player','idle');q.setFrame(q.state.cpu,'cpu','idle');return residuals;
    });
    const badAnchor=spriteAnchors.find(item=>item.x>.05||item.y>.05);
    if(badAnchor)errors.push(`${profile.name}: sprite anchor normalization failed ${JSON.stringify(badAnchor)}`);

    // Pushbox, hurtbox and per-move hitbox use the same normalized stage coordinates at every viewport size.
    const collisionGeometry = await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player,c=q.state.cpu;q.reset();q.setAIState(c,'test',1e9);p.x=20;c.x=60;q.position();
      q.attack(p,c,'player','light');q.updateActions(q.MOVES[0].startup);q.position();
      const stage=document.querySelector('#stage').getBoundingClientRect(),fighter=p.el.getBoundingClientRect();
      const expected=stage.left+stage.width*q.fighterCenter(p)/100,actual=fighter.left+fighter.width/2;
      const hit=q.attackBox(p,'player',q.MOVES[0]),hurt=q.hurtBox(c),logicalLunge=q.fighterCenter(p)-20;
      const expectedHitEnd=p.spriteRatio*q.MOVES[0].hitbox.end,baseBefore=p.x;q.updateActions(q.MOVES[0].active+q.MOVES[0].recovery+1);const baseDrift=Math.abs(p.x-baseBefore);
      p.action=null;p.currentMove=null;p.motionOffset=0;p.x=45;c.x=50;q.resolvePushboxes(p,c);
      const pushGap=q.fighterCenter(c)-q.fighterCenter(p),minimum=p.pushRadius+c.pushRadius;
      p.x=80;c.x=90;p.hp=100;c.hp=100;q.applyHit(p,c,'player',7,false,7);const afterKnockback={center:q.fighterCenter(c),gap:q.fighterCenter(c)-q.fighterCenter(p)};
      const renderedRatio=fighter.width/stage.width*100,expectedPush=Math.max(4.6,renderedRatio*.24);
      return {alignment:Math.abs(actual-expected),logicalLunge,hitRadius:hit.radius,hitEnd:hit.end,expectedHitEnd,baseDrift,hurtRadius:hurt.radius,pushRadius:p.pushRadius,expectedPush,renderedRatio,pushGap,minimum,afterKnockback,separate:p.pushRadius!==p.hurtRadius&&hit.radius!==p.hurtRadius};
    });
    if(collisionGeometry.alignment>1||collisionGeometry.logicalLunge<1||collisionGeometry.baseDrift>.01||!collisionGeometry.separate||Math.abs(collisionGeometry.hitEnd-collisionGeometry.expectedHitEnd)>.01||Math.abs(collisionGeometry.pushRadius-collisionGeometry.expectedPush)>.05)errors.push(`${profile.name}: normalized collision geometry failed ${JSON.stringify(collisionGeometry)}`);
    if(profile.mobile&&collisionGeometry.pushRadius<=9)errors.push(`${profile.name}: responsive pushbox did not expand with the rendered fighter ${JSON.stringify(collisionGeometry)}`);
    if(collisionGeometry.pushGap+0.01<collisionGeometry.minimum||collisionGeometry.afterKnockback.center>93.01||collisionGeometry.afterKnockback.gap+0.01<collisionGeometry.minimum)errors.push(`${profile.name}: pushbox or immediate knockback resolution failed ${JSON.stringify(collisionGeometry)}`);

    // AI states must have stable, distinct behavior instead of random frame-to-frame choices.
    const aiBehavior = await page.evaluate(() => {
      const q=window.__fightQA,c=q.state.cpu,p=q.state.player,now=performance.now();c.attackToken++;p.attackToken++;c.busy=0;c.cooldown=0;c.hp=100;p.busy=0;p.cooldown=0;p.hp=100;p.x=20;c.x=70;
      q.setAIState(c,'approach',1000,now);q.cpuThink(100,now+1);const approached=c.x<70;
      const retreatStart=c.x;q.setAIState(c,'retreat',1000,now);q.cpuThink(100,now+2);const retreated=c.x>retreatStart;
      q.setAIState(c,'guard',1000,now);q.cpuThink(16,now+3);const guarded=c.guard;
      c.energy=0;q.setAIState(c,'charge',1000,now);q.cpuThink(100,now+4);const charged=c.energy>0&&c.el.classList.contains('charging');
      p.x=44;c.x=57;c.energy=0;q.setAIState(c,'combo',1000,now);
      for(let i=0;i<3;i++){q.cpuThink(0,now+10+i);c.attackToken++;c.busy=0;c.cooldown=0}
      q.cpuThink(0,now+20);const threeHitCombo=c.aiState==='retreat';
      q.setAIState(c,'test',1e9,now);q.guard(c,false,'cpu');c.x=80;p.x=20;q.position();return {approached,retreated,guarded,charged,threeHitCombo};
    });
    if(Object.values(aiBehavior).some(value=>!value))errors.push(`${profile.name}: AI state behavior incomplete ${JSON.stringify(aiBehavior)}`);

    // Light attacks start on keydown; heavy attacks use a separate key and never wait for a hold timer.
    await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.state.player.x=25;q.state.cpu.x=70;q.position();
    });
    await page.keyboard.down('j');
    const immediateLight=await page.evaluate(() => {
      const p=window.__fightQA.state.player;return {damage:p.currentMove?.damage,elapsed:p.action?.elapsed,buffer:p.inputBuffer};
    });
    await page.keyboard.up('j');
    if(immediateLight.damage!==7||immediateLight.elapsed>20||immediateLight.buffer)errors.push(`${profile.name}: light attack did not start on keydown ${JSON.stringify(immediateLight)}`);
    await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.state.player.x=44;q.state.cpu.x=57;q.position();
    });
    await page.keyboard.press('i');await page.waitForTimeout(175);
    const heavyState=await page.evaluate(() => {
      const q=window.__fightQA;return {damage:q.state.player.currentMove?.damage,cpuHp:q.state.cpu.hp,hitstop:q.state.hitstopUntil>performance.now()};
    });
    if(heavyState.damage!==16||heavyState.cpuHp>=100||!heavyState.hitstop)errors.push(`${profile.name}: independent heavy attack failed ${JSON.stringify(heavyState)}`);

    // An early second press is buffered until the first legal cancel frame.
    await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.state.player.x=25;q.state.cpu.x=70;q.position();
    });
    await page.keyboard.press('j');await page.waitForTimeout(35);await page.keyboard.press('j');
    const queued=await page.evaluate(() => window.__fightQA.state.player.inputBuffer?.kind==='light');
    if(!queued)errors.push(`${profile.name}: early light input was not buffered`);
    await page.waitForFunction(() => window.__fightQA.state.player.comboStep===2,{timeout:500}).catch(()=>{});
    const bufferedStep=await page.evaluate(() => ({step:window.__fightQA.state.player.comboStep,buffer:window.__fightQA.state.player.inputBuffer}));
    if(bufferedStep.step!==2||bufferedStep.buffer)errors.push(`${profile.name}: buffered cancel did not execute ${JSON.stringify(bufferedStep)}`);

    // Hitstop freezes the action clock and pose clock instead of letting real-time timers drift.
    const frozen=await page.evaluate(async() => {
      const q=window.__fightQA,p=q.state.player;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.attack(p,q.state.cpu,'player','light');
      await new Promise(resolve=>setTimeout(resolve,25));q.triggerHitstop(100);
      const before={action:p.action.elapsed,pose:p.poseState.elapsed};await new Promise(resolve=>setTimeout(resolve,55));
      return {before,after:{action:p.action.elapsed,pose:p.poseState.elapsed}};
    });
    if(Math.abs(frozen.after.action-frozen.before.action)>2||Math.abs(frozen.after.pose-frozen.before.pose)>2)errors.push(`${profile.name}: hitstop clocks drifted ${JSON.stringify(frozen)}`);

    // Light attacks can cancel recovery into the next combo step.
    await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.state.player.x=25;q.state.cpu.x=60;q.position();q.attack(q.state.player,q.state.cpu,'player','light');
    });
    await page.waitForTimeout(150);
    const cancelled=await page.evaluate(() => {
      const q=window.__fightQA;q.attack(q.state.player,q.state.cpu,'player','light');return q.state.player.comboStep===2&&q.state.player.currentMove===q.MOVES[1];
    });
    if(!cancelled)errors.push(`${profile.name}: light attack cancel window failed`);

    // Double-tap dash moves forward; backstep invulnerability rejects an immediate hit.
    await page.evaluate(() => {const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9)});
    await page.keyboard.press('d');await page.waitForTimeout(60);await page.keyboard.press('d');await page.waitForTimeout(35);
    const dashState=await page.evaluate(() => {const p=window.__fightQA.state.player;return {x:p.x,dashing:p.el.classList.contains('dashing'),remaining:p.dashRemaining,facing:p.facing}});
    if(dashState.x<=20||!dashState.dashing)errors.push(`${profile.name}: double-tap dash failed ${JSON.stringify(dashState)}`);
    const backstep=await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);const p=q.state.player,c=q.state.cpu;p.x=44;c.x=56;q.position();
      q.startDash(p,-1,'player');const connected=q.applyHit(c,p,'cpu',7,false,3);return {invulnerable:p.invulnerableUntil>performance.now(),connected,hp:p.hp};
    });
    if(!backstep.invulnerable||backstep.connected||backstep.hp!==100)errors.push(`${profile.name}: backstep invulnerability failed ${JSON.stringify(backstep)}`);

    // Holding away guards while retreating. L rolls through the opponent, swaps sides and preserves dynamic facing.
    await page.evaluate(() => {const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9)});
    await page.keyboard.down('a');await page.waitForTimeout(45);
    const backwardGuard=await page.evaluate(() => {const p=window.__fightQA.state.player;return {guard:p.guard,x:p.x,facing:p.facing}});
    await page.keyboard.up('a');
    if(!backwardGuard.guard||backwardGuard.x>=20||backwardGuard.facing!==1)errors.push(`${profile.name}: holding away did not retreat-guard ${JSON.stringify(backwardGuard)}`);
    const roll=await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player,c=q.state.cpu;q.reset();q.setAIState(c,'test',1e9);p.x=36;c.x=55;q.position();
      const started=q.startRoll(p,c,'player'),invulnerable=p.invulnerableUntil>performance.now(),connected=q.applyHit(c,p,'cpu',7,false,3);
      q.updateRoll(p,c,'player',p.rollDuration);q.updateFacing();q.position();
      const result={started,invulnerable,connected,hp:p.hp,crossed:p.x>c.x,playerFacing:p.facing,cpuFacing:c.facing,gap:Math.abs(q.fighterCenter(p)-q.fighterCenter(c)),minimum:p.pushRadius+c.pushRadius,cooldown:p.rollCooldown,repeated:q.startRoll(p,c,'player')};
      q.attack(p,c,'player','light');result.attackDirection=p.action?.direction;return result;
    });
    if(!roll.started||!roll.invulnerable||roll.connected||roll.hp!==100||!roll.crossed||roll.playerFacing!==-1||roll.cpuFacing!==1||roll.gap+.01<roll.minimum||roll.cooldown<=0||roll.repeated||roll.attackDirection!==-1)errors.push(`${profile.name}: roll, side swap or dynamic facing failed ${JSON.stringify(roll)}`);
    await page.evaluate(() => {const q=window.__fightQA,p=q.state.player;p.attackToken++;p.action=null;p.currentMove=null;p.busy=0;p.cooldown=0;p.rollCooldown=0});
    const beforeOppositeRetreat=await page.evaluate(()=>window.__fightQA.state.player.x);
    await page.keyboard.down('d');await page.waitForTimeout(45);
    const oppositeGuard=await page.evaluate(() => {const p=window.__fightQA.state.player;return {guard:p.guard,x:p.x,facing:p.facing}});
    await page.keyboard.up('d');
    if(!oppositeGuard.guard||oppositeGuard.x<=beforeOppositeRetreat||oppositeGuard.facing!==-1)errors.push(`${profile.name}: retreat-guard did not reverse after side swap ${JSON.stringify(oppositeGuard)}`);

    // Blocking consumes guard gauge, creates blockstun, and heavy pressure can break guard.
    const guardSystem=await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player,c=q.state.cpu;q.reset();q.setAIState(c,'test',1e9);p.x=44;c.x=56;q.guard(p,true,'player');
      q.applyHit(c,p,'cpu',7,false,3,240,125,10,55);const blocked={gauge:p.guardGauge,blockstun:p.blockstun,guard:p.guard};
      q.reset();q.setAIState(c,'test',1e9);p.x=44;c.x=56;p.guardGauge=20;q.guard(p,true,'player');q.applyHit(c,p,'cpu',16,true,7,470,230,30,115);
      return {blocked,broken:p.guardGauge===0&&!p.guard&&p.guardBrokenUntil>performance.now()&&p.busy>=700};
    });
    if(guardSystem.blocked.gauge!==90||guardSystem.blocked.blockstun<=0||!guardSystem.blocked.guard||!guardSystem.broken)errors.push(`${profile.name}: guard gauge or guard break failed ${JSON.stringify(guardSystem)}`);
    await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.state.player.guardGauge=50;q.state.player.guardRegenAt=performance.now();
    });
    await page.waitForTimeout(120);
    if((await page.evaluate(()=>window.__fightQA.state.player.guardGauge))<=50)errors.push(`${profile.name}: guard gauge did not recover`);

    // The same jab must miss outside its active hitbox and connect after moving into range.
    await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player,c=q.state.cpu;
      q.setAIState(c,'test',1e9);p.x=25;c.x=55;c.hp=100;p.busy=0;p.cooldown=0;p.comboStep=0;p.comboExpires=0;q.position();q.attack(p,c,'player');
    });
    await page.waitForTimeout(180);
    if((await page.evaluate(()=>window.__fightQA.state.cpu.hp))!==100)errors.push(`${profile.name}: distant jab caused phantom damage`);
    await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player,c=q.state.cpu;
      p.x=44;c.x=57;p.busy=0;p.cooldown=0;p.comboStep=0;p.comboExpires=0;p.attackToken++;q.position();q.attack(p,c,'player');
    });
    await page.waitForTimeout(180);
    if((await page.evaluate(()=>window.__fightQA.state.cpu.hp))>=100)errors.push(`${profile.name}: close jab missed valid hitbox`);
    await page.evaluate(() => {
      const q=window.__fightQA;q.state.player.x=43;q.state.cpu.x=57;q.state.player.busy=0;q.state.player.cooldown=0;q.state.player.comboStep=0;q.state.player.comboExpires=0;q.state.player.attackToken++;q.setAIState(q.state.cpu,'test',1e9);q.position();
      window.__qaFrames=[];new MutationObserver(()=>window.__qaFrames.push(q.state.player.img.src)).observe(q.state.player.img,{attributes:true,attributeFilter:['src']});
      window.__qaMotion=[];new MutationObserver(()=>window.__qaMotion.push(q.state.player.el.dataset.motion)).observe(q.state.player.el,{attributes:true,attributeFilter:['data-motion']});
    });

    // Three timed presses must advance through the complete combo chain.
    for (const pause of [280,320,0]) { await page.keyboard.press('j'); if(pause)await page.waitForTimeout(pause); }
    await page.waitForTimeout(260);
    const comboStep = await page.evaluate(() => window.__fightQA.state.player.comboStep);
    if(comboStep !== 3) errors.push(`${profile.name}: combo stopped at ${comboStep}`);
    const frames = await page.evaluate(() => [...new Set(window.__qaFrames.map(src=>src.split('/').pop()))]);
    if(frames.length<4)errors.push(`${profile.name}: only ${frames.length} action frames observed`);
    const motionPhases = await page.evaluate(() => [...new Set(window.__qaMotion.filter(Boolean))]);
    if(motionPhases.length<5)errors.push(`${profile.name}: only ${motionPhases.length} light-attack motion phases observed ${JSON.stringify(motionPhases)}`);

    // Player helper projectile: Wang Yihan.
    await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player;p.attackToken++;p.action=null;p.currentMove=null;p.busy=0;p.cooldown=0;p.energy=99;
      q.state.player.x=25;q.state.cpu.x=75;q.position();q.launchAssist(p,q.state.cpu,'player');window.__qaUnderfilledUlt={energy:p.energy,cinematic:q.state.cinematic};p.energy=100;q.updateHud();
    });
    const underfilledUlt=await page.evaluate(()=>window.__qaUnderfilledUlt);
    if(underfilledUlt.energy!==99||underfilledUlt.cinematic)errors.push(`${profile.name}: ultimate launched below full energy ${JSON.stringify(underfilledUlt)}`);
    await page.keyboard.press('k');
    if((await page.evaluate(()=>window.__fightQA.state.player.energy))!==0)errors.push(`${profile.name}: ultimate did not consume the full energy bar`);
    await page.waitForTimeout(280);
    if(!(await page.locator('#ultimateCutIn.play').isVisible()))errors.push(`${profile.name}: player ultimate cut-in missing`);
    if(!(await page.evaluate(()=>window.__fightQA.state.cinematic)))errors.push(`${profile.name}: fight did not pause for ultimate`);
    await page.screenshot({ path: path.join(__dirname, `qa-${profile.name}-ultimate.png`) });
    await page.waitForTimeout(900);
    if(await page.locator('.assist-projectile:not(.cpu-shot)').count()!==1)errors.push(`${profile.name}: Wang Yihan projectile missing after cut-in`);
    await page.waitForTimeout(700);

    // CPU helper projectile: Gong Taoran.
    await page.evaluate(() => {
      const q=window.__fightQA;q.state.cpu.busy=0;q.state.cpu.cooldown=0;q.state.cpu.energy=100;
      q.state.player.x=25;q.state.cpu.x=75;q.position();q.launchAssist(q.state.cpu,q.state.player,'cpu');
    });
    await page.waitForTimeout(280);
    if(!(await page.locator('#ultimateCutIn.cpu-cut.play').isVisible()))errors.push(`${profile.name}: CPU ultimate cut-in missing`);
    await page.waitForTimeout(900);
    if(await page.locator('.assist-projectile.cpu-shot').count()!==1)errors.push(`${profile.name}: Gong Taoran projectile missing after cut-in`);
    await page.waitForTimeout(700);

    // A successful block opens the counter window; J consumes it.
    await page.evaluate(() => {
      const q=window.__fightQA;q.reset();q.setAIState(q.state.cpu,'test',1e9);q.state.player.busy=0;q.state.player.cooldown=0;q.state.cpu.busy=0;q.state.cpu.cooldown=0;
      q.state.player.x=44;q.state.cpu.x=56;q.position();
    });
    await page.keyboard.down('a');await page.waitForTimeout(20);
    await page.evaluate(() => {const q=window.__fightQA;q.attack(q.state.cpu,q.state.player,'cpu')});
    await page.waitForTimeout(150);
    const ready = await page.evaluate(() => window.__fightQA.state.player.counterReadyUntil > performance.now());
    if(!ready)errors.push(`${profile.name}: counter window did not open`);
    await page.keyboard.up('a');
    await page.keyboard.press('j');
    await page.waitForTimeout(40);
    const consumed = await page.evaluate(() => window.__fightQA.state.player.counterReadyUntil === 0);
    if(!consumed)errors.push(`${profile.name}: counter was not triggered`);

    await page.screenshot({ path: path.join(__dirname, `qa-${profile.name}-fight.png`) });
    if(!(await page.locator('#player').isVisible() && await page.locator('#cpu').isVisible()))errors.push(`${profile.name}: fighter missing`);
    if(profile.mobile&&!(await page.locator('.mobile-controls [data-key="i"]').isVisible()))errors.push('mobile: independent heavy button missing');
    if(profile.mobile&&(await page.locator('.mobile-controls [data-key="l"]').textContent()).trim()!=='闪')errors.push('mobile: roll button missing');
    await page.close();
  }

  // Critical assets should unlock the game while optional actions keep loading.
  const stagedPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await stagedPage.route('**/*.webp', async route => {
    if(/(06-victory|07-special|projectile)\.webp$/i.test(route.request().url()))await new Promise(resolve=>setTimeout(resolve,900));
    await route.continue();
  });
  const stagedUrl = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/') + '?qa=1';
  await stagedPage.goto(stagedUrl, { waitUntil: 'domcontentloaded' });
  await stagedPage.waitForFunction(() => !document.querySelector('#startBtn').disabled);
  if(!/后台加载中/.test(await stagedPage.locator('#loadStatus').textContent()))errors.push('loading: optional assets blocked critical start');
  await stagedPage.close();

  // A failed WebP request must transparently retry the original PNG assets.
  const fallbackPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await fallbackPage.route('**/*.webp', route => route.abort());
  const fallbackUrl = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/') + '?qa=1';
  await fallbackPage.goto(fallbackUrl, { waitUntil: 'domcontentloaded' });
  await fallbackPage.waitForFunction(() => !document.querySelector('#startBtn').disabled);
  await fallbackPage.click('#startBtn');
  if(!(await fallbackPage.locator('#player img').getAttribute('src')).endsWith('.png'))errors.push('compatibility: PNG fallback missing');
  await fallbackPage.close();
  await browser.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('QA passed: pose anchors, proportional hitboxes, stable pushboxes, limited logical lunge, instant light, six-phase punch motion, independent heavy, input buffer, unified action timing, dash/backstep, guard break, AI, desktop/mobile.');
})();
