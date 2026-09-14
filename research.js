/* Public research catalog. All authored text is rendered as text, never HTML. */
(function () {
  'use strict';
  const CATEGORIES = {'investment-ideas':'Investment Ideas','market-trends':'Market Trends',methods:'Methods'};
  const slug = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 90;
  const safePdf = value => typeof value === 'string' && /^papers\/[a-z0-9][a-z0-9/-]*\.pdf$/.test(value) && !value.includes('..');
  const el = (tag, cls, text) => {const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  function date(value){const parsed=new Date(value+'T12:00:00Z');return Number.isNaN(parsed.getTime()) ? 'Date not supplied' : new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(parsed);}
  async function catalog(){
    const response=await fetch('data/research.json',{cache:'no-store'});
    if(!response.ok)throw Error('Research catalog unavailable');
    const data=await response.json();
    if(data.schema_version!=='spinoza.research.v1'||!Array.isArray(data.papers))throw Error('Invalid research catalog');
    return data.papers.filter(p=>p&&p.status==='published'&&slug(p.id)&&safePdf(p.pdf)&&typeof p.title==='string'&&CATEGORIES[p.category])
      .sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.title.localeCompare(b.title));
  }
  function paperCard(p){
    const card=el('article','research-card');
    card.append(el('p','research-category',CATEGORIES[p.category]));
    const heading=el('h3'),link=el('a',null,p.title);link.href='paper.html?id='+encodeURIComponent(p.id);heading.append(link);card.append(heading);
    if(p.subtitle)card.append(el('p','research-subtitle',p.subtitle));
    card.append(el('p','research-meta',date(p.date)+' · '+(p.author||'Author not supplied')));
    card.append(el('p','research-abstract',p.abstract||'Read the full paper.'));
    if(p.evidence_basis)card.append(el('span','research-evidence',p.evidence_basis));
    const action=el('a','research-read','Read paper →');action.href=link.href;card.append(action);return card;
  }
  function previewRow(p){
    const row=el('article','research-preview-row'),body=el('div','research-preview-main');
    body.append(el('p','research-category',CATEGORIES[p.category]+(p.evidence_basis?' · '+p.evidence_basis:'')));
    const heading=el('h3'),link=el('a',null,p.title);link.href='paper.html?id='+encodeURIComponent(p.id);heading.append(link);body.append(heading);
    if(p.subtitle)body.append(el('p','research-preview-subtitle',p.subtitle));
    row.append(body,el('p','research-preview-meta',date(p.date)+' · '+(p.author||'Author not supplied')));return row;
  }
  async function renderResearchPreview(target,options={}){
    const host=typeof target==='string'?document.querySelector(target):target;if(!host)return;
    host.replaceChildren(el('p','research-empty','Loading research…'));
    try{const papers=await catalog();host.replaceChildren();host.classList.remove('research-grid');host.classList.add('research-preview-list');
      const limit=Math.max(1,Math.min(12,Number(options.limit)||3));papers.slice(0,limit).forEach(p=>host.append(previewRow(p)));
      if(!papers.length)host.append(el('p','research-empty','New research will appear here when published.'));
    }catch(error){host.replaceChildren(el('p','research-empty','Research is temporarily unavailable. Please try again later.'));}
  }
  async function renderLibrary(){
    const host=document.getElementById('research-results');if(!host)return;
    const search=document.getElementById('research-search'),category=document.getElementById('research-category'),count=document.getElementById('research-count');
    const requested=new URLSearchParams(location.search).get('category')||document.body.dataset.category||'';
    if(CATEGORIES[requested])category.value=requested;
    try{const papers=await catalog();
      function update(){const query=search.value.trim().toLowerCase();const selected=category.value;
        const rows=papers.filter(p=>(!selected||p.category===selected)&&[p.title,p.subtitle,p.author,p.abstract,...(Array.isArray(p.tags)?p.tags:[])].join(' ').toLowerCase().includes(query));
        host.replaceChildren(...rows.map(paperCard));count.textContent=rows.length+' '+(rows.length===1?'paper':'papers');
        if(!rows.length)host.append(el('p','research-empty',query?'No papers match your search. Try another keyword or category.':'No papers have been published in this category yet.'));
      }search.addEventListener('input',update);category.addEventListener('change',update);update();
    }catch(error){host.replaceChildren(el('p','research-empty','The research library could not be loaded. Please try again later.'));count.textContent='Unavailable';}
  }
  async function renderPaper(){
    const host=document.getElementById('paper-content');if(!host)return;
    const id=new URLSearchParams(location.search).get('id');
    try{if(!slug(id))throw Error('missing');const p=(await catalog()).find(p=>p.id===id);if(!p)throw Error('missing');
      document.title=p.title+' | Spinoza Research';host.replaceChildren();
      host.append(el('p','research-category',CATEGORIES[p.category]),el('h1','paper-title',p.title));
      if(p.subtitle)host.append(el('p','paper-subtitle',p.subtitle));
      host.append(el('p','research-meta',(p.author||'Author not supplied')+' · '+date(p.date)+(p.version?' · Version '+p.version:'')+(p.pages?' · '+p.pages+' pages':'')));
      if(p.evidence_basis)host.append(el('p','research-evidence',p.evidence_basis));
      const overview=el('section','paper-overview');overview.append(el('h2',null,'Overview'),el('p',null,p.abstract||'Read the complete paper below.'));
      if(p.abstract_note)overview.append(el('p','research-meta',p.abstract_note));host.append(overview);
      const pdfUrl=p.pdf+(/^[0-9a-f]{64}$/.test(p.sha256||'')?'?v='+p.sha256.slice(0,12):'');
      const actions=el('div','research-actions');const open=el('a','button','Open PDF');open.href=pdfUrl;open.target='_blank';open.rel='noopener';
      const download=el('a','button research-button-secondary','Download PDF');download.href=pdfUrl;download.download=p.id+'.pdf';actions.append(open,download);host.append(actions);
      const viewer=el('object','paper-viewer');viewer.type='application/pdf';viewer.data=pdfUrl;viewer.setAttribute('aria-label','PDF: '+p.title);
      const fallback=el('p',null,'Your browser cannot display this PDF inline. Use Open PDF or Download PDF above.');viewer.append(fallback);host.append(viewer);
      const note=el('p','research-meta','Research reflects the document’s stated date, assumptions, and limitations. It does not establish a live investment track record.');host.append(note);
    }catch(error){host.replaceChildren(el('h1','paper-title','Paper unavailable'),el('p',null,'This paper may have been withdrawn or the link may be incorrect. Browse the research library for currently published work.'));}
  }
  window.renderResearchPreview=renderResearchPreview;
  window.SpinozaResearch={catalog, safePdf, validSlug:slug};
  document.addEventListener('DOMContentLoaded',()=>{renderLibrary();renderPaper();});
})();
