/* Legal Document Analyzer - rule-based clause extraction and risk flags */
(function(){
'use strict';
const $=s=>document.querySelector(s);

const TYPES={
  termination:{label:'Termination',words:['terminate','termination','termination for cause','termination for convenience','notice of termination','survive']},
  liability:{label:'Limitation of liability',words:['limitation of liability','liability','consequential','indirect damages','aggregate liability','liability cap','excluded','lost profits']},
  indemnity:{label:'Indemnification',words:['indemnify','indemnification','hold harmless','defend','third-party claim']},
  payment:{label:'Payment & fees',words:['payment','fees','invoice','compensation','net thirty','net 30','overdue','interest','expenses','reimburse']},
  confidentiality:{label:'Confidentiality',words:['confidential','non-disclosure','proprietary','trade secret','disclose','receiving party','disclosing party']},
  ip:{label:'Intellectual property',words:['intellectual property','work product','copyright','patent','trademark','license','ownership','derivative works']},
  governing:{label:'Governing law & disputes',words:['governing law','jurisdiction','arbitration','venue','dispute','courts of','waiver of jury']},
  renewal:{label:'Term & renewal',words:['term','renewal','renew','initial term','expiration','effective date','extension','auto']},
  warranty:{label:'Warranties',words:['warranty','warranties','warrants','as is','merchantability','fitness for a particular purpose','represents']},
  noncompete:{label:'Non-compete & exclusivity',words:['non-compete','noncompete','compete','exclusive','exclusivity','solicit','non-solicitation']},
  definitions:{label:'Definitions',words:['means','as used herein','shall mean','defined term','definitions']}
};

const RISKS=[
  {id:'unlimited-liability',sev:'high',title:'No liability cap found',re:null,
   test:(full,clauses)=>{const liab=clauses.filter(c=>c.type==='liability');
     if(!liab.length)return {hit:true,why:'The document has no limitation-of-liability clause at all, so either party could be exposed to full damages.'};
     const capped=liab.some(c=>/cap|aggregate|exceed|shall not|in no event|limited to/i.test(c.text));
     if(!capped)return {hit:true,why:'A liability clause exists but no cap language was found in it, so liability may be unlimited.',clause:liab[0]};
     return {hit:false};}},
  {id:'auto-renewal',sev:'high',title:'Auto-renewal clause',re:/auto(?:matic(?:ally)?)?[- ]renew|renews? automatically|unless either party gives/i,
   why:'The contract renews by itself unless notice is given in time - diarize the notice deadline.'},
  {id:'broad-indemnity',sev:'high',title:'Broad indemnity',re:/any and all (claims|losses|damages|liabilit)|all claims, losses, costs and expenses/i,
   why:'One side agrees to cover essentially everything the other faces. Broad indemnities transfer a lot of risk.'},
  {id:'unilateral-termination',sev:'med',title:'One-sided termination right',re:/(company|provider|we|client) may terminate this agreement (at any time )?(with or without (cause|reason)|for any reason|at its (sole )?discretion)/i,
   why:'One party can walk away at will while the other appears to have no matching right.'},
  {id:'perpetual-confidentiality',sev:'med',title:'Perpetual confidentiality',re:/(survive|remain in (full )?force|continue) (in perpetuity|indefinitely|for an indefinite period)/i,
   why:'Confidentiality that never expires is stricter than the usual 3-5 year survival window.'},
  {id:'long-noncompete',sev:'med',title:'Non-compete longer than 12 months',re:/non[- ]?compet|shall not (engage|compete)/i,
   test:(full,clauses,match,clause)=>{
     const m=clause.text.match(/(\d+)\s*(year|month)/i);
     if(!m)return {hit:false};
     const n=+m[1], months=/year/i.test(m[2])?n*12:n;
     if(months>12)return {hit:true,why:`A ${n} ${m[2]}${n>1?'s':''} restriction exceeds the 12 months courts and employers usually treat as the reasonable ceiling.`};
     return {hit:false};}},
  {id:'arbitration',sev:'info',title:'Binding arbitration',re:/binding arbitration|arbitration (shall|will) be/i,
   why:'Disputes go to arbitration, not court. You usually give up a jury trial and broad discovery.'},
  {id:'interest-late',sev:'info',title:'Late-payment interest',re:/interest (at|of|accru)|late fee|overdue/i,
   why:'Late payments accrue charges - check the rate stated.'}
];

const SAMPLE=`MASTER SERVICES AGREEMENT

1. SERVICES. Provider agrees to perform the services described in each statement of work (each, an "SOW") during the term of this Agreement.

2. PAYMENT. Client shall pay all fees invoiced within thirty (30) days of receipt. Overdue amounts accrue interest at 1.5% per month. Client shall reimburse reasonable travel expenses pre-approved in writing.

3. TERM AND RENEWAL. This Agreement commences on the Effective Date and continues for an initial term of one (1) year. Thereafter, this Agreement renews automatically for successive one (1) year terms unless either party gives written notice of non-renewal at least sixty (60) days before the end of the then-current term.

4. TERMINATION. Provider may terminate this Agreement at any time for any reason upon thirty (30) days written notice. Client may terminate for cause if Provider materially breaches and fails to cure within thirty (30) days of notice.

5. CONFIDENTIALITY. Each party agrees to keep the other party's Confidential Information strictly confidential and not to disclose it to any third party. These confidentiality obligations shall survive in perpetuity.

6. INTELLECTUAL PROPERTY. All work product created under this Agreement shall be the exclusive property of Client. Provider retains ownership of its pre-existing tools and grants Client a perpetual, royalty-free license to use them as embedded in the deliverables.

7. INDEMNIFICATION. Client shall indemnify, defend and hold harmless Provider from and against any and all claims, losses, damages and expenses arising out of Client's use of the deliverables.

8. LIMITATION OF LIABILITY. In no event shall Provider be liable for indirect, incidental or consequential damages, including lost profits. Provider's aggregate liability shall not exceed the fees paid in the twelve (12) months preceding the claim.

9. GOVERNING LAW. This Agreement is governed by the laws of the State of California. Any dispute shall be resolved by binding arbitration in San Francisco, and each party waives its right to a jury trial.

10. GENERAL. This Agreement is the entire agreement between the parties and may be amended only in writing signed by both parties.`;

function splitClauses(text){
  // split on blank-line separated blocks, or numbered headings
  const blocks=text.split(/\n\s*\n/).map(b=>b.trim()).filter(b=>b.length>20);
  return blocks;
}
function scoreType(text){
  const low=text.toLowerCase();
  let best='other',bestN=0;
  for(const [k,t] of Object.entries(TYPES)){
    let n=0;for(const w of t.words){if(low.includes(w))n++;}
    if(n>bestN){bestN=n;best=k;}
  }
  return {type:best,hits:bestN};
}
function summarize(type,text){
  const first=text.split(/(?<=[.!?])\s+/)[0]||'';
  return (first.length>220?first.slice(0,217)+'...':first);
}
function obligations(text){
  const out=[];
  const sh=text.match(/[^.]*\b(shall|must|agrees? to|is required to)\b[^.]*\./gi)||[];
  for(const s of sh.slice(0,3))out.push(s.trim());
  return out;
}
function dates(text){
  const out=[];
  const m=text.match(/\b(\d+\s*\(\d+\)\s*(days?|months?|years?)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi)||[];
  return [...new Set(m)].slice(0,4);
}

let clauses=[],riskHits=[];
function analyze(text){
  clauses=splitClauses(text).map((raw,i)=>{
    const {type,hits}=scoreType(raw);
    return {id:i+1,type,hits,text:raw,summary:summarize(type,raw),obligations:obligations(raw),dates:dates(raw),risks:[]};
  });
  riskHits=[];
  const full=text;
  for(const r of RISKS){
    if(r.re){
      const m=full.match(r.re);
      if(m){
        const clause=clauses.find(c=>c.text.includes(m[0]))||null;
        let hit={hit:true,why:r.why};
        if(r.test){const res=r.test(full,clauses,m,clause||{text:full});if(!res.hit)continue;hit=res;}
        const h={id:r.id,sev:r.sev,title:r.title,why:hit.why||r.why,excerpt:m[0],clause:hit.clause||clause};
        riskHits.push(h); if(h.clause)h.clause.risks.push(h);
      }
    }else if(r.test){
      const res=r.test(full,clauses);
      if(res.hit){const h={id:r.id,sev:r.sev,title:r.title,why:res.why,excerpt:'',clause:res.clause||null};riskHits.push(h);if(h.clause)h.clause.risks.push(h);}
    }
  }
  render();
}

function typeLabel(k){return TYPES[k]?TYPES[k].label:'Other';}
function sevChip(s){return s==='high'?'<span class="chip chip-bad">High risk</span>':s==='med'?'<span class="chip chip-warn">Medium</span>':'<span class="chip chip-ok">Note</span>';}

function render(){
  const report=$('#report');report.classList.remove('hidden');
  const hi=riskHits.filter(r=>r.sev==='high').length,med=riskHits.filter(r=>r.sev==='med').length;
  const words=clauses.reduce((a,c)=>a+c.text.split(/\s+/).length,0);
  $('#reportMeta').textContent=`${clauses.length} clauses · ${words.toLocaleString()} words`;
  $('#kpis').innerHTML=[
    ['Clauses',clauses.length,''],
    ['Risk flags',riskHits.length, hi?'chip-bad':'chip-ok'],
    ['High severity',hi, hi?'chip-bad':'chip-ok'],
    ['Clause types',new Set(clauses.map(c=>c.type).filter(t=>t!=='other')).size,'']
  ].map(([l,v,c])=>`<div class="card kpi"><div class="small muted">${l}</div><div class="kpi-val">${v}</div>${c?`<span class="chip ${c}">${l==='High severity'?(hi?'review before signing':'none found'):(riskHits.length?'flags raised':'clean')}</span>`:''}</div>`).join('');

  const fltSel=$('#fltType');
  const used=[...new Set(clauses.map(c=>c.type))];
  fltSel.innerHTML='<option value="">All clause types</option>'+used.map(t=>`<option value="${t}">${typeLabel(t)}</option>`).join('');

  const rc=$('#riskCard');
  if(riskHits.length){rc.classList.remove('hidden');
    $('#riskList').innerHTML=riskHits.map(r=>`<div class="card card-pad-sm risk-item" data-sev="${r.sev}">
      <div class="row row-wrap" style="justify-content:space-between"><b>${esc(r.title)}</b>${sevChip(r.sev)}</div>
      <p class="small muted mt8">${esc(r.why)}</p>
      ${r.excerpt?`<p class="small mt8 quote">"${esc(r.excerpt)}"</p>`:''}
      ${r.clause?`<button class="btn btn-ghost btn-sm mt8 jump" data-clause="${r.clause.id}">View clause ${r.clause.id}</button>`:''}
    </div>`).join('');
  }else rc.classList.add('hidden');

  drawClauses();
  report.scrollIntoView({behavior:'smooth',block:'start'});
}
function drawClauses(){
  const t=$('#fltType').value,riskOnly=$('#fltRisk').checked;
  const list=clauses.filter(c=>(!t||c.type===t)&&(!riskOnly||c.risks.length));
  $('#clauseCount').textContent=`(${list.length} shown)`;
  $('#clauseList').innerHTML=list.map(c=>`<div class="card card-pad-sm clause" id="clause-${c.id}">
    <div class="row row-wrap" style="justify-content:space-between">
      <div class="row row-wrap"><span class="chip chip-accent">${typeLabel(c.type)}</span><span class="small muted">Clause ${c.id}</span></div>
      ${c.risks.map(r=>sevChip(r.sev)).join('')}
    </div>
    <p class="mt8">${esc(c.summary)}</p>
    ${c.obligations.length?`<div class="small mt8"><b>Obligations:</b><ul class="small">${c.obligations.map(o=>`<li>${esc(o)}</li>`).join('')}</ul></div>`:''}
    ${c.dates.length?`<div class="small muted mt8">Time references: ${c.dates.map(esc).join(' · ')}</div>`:''}
    <details class="small mt8"><summary>Full text</summary><p class="muted">${esc(c.text)}</p></details>
  </div>`).join('')||'<p class="muted">No clauses match this filter.</p>';
}

document.addEventListener('click',e=>{
  const j=e.target.closest('.jump');if(!j)return;
  const el=document.getElementById('clause-'+j.dataset.clause);
  if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.outline='2px solid var(--accent)';setTimeout(()=>el.style.outline='',1800);}
});

function updateStats(){
  const t=$('#docText').value.trim();
  $('#docStats').textContent=t?`${t.split(/\s+/).length.toLocaleString()} words pasted`:'';
}
$('#docText').addEventListener('input',updateStats);
$('#btnAnalyze').addEventListener('click',()=>{
  const t=$('#docText').value.trim();
  if(t.length<80){toast('Paste at least a paragraph of contract text.');return;}
  analyze(t);
});
$('#btnSample').addEventListener('click',()=>{$('#docText').value=SAMPLE;updateStats();analyze(SAMPLE);});
$('#fileInput').addEventListener('change',async e=>{
  const f=e.target.files[0];if(!f)return;
  const t=await f.text();$('#docText').value=t;updateStats();analyze(t);
});
$('#fltType').addEventListener('change',drawClauses);
$('#fltRisk').addEventListener('change',drawClauses);
$('#btnExport').addEventListener('click',()=>{
  let md='# Contract Analysis Report\n\n'+`Clauses: ${clauses.length} · Risk flags: ${riskHits.length}\n\n`;
  if(riskHits.length){md+='## Risk flags\n\n';for(const r of riskHits)md+=`- [${r.sev.toUpperCase()}] ${r.title} - ${r.why}${r.excerpt?` ("${r.excerpt}")`:''}\n`;md+='\n';}
  md+='## Clauses\n\n';
  for(const c of clauses){md+=`### Clause ${c.id} - ${typeLabel(c.type)}\n${c.summary}\n\n`;for(const o of c.obligations)md+=`- Obligation: ${o}\n`;md+='\n';}
  md+='\n_Generated by a rule-based reading aid. Not legal advice._\n';
  download('contract-analysis.md',md,'text/markdown');
  toast('Report downloaded');
});

window._test={analyze:()=>{analyze(SAMPLE);return {clauses:clauses.length,risks:riskHits.map(r=>r.id)};},
  analyzeText:(t)=>{analyze(t);return {clauses:clauses.length,risks:riskHits.map(r=>r.id)};},
  sample:()=>SAMPLE, state:()=>({clauses:clauses.length,riskHits:riskHits.length})};
})();
