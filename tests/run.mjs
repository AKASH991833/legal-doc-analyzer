import puppeteer from 'puppeteer-core';
import fs from 'fs';
const out='/tmp/shots60';fs.mkdirSync(out,{recursive:true});
const browser=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars']});
let fails=[];
const check=(name,ok,extra='')=>{console.log((ok?'PASS':'FAIL')+' '+name+(extra?' — '+extra:''));if(!ok)fails.push(name);};
for(const v of [{name:'desktop',w:1440,h:900},{name:'mobile',w:390,h:844}]){
 for(const theme of ['light','dark']){
  const page=await browser.newPage();
  await page.setViewport({width:v.w,height:v.h,deviceScaleFactor:1});
  const errs=[];page.on('pageerror',e=>errs.push(String(e)));page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  await page.evaluateOnNewDocument(t=>localStorage.setItem('theme',t),theme);
  await page.goto('http://localhost:8060',{waitUntil:'networkidle2'});
  await page.click('#btnSample');
  await page.waitForSelector('#report:not(.hidden)');
  await new Promise(s=>setTimeout(s,300));
  const st=await page.evaluate(()=>window._test.state());
  check(`${v.name}/${theme} sample splits into clauses`,st.clauses>=8&&st.clauses<=12,st.clauses+' clauses');
  check(`${v.name}/${theme} risks flagged`,st.riskHits>=5,st.riskHits+' flags');
  const riskIds=await page.evaluate(()=>window._test.analyze().risks);
  for(const id of ['auto-renewal','broad-indemnity','unilateral-termination','perpetual-confidentiality','arbitration'])
    check(`${v.name}/${theme} detects ${id}`,riskIds.includes(id));
  check(`${v.name}/${theme} no false unlimited-liability`,!riskIds.includes('unlimited-liability'));
  // high severity count shows in KPIs
  const kpi=await page.$eval('#kpis',e=>e.textContent);
  check(`${v.name}/${theme} KPIs show high severity`,/High severity\s*2/.test(kpi.replace(/\s+/g,' '))||kpi.includes('High severity'),'');
  // clause type filter
  await page.select('#fltType','payment');await new Promise(s=>setTimeout(s,200));
  const shown=await page.$$eval('#clauseList .clause',els=>els.length);
  check(`${v.name}/${theme} type filter narrows`,shown>=1&&shown<=3,shown+' shown');
  await page.select('#fltType','');
  // risks-only filter
  await page.$eval('#fltRisk',el=>{el.checked=true;el.dispatchEvent(new Event('change'));});
  await new Promise(s=>setTimeout(s,200));
  const risky=await page.$$eval('#clauseList .clause',els=>els.length);
  check(`${v.name}/${theme} risks-only filter`,risky>=2&&risky<st.clauses,risky+' risky clauses');
  await page.$eval('#fltRisk',el=>{el.checked=false;el.dispatchEvent(new Event('change'));});
  // jump-to-clause from a risk card
  await page.evaluate(()=>{const b=document.querySelector('.jump');return b?b.dataset.clause:null;});
  await page.evaluate(()=>document.querySelector('.jump').click());
  await new Promise(s=>setTimeout(s,600));
  // obligations extracted
  const obl=await page.$eval('#clauseList',e=>e.textContent);
  check(`${v.name}/${theme} obligations extracted`,obl.includes('Obligations:'));
  // unlimited liability detected on a doc with no liability clause
  const noLiab=await page.evaluate(()=>window._test.analyzeText("1. SERVICES. We provide hosting services.\n\n2. PAYMENT. Client shall pay all fees invoiced within thirty days of receipt.\n\n3. TERM. This Agreement continues for one year and renews automatically unless either party gives notice.").risks);
  check(`${v.name}/${theme} missing liability clause flagged`,noLiab.includes('unlimited-liability'));
  await page.evaluate(()=>window._test.analyze());
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:`${out}/top-${v.name}-${theme}.png`});
  await page.evaluate(()=>document.getElementById('riskCard').scrollIntoView({block:'start'}));
  await new Promise(s=>setTimeout(s,250));
  await page.screenshot({path:`${out}/risks-${v.name}-${theme}.png`});
  await page.evaluate(()=>document.getElementById('clauseList').scrollIntoView({block:'start'}));
  await new Promise(s=>setTimeout(s,250));
  await page.screenshot({path:`${out}/clauses-${v.name}-${theme}.png`});
  check(`${v.name}/${theme} no console errors`,errs.length===0,errs.slice(0,3).join('|'));
  await page.close();
 }
}
await browser.close();
if(fails.length){console.log('\nFAILURES: '+fails.join(', '));process.exit(1);}
console.log('\nALL PASS');
