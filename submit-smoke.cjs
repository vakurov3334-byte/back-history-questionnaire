const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'source/template.html'),'utf8');
const schema={sections:[{id:'core',title:'Тестовый раздел',questions:[
  {id:'toggle',type:'single',label:'Показывать уточнение?',options:['Да','Нет']},
  {id:'hidden',type:'text',label:'Уточнение',when:{id:'toggle',in:['Да']}},
  {id:'scale',type:'scale',label:'Оценка'},
  {id:'table',type:'table',label:'Записи',help:'Подсказка',columns:[{key:'item',label:'Название',kind:'text'}],maxRows:2},
  {id:'note',type:'text',label:'Комментарий'}
]}]};
const TEST_SEND_KEY='test_invitation_key_1234567890_ABCD';
function app(endpoint,hash='#send='+TEST_SEND_KEY){
  const submitted=[],nodes=new Map(),timers=new Map(),events=new Map();let timerId=0,failSubmit=false;
  const node=(tag='div')=>({tagName:tag.toUpperCase(),children:[],style:{},dataset:{},parentElement:{setAttribute(){}},classList:{add(){},remove(){},toggle(){}},setAttribute(k,v){this[k]=v;},appendChild(child){this.children.push(child);return child;},addEventListener(){},focus(){},select(){},remove(){this.removed=true;},closest(){return this;},scrollIntoView(){},submit(){if(failSubmit)throw Error('test refusal');submitted.push({method:this.method,action:this.action,target:this.target,rel:this.rel,fields:Object.fromEntries(this.children.map(n=>[n.name,n.value]))});}});
  const buttons=[node('button'),node('button')];
  const document={activeElement:null,body:node('body'),addEventListener(){},querySelectorAll:()=>buttons,getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
  const context=vm.createContext({document,navigator:{},window:{addEventListener:(n,f)=>events.set(n,f)},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},crypto:webcrypto,URL,URLSearchParams,location:{hash},Uint8Array,console,setTimeout(fn,ms){const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>fn(),fetch(){throw Error('unexpected network');}});
  let script=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('__BRIEF_SCHEMA__',JSON.stringify(schema));
  if(endpoint)script=script.replace("const SUBMIT_ENDPOINT='__SUBMIT_ENDPOINT__';",`const SUBMIT_ENDPOINT=${JSON.stringify(endpoint)};`);
  new vm.Script(script).runInContext(context);
  return {submitted,buttons,events,run:code=>vm.runInContext(code,context),flush(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}},refuse(value){failSubmit=value;}};
}
const placeholder=app();
placeholder.run("state.answers={scale:0};submitAnswers();");
assert.equal(placeholder.submitted.length,0);
assert.match(placeholder.run('submissionStatusText()'),/пока не подключена/);
assert.equal(placeholder.buttons[0].disabled,true);
const missingKey=app('https://script.google.com/macros/s/example-test-only/exec','');
missingKey.run('state.answers={scale:0};submitAnswers();');assert.equal(missingKey.submitted.length,0);assert.match(missingKey.run('submissionStatusText()'),/полной ссылке/);
const badKey=app('https://script.google.com/macros/s/example-test-only/exec','#send=short');
badKey.run('state.answers={scale:0};submitAnswers();');assert.equal(badKey.submitted.length,0);
const a=app('https://script.google.com/macros/s/example-test-only/exec');
a.run('submitAnswers();');assert.equal(a.submitted.length,0);
a.run("state.answers={note:'__skip'};submitAnswers();");assert.equal(a.submitted.length,0);
a.run("state.answers={toggle:'Нет',hidden:'НЕ ПЕРЕДАВАТЬ',scale:0,table:[{item:'Тест <tag>',extra:'drop'},{}],note:'__skip'};setAnswer('scale',0);");
assert.equal(a.submitted.length,0,'typing must not submit');
a.run('submitAnswers();submitAnswers();');assert.equal(a.submitted.length,1,'double click blocked');
const first=JSON.parse(a.submitted[0].fields.submission);
assert.equal(a.submitted[0].method,'POST');assert.equal(a.submitted[0].target,'_blank');assert.equal(a.submitted[0].rel,'noopener');
assert.equal(a.submitted[0].fields.website,'');assert.equal(first.protocol,'back-history-submission-v1');assert.equal(first.sendKey,TEST_SEND_KEY);
assert.equal(first.questionnaireId,'back-history-brief-personal-v2');assert.equal(first.version,2);
assert.match(first.submissionId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.equal(first.answers.scale,0);assert.equal('hidden' in first.answers,false);assert.equal('hidden' in first.questionLabels,false);
assert.deepEqual(first.answers.table,[{item:'Тест <tag>'}]);assert.equal(first.questionContext.table.help,'Подсказка');
assert.equal(first.questionContext.table.columns[0].label,'Название');assert.equal(first.questionContext.table.sectionId,'core');
assert.equal(first.answeredCount,3);assert.equal(first.activeQuestionCount,4);assert.ok(first.summaryText.includes('Тест <tag>'));
a.flush(1800);a.run('submitAnswers();');
assert.deepEqual(JSON.parse(a.submitted[1].fields.submission),first,'same answers reuse the entire envelope');
a.flush(1800);a.run("state.answers.hidden='ДРУГОЙ СКРЫТЫЙ ОТВЕТ';submitAnswers();");
assert.equal(JSON.parse(a.submitted[2].fields.submission).submissionId,first.submissionId,'hidden changes do not create a new submission');
a.flush(1800);a.run('state.answers.scale=2;submitAnswers();');
assert.notEqual(JSON.parse(a.submitted[3].fields.submission).submissionId,first.submissionId);
assert.equal(a.run('state.answers.scale'),2,'submission does not erase answers');
a.flush(1800);a.refuse(true);a.run('submitAnswers();');
assert.equal(a.run('submissionBusy'),false);assert.match(a.run('submissionMessage'),/Не удалось начать/);
a.run("globalThis.draftCapture=null;download=(data)=>{globalThis.draftCapture=JSON.parse(data);};exportDraft();");
assert.equal(a.run('draftCapture.questionnaireId'),'back-history-brief-personal-v2');assert.equal(a.run('draftCapture.version'),2);
assert.equal(a.run('safeAnswers(draftCapture.answers).scale'),2,'draft remains import-compatible');
assert.equal(a.run('JSON.stringify(draftCapture)').includes(TEST_SEND_KEY),false,'invitation key is absent from drafts');
assert.equal(a.run('summaryText()').includes(TEST_SEND_KEY),false,'invitation key is absent from readable summaries');
assert.ok(a.events.has('beforeunload'));let prevented=false;a.events.get('beforeunload')({preventDefault(){prevented=true;}});assert.equal(prevented,true);
a.run('clearAnswers();');assert.equal(a.run('submissionCache'),null);assert.equal(a.run('Object.keys(state.answers).length'),0);
assert.equal(html.match(/__SUBMIT_ENDPOINT__/g).length,1,'only the endpoint constant contains the replacement marker');
assert.ok(html.includes("case'submit':submitAnswers();break;"));
console.log('PASS: endpoint/invitation/empty guards, form POST contract, metadata, stable IDs, double click, hidden answers, retry failure, draft compatibility, beforeunload, and clearing. No network requests made.');
