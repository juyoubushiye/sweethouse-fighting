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
      for(const expected of ['charge','approach','combo'])if(!autonomousStates.includes(expected))errors.push(`desktop: autonomous AI never entered ${expected}`);
    }
    await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player,c=q.state.cpu;p.attackToken++;c.attackToken++;
      p.busy=0;p.cooldown=0;p.hp=100;c.busy=0;c.cooldown=0;c.hp=100;p.x=20;c.x=80;
      q.guard(p,false,'player');q.guard(c,false,'cpu');q.setFrame(p,'player','idle');q.setFrame(c,'cpu','idle');q.setAIState(c,'test',1e9);q.position();q.updateHud();
    });
    const idleFacing = await page.locator('#player').evaluate(el => ({pose:el.dataset.pose,transform:getComputedStyle(el.querySelector('img')).transform}));
    if(idleFacing.pose!=='idle'||idleFacing.transform==='none')errors.push(`${profile.name}: Zhao Ying idle facing fix missing`);
    const guardFacing = await page.evaluate(() => {
      const q=window.__fightQA,p=q.state.player;q.guard(p,true,'player');
      const facing={pose:p.el.dataset.pose,transform:getComputedStyle(p.img).transform};q.guard(p,false,'player');return facing;
    });
    if(guardFacing.pose!=='guard'||guardFacing.transform==='none')errors.push(`${profile.name}: Zhao Ying guard does not face opponent`);
    const cpuFacing = await page.evaluate(() => {
      const q=window.__fightQA,c=q.state.cpu,read=()=>getComputedStyle(c.img).transform;
      q.setFrame(c,'cpu','idle');const idle=read();q.setFrame(c,'cpu','forward');const forward=read();
      q.setFrame(c,'cpu','guard');const guard=read();q.setFrame(c,'cpu','idle');return {idle,forward,guard};
    });
    if(cpuFacing.idle!=='none'||cpuFacing.forward==='none'||cpuFacing.guard!=='none')errors.push(`${profile.name}: Zhong Yajing movement facing normalization missing`);

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
    });

    // Three timed presses must advance through the complete combo chain.
    for (const pause of [280,320,0]) { await page.keyboard.press('j'); if(pause)await page.waitForTimeout(pause); }
    await page.waitForTimeout(260);
    const comboStep = await page.evaluate(() => window.__fightQA.state.player.comboStep);
    if(comboStep !== 3) errors.push(`${profile.name}: combo stopped at ${comboStep}`);
    const frames = await page.evaluate(() => [...new Set(window.__qaFrames.map(src=>src.split('/').pop()))]);
    if(frames.length<4)errors.push(`${profile.name}: only ${frames.length} action frames observed`);

    // Player helper projectile: Wang Yihan.
    await page.evaluate(() => {
      const q=window.__fightQA;q.state.player.busy=0;q.state.player.cooldown=0;q.state.player.energy=100;
      q.state.player.x=25;q.state.cpu.x=75;q.position();q.updateHud();
    });
    await page.keyboard.press('k');
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
    await page.keyboard.down('l');
    await page.evaluate(() => {
      const q=window.__fightQA;q.state.player.busy=0;q.state.player.cooldown=0;q.state.cpu.busy=0;q.state.cpu.cooldown=0;
      q.state.player.x=44;q.state.cpu.x=56;q.position();q.guard(q.state.player,true,'player');q.attack(q.state.cpu,q.state.player,'cpu');
    });
    await page.waitForTimeout(150);
    const ready = await page.evaluate(() => window.__fightQA.state.player.counterReadyUntil > performance.now());
    if(!ready)errors.push(`${profile.name}: counter window did not open`);
    await page.keyboard.up('l');
    await page.keyboard.press('j');
    await page.waitForTimeout(40);
    const consumed = await page.evaluate(() => window.__fightQA.state.player.counterReadyUntil === 0);
    if(!consumed)errors.push(`${profile.name}: counter was not triggered`);

    await page.screenshot({ path: path.join(__dirname, `qa-${profile.name}-fight.png`) });
    if(!(await page.locator('#player').isVisible() && await page.locator('#cpu').isVisible()))errors.push(`${profile.name}: fighter missing`);
    await page.close();
  }

  // Critical assets should unlock the game while optional actions keep loading.
  const stagedPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await stagedPage.route('**/*.webp', async route => {
    if(/(03-kick|06-victory|07-special|projectile)\.webp$/i.test(route.request().url()))await new Promise(resolve=>setTimeout(resolve,900));
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
  console.log('QA passed: staged loading, AI states, active hitboxes, combat, facing, WebP/PNG, desktop/mobile.');
})();
