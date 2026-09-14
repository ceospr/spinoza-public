(function(){
 'use strict';
 const params=new URLSearchParams(location.hash.slice(1));
 const received=params.get('token');if(received){sessionStorage.setItem('research-token',received);history.replaceState(null,'',location.pathname);}
 const token=sessionStorage.getItem('research-token')||'';
 const $=id=>document.getElementById(id), form=$('paper-form');
 let papers=[],current=null,review=null,busy=false;
 function message(text,type=''){const box=$('message');box.textContent=text;box.className=type;}
 async function api(path,body){const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'X-Research-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();if(!response.ok)throw Error(value.error||'The operation could not be completed.');return value;}
 async function perform(action){if(busy)return;busy=true;try{await action();}catch(error){message(error.message,'error');}finally{busy=false;}}
 function field(name){return form.elements.namedItem(name);}
 function resetReview(){review=null;$('publish-review').hidden=true;$('confirm-publish').checked=false;$('confirm-publish-button').disabled=true;}
 function renderList(){const query=$('find-paper').value.toLowerCase();$('paper-list').replaceChildren();const rows=papers.filter(p=>p.title.toLowerCase().includes(query));
  for(const paper of rows){const button=document.createElement('button');button.className='paper-choice'+(current&&current.id===paper.id?' active':'');button.textContent=paper.title;const state=document.createElement('span');state.textContent=paper.status==='published'?'On local site':'Draft / withdrawn';button.append(state);button.onclick=()=>edit(paper);$('paper-list').append(button);}
  if(!rows.length){const p=document.createElement('p');p.className='help';p.textContent='No matching papers. Use Add paper to start.';$('paper-list').append(p);}
 }
 async function load(selected){const value=await api('library');papers=value.papers;$('backup-directory').textContent='Private backups: '+value.backup_directory;const item=selected?papers.find(p=>p.id===selected):null;edit(item);}
 function edit(paper){current=paper||null;form.reset();$('pdf-file').value='';
  const empty={id:'',title:'',subtitle:'',author:'',date:new Date().toISOString().slice(0,10),category:'investment-ideas',evidence_basis:'Investment thesis',abstract:'',abstract_note:'',version:'',pages:'',tags:[]};
  const values=paper||empty;for(const key of Object.keys(empty)){field(key).value=key==='tags'?(values.tags||[]).join(', '):(values[key]??'');}
  field('id').readOnly=!!paper;$('editor-heading').textContent=paper?'Edit paper':'Add a research paper';$('editor-state').textContent=paper?(paper.status==='published'?'On local site':'Draft / withdrawn'):'New paper';
  $('save-paper').textContent=paper?'Save changes locally':'Save draft';$('publish-paper').hidden=!!paper&&paper.status==='published';$('publish-paper').textContent=paper?'Republish on local site':'Add to local site';
  $('withdraw-paper').hidden=!paper||paper.status!=='published';$('download-current').hidden=!paper;
  $('pdf-help').textContent=paper?'Current PDF: '+(paper.bytes/1024).toFixed(0)+' KB. Choose a new PDF only when replacing this version. The previous file is kept privately.':'Choose the original PDF (maximum 32 MB). Its contents are not rewritten.';
  $('version-history').hidden=!paper||!(paper.revisions||[]).length;$('version-list').replaceChildren();
  if(paper){for(const revision of [...(paper.revisions||[])].reverse()){const row=document.createElement('div');row.className='version-row';const label=document.createElement('span');label.textContent=(revision.version?'Version '+revision.version:'Previous PDF')+' · saved '+revision.saved_at;const button=document.createElement('button');button.className='small secondary';button.textContent='Download';button.onclick=()=>perform(()=>download(paper.id,revision.sha256));row.append(label,button);$('version-list').append(row);}}
  renderList();
 }
 async function download(id,sha){const response=await fetch('/api/pdf?id='+encodeURIComponent(id)+(sha?'&sha256='+encodeURIComponent(sha):''),{headers:{'X-Research-Token':token}});if(!response.ok){const e=await response.json();throw Error(e.error);}const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=id+(sha?'-'+sha.slice(0,8):'')+'.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,base64:String(reader.result).split(',')[1]});reader.onerror=()=>reject(Error('Could not read the selected PDF.'));reader.readAsDataURL(file);});}
 field('title').addEventListener('input',()=>{if(!current)field('id').value=field('title').value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90).replace(/-$/,'');});
 form.addEventListener('submit',event=>{event.preventDefault();const intent=event.submitter?.value||'save';perform(async()=>{
  if(!form.reportValidity())return;const paper={new:!current};for(const key of ['id','title','subtitle','author','date','category','evidence_basis','abstract','abstract_note','version'])paper[key]=field(key).value;
  paper.tags=field('tags').value.split(',').map(v=>v.trim()).filter(Boolean);paper.pages=field('pages').value?Number(field('pages').value):null;
  const file=$('pdf-file').files[0];if(file&&file.size>32*1024*1024)throw Error('Choose a PDF smaller than 32 MB.');
  if(!current&&!file)throw Error('Choose a PDF for the new paper.');
  const request={paper,...(file?{pdf:await readFile(file)}:{}),...(intent==='publish'?{publish:true}:(!current?{publish:false}:{}))};
  await api('save',request);resetReview();await load(paper.id);message('Saved locally. Preview the library, then use Review & publish to update the live website.','success');
 });});
 $('new-paper').onclick=()=>edit(null);$('find-paper').oninput=renderList;
 $('withdraw-paper').onclick=()=>perform(async()=>{if(!current||!confirm('Withdraw this paper from the local website? Its public PDF will be removed, and a private copy will remain available for republishing. The live site changes only after you publish.'))return;const id=current.id;await api('visibility',{id,published:false});resetReview();await load(id);message('Withdrawn locally. The public PDF and catalog entry are removed; private copies are retained. Review & publish to withdraw it from the live site.','success');});
 $('download-current').onclick=()=>perform(()=>download(current.id));
 $('reload-catalog').onclick=()=>perform(async()=>{if(!confirm('Reload the public website catalog? This imports external catalog changes. Private drafts and previous PDFs are retained.'))return;await api('import',{confirmed:true});resetReview();await load();message('Website catalog reloaded. Private backups are retained.','success');});
 $('review-publish').onclick=()=>perform(async()=>{message('Reviewing local research changes…');review=await api('review',{});$('publish-files').replaceChildren();for(const path of review.files){const item=document.createElement('li');item.textContent=(review.sha256[path]===null?'Remove: ':'Update: ')+path;$('publish-files').append(item);}
  $('publish-target').textContent=review.remote+' · branch '+review.branch;$('confirm-publish').checked=false;$('confirm-publish-button').disabled=true;$('publish-review').hidden=false;$('publish-review').scrollIntoView({behavior:'smooth'});message(review.files.length?review.files.length+' research files are ready for your review. No changes have been pushed.':'No research changes need publishing.','success');
 });
 $('confirm-publish').onchange=()=>{$('confirm-publish-button').disabled=!$('confirm-publish').checked||!review?.files.length;};
 $('cancel-publish').onclick=resetReview;
 $('confirm-publish-button').onclick=()=>perform(async()=>{if(!review||!$('confirm-publish').checked)return;message('Publishing the reviewed research changes to GitHub…');const result=await api('publish',{review_id:review.review_id,confirmed:true});resetReview();message(result.message,'success');});
 perform(async()=>{await load();message('Your local library is ready. Editing here does not change the live website until you explicitly publish.');});
})();
