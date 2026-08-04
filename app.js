import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseApp=initializeApp(firebaseConfig), auth=getAuth(firebaseApp), firestore=getFirestore(firebaseApp);
const $=id=>document.getElementById(id);
let profile=null, pendingLogoDataUrl=null;
let db={plants:[],employees:[],epis:[],movements:[],users:[],audit:[],settings:{}};

const plantName=id=>db.plants.find(x=>x.id===id)?.name||"-";
const emp=id=>db.employees.find(x=>x.id===id);
const epi=id=>db.epis.find(x=>x.id===id);
const role=()=>profile?.role||"";
const isOwner=()=>role()==="PROPRIETARIO"||profile?.isOwner===true;
const isAdmin=()=>isOwner()||role()==="ADMINISTRADOR";
const isSSMA=()=>isAdmin()||role()==="SSMA";
const canView=()=>isSSMA()||role()==="VISUALIZADOR";
const canDeleteOperational=()=>isAdmin();
const stockQty=p=>Math.max(0,Number(p?.stockQty??0)||0);
const fmtRaw=v=>v?.toDate?v.toDate():v||0;
const fmtDate=s=>{if(!s)return"-";const d=s?.toDate?s.toDate():new Date(s);return d.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"})};
const sigLabel=v=>v==="ASSINADO"?"Assinado":"Pendente";
const sigClass=v=>v==="ASSINADO"?"ok":"danger";
const humanRole=v=>({PROPRIETARIO:"Proprietário",ADMINISTRADOR:"Administrador",SSMA:"SSMA",VISUALIZADOR:"Visualizador"}[v]||v||"-");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const escAttr=v=>esc(v).replace(/`/g,"&#96;");

function showLoginError(msg){$("loginError").textContent=msg;$("loginError").classList.add("show")}
function clearLoginError(){$("loginError").classList.remove("show")}
function loadCachedBrand(){try{const c=JSON.parse(localStorage.getItem("epiCompanyBrand")||"null");if(c?.logoDataUrl){$("sidebarBrandLogo").src=c.logoDataUrl}$("loginBrandLogo").src="./logo-symbol.png";if(c?.companyName)$("sidebarCompanyName").textContent=c.companyName}catch(_){$("loginBrandLogo").src="./logo-symbol.png"}}
function cacheBrand(){localStorage.setItem("epiCompanyBrand",JSON.stringify({companyName:db.settings.companyName||"",logoDataUrl:db.settings.logoDataUrl||""}))}
function applyBranding(){const src=db.settings.logoDataUrl||"./logo-symbol.png", name=db.settings.companyName||"Gestão de EPIs";$("sidebarBrandLogo").src=src;$("loginBrandLogo").src="./logo-symbol.png";$("companyLogoPreview").src=src;$("sidebarCompanyName").textContent=name;$("sidebarSystemName").textContent=name==="Gestão de EPIs"?"Controle e Gestão":"Gestão de EPIs";cacheBrand()}
loadCachedBrand();

$("loginForm").addEventListener("submit",async e=>{e.preventDefault();clearLoginError();try{await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}catch(err){console.error(err);showLoginError("Não foi possível entrar. Confira o e-mail e a senha.")}});
$("logoutBtn").addEventListener("click",()=>signOut(auth));

onAuthStateChanged(auth,async user=>{if(!user){profile=null;$("loginScreen").classList.remove("hidden");return}try{const snap=await getDoc(doc(firestore,"users",user.uid));if(!snap.exists())throw new Error("Sem perfil");profile={uid:user.uid,email:user.email,...snap.data()};if(profile.status!=="ATIVO")throw new Error("Inativo");updateProfileUI();applyPermissions();await loadAll();$("loginScreen").classList.add("hidden")}catch(err){console.error(err);await signOut(auth);showLoginError("Sua conta existe, mas não está autorizada corretamente no sistema.")}});
function updateProfileUI(){$("userName").textContent=profile?.name||profile?.email?.split("@")[0]||"Usuário";$("userRole").textContent=humanRole(role());$("userPlant").textContent=profile?.plantId==="TODAS"?"Todas as usinas":plantName(profile?.plantId)}
function applyPermissions(){document.querySelector('[data-view="usuarios"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="auditoria"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="configuracoes"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="movimentacoes"]').style.display=isSSMA()?"":"none";document.querySelector('[data-view="colaboradores"]').style.display=canView()?"":"none";document.querySelector('[data-view="epis"]').style.display=canView()?"":"none";document.querySelectorAll(".action-ssma").forEach(b=>b.style.display=isSSMA()?"":"none")}

async function readCollection(name){const snap=await getDocs(collection(firestore,name));return snap.docs.map(d=>({id:d.id,...d.data()}))}
async function readSettings(){const snap=await getDoc(doc(firestore,"settings","company"));return snap.exists()?snap.data():{}}
async function loadAll(){const tasks=[readCollection("plants"),readCollection("employees"),readCollection("epis"),readCollection("movements"),readSettings()];if(isAdmin())tasks.push(readCollection("users"),readCollection("auditLogs"));const res=await Promise.all(tasks);db.plants=res[0];db.employees=res[1];db.epis=res[2];db.movements=res[3];db.settings=res[4]||{};db.users=isAdmin()?res[5]:[];db.audit=isAdmin()?res[6]:[];pendingLogoDataUrl=db.settings.logoDataUrl||null;applyBranding();updateProfileUI();refresh()}

function navTo(view){document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));$(view).classList.add("active");document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));const t={dashboard:["Painel geral","Indicadores do controle de EPIs."],movimentacoes:["Entregas e Devoluções","Registre e acompanhe movimentações."],colaboradores:["Colaboradores","Cadastro e histórico dos colaboradores."],epis:["Catálogo de EPIs","Controle de EPIs separado por usina."],relatorios:["Relatórios","Gere relatórios conforme os filtros selecionados."],usuarios:["Usuários e perfis","Gerencie nomes e acessos do sistema."],auditoria:["Auditoria","Rastreabilidade das ações realizadas."],configuracoes:["Configurações","Empresa, logo e cadastro das usinas."]};$("pageTitle").textContent=t[view][0];$("pageSubtitle").textContent=t[view][1]}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{navTo(b.dataset.view);closeMobileMenu()});
function openMobileMenu(){document.querySelector(".sidebar").classList.add("mobile-open");$("mobileMenuOverlay").classList.add("show");document.body.classList.add("menu-open")}
function closeMobileMenu(){document.querySelector(".sidebar").classList.remove("mobile-open");$("mobileMenuOverlay").classList.remove("show");document.body.classList.remove("menu-open")}
$("mobileMenuBtn").addEventListener("click",()=>document.querySelector(".sidebar").classList.contains("mobile-open")?closeMobileMenu():openMobileMenu());
$("mobileMenuOverlay").addEventListener("click",closeMobileMenu);
window.closeMobileMenu=closeMobileMenu;

function renderDashboard(){
  const now=new Date(),m=now.getMonth(),y=now.getFullYear();
  const month=db.movements.filter(x=>{const d=new Date(fmtRaw(x.date));return d.getMonth()===m&&d.getFullYear()===y});
  const ent=month.filter(x=>x.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0);
  const dev=month.filter(x=>x.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0);
  const stock=db.epis.reduce((a,p)=>a+stockQty(p),0);
  const pend=db.movements.filter(x=>(x.signatureStatus||"PENDENTE")!=="ASSINADO").length;

  const kpis=[
    {label:"EPIs entregues no mês",value:ent,detail:"Quantidade entregue"},
    {label:"Devoluções no mês",value:dev,detail:"Quantidade devolvida"},
    {label:"Itens em estoque",value:stock,detail:"Saldo das usinas"},
    {label:"Assinaturas pendentes",value:pend,detail:"Clique para visualizar",click:true}
  ];
  $("kpis").innerHTML=kpis.map(x=>x.click
    ? `<button class="kpi kpi-clickable" onclick="openPendingSignatures()"><span>${x.label}</span><strong>${x.value}</strong><small>${x.detail}</small></button>`
    : `<div class="kpi"><span>${x.label}</span><strong>${x.value}</strong><small>${x.detail}</small></div>`
  ).join("");

  const alerts=[];
  db.epis.filter(p=>stockQty(p)===0).slice(0,8).forEach(p=>alerts.push(`<div class="alert"><span class="pill danger">Sem estoque</span><div><strong>${esc(p.name)}</strong><span>${esc(plantName(p.plantId))}</span></div></div>`));
  if(pend)alerts.push(`<button class="alert alert-button" onclick="openPendingSignatures()"><span class="pill warning">Assinaturas</span><div><strong>${pend} pendente(s)</strong><span>Toque para abrir as movimentações pendentes.</span></div></button>`);
  $("alerts").innerHTML=alerts.join("")||'<div class="empty-state">Sem alertas no momento.</div>';

  $("recentMoves").innerHTML=[...db.movements].sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).slice(0,6).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(emp(x.employeeId)?.name||"-")}</td><td>${esc(epi(x.epiId)?.name||"-")}</td><td><span class="status ${x.type==="Entrega"?"info":"ok"}">${esc(x.type)}</span></td><td><span class="status ${sigClass(x.signatureStatus)}">${sigLabel(x.signatureStatus)}</span></td></tr>`).join("")||'<tr><td colspan="5" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
}
function openPendingSignatures(){
  navTo("movimentacoes");
  $("movSignature").value="PENDENTE";
  $("movType").value="";
  $("movSearch").value="";
  renderMovements();
  closeMobileMenu();
}
window.openPendingSignatures=openPendingSignatures;

function returnText(x){if(x.type!=="Devolução")return"-";return x.returnDisposition==="DESCARTE"?"Descarte":"Reestoque"}
function renderMovements(){const q=($("movSearch")?.value||"").toLowerCase(),type=$("movType")?.value||"",sig=$("movSignature")?.value||"";const rows=[...db.movements].sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).filter(x=>(!type||x.type===type)&&(!sig||(x.signatureStatus||"PENDENTE")===sig)&&(((emp(x.employeeId)?.name||"").toLowerCase().includes(q))||((epi(x.epiId)?.name||"").toLowerCase().includes(q))));$("movementsTable").innerHTML=rows.map(x=>`<tr><td>${fmtDate(x.date)}</td><td><span class="status ${x.type==="Entrega"?"info":"ok"}">${esc(x.type)}</span></td><td>${esc(emp(x.employeeId)?.name||"-")}</td><td>${esc(plantName(x.plantId))}</td><td>${esc(epi(x.epiId)?.name||"-")}</td><td>${x.qty||0}</td><td>${esc(x.size||"-")}</td><td>${esc(returnText(x))}</td><td><span class="status ${sigClass(x.signatureStatus)}">${sigLabel(x.signatureStatus)}</span></td><td class="obs-cell">${esc(x.obs||"-")}</td><td class="action-cell"><button class="table-action" onclick="openSignatureModal('${x.id}','${x.signatureStatus||"PENDENTE"}')">Assinatura</button>${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeMovement('${x.id}')">Remover</button>`:""}</td></tr>`).join("")||'<tr><td colspan="11" class="empty-state">Nenhuma movimentação registrada.</td></tr>'}

function renderEmployees(){
  const q=($("empSearch")?.value||"").toLowerCase();
  $("employeesTable").innerHTML=db.employees
    .filter(e=>(e.name||"").toLowerCase().includes(q)||(e.reg||"").toLowerCase().includes(q))
    .map(e=>{
      const last=[...db.movements].filter(m=>m.employeeId===e.id&&m.type==="Entrega").sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)))[0];
      return `<tr>
        <td><button class="employee-name-link" onclick="openEmployeeHistory('${e.id}')">${esc(e.name)}</button></td>
        <td>${esc(e.reg||"-")}</td>
        <td>${esc(e.role||"-")}</td>
        <td>${esc(plantName(e.plantId))}</td>
        <td><span class="status ok">${esc(e.status||"Ativo")}</span></td>
        <td>${last?fmtDate(last.date):"Sem registro"}</td>
        <td class="action-cell">
          <button class="table-action" onclick="openEmployeeHistory('${e.id}')">Histórico</button>
          ${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEmployee('${e.id}')">Remover</button>`:""}
        </td>
      </tr>`;
    }).join("")||'<tr><td colspan="7" class="empty-state">Nenhum colaborador cadastrado.</td></tr>';
}

function openEmployeeHistory(id){
  const e=emp(id);
  if(!e)return;
  const moves=[...db.movements].filter(m=>m.employeeId===id).sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)));
  const delivered=moves.filter(m=>m.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0);
  const returned=moves.filter(m=>m.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0);
  const pending=moves.filter(m=>(m.signatureStatus||"PENDENTE")!=="ASSINADO").length;

  $("employeeHistoryTitle").textContent=e.name;
  $("employeeHistoryMeta").textContent=`${e.role||"Função não informada"} • ${plantName(e.plantId)} • Matrícula ${e.reg||"-"}`;
  $("employeeHistorySummary").innerHTML=`
    <div class="history-stat"><span>Entregue</span><strong>${delivered}</strong></div>
    <div class="history-stat"><span>Devolvido</span><strong>${returned}</strong></div>
    <div class="history-stat"><span>Registros</span><strong>${moves.length}</strong></div>
    <div class="history-stat ${pending?"history-stat-alert":""}"><span>Assinaturas pendentes</span><strong>${pending}</strong></div>
  `;
  $("employeeHistoryTable").innerHTML=moves.map(m=>`<tr>
    <td>${fmtDate(m.date)}</td>
    <td><span class="status ${m.type==="Entrega"?"info":"ok"}">${esc(m.type)}</span></td>
    <td>${esc(epi(m.epiId)?.name||"-")}</td>
    <td>${m.qty||0}</td>
    <td>${esc(m.size||"-")}</td>
    <td>${esc(returnText(m))}</td>
    <td><span class="status ${sigClass(m.signatureStatus)}">${sigLabel(m.signatureStatus)}</span></td>
    <td>${esc(m.obs||"-")}</td>
  </tr>`).join("")||'<tr><td colspan="8" class="empty-state">Nenhuma entrega ou devolução registrada.</td></tr>';
  $("employeeHistoryModal").classList.add("open");
}
window.openEmployeeHistory=openEmployeeHistory;

function renderEpis(){$("episTable").innerHTML=[...db.epis].sort((a,b)=>(plantName(a.plantId)+a.name).localeCompare(plantName(b.plantId)+b.name)).map(p=>`<tr><td>${esc(plantName(p.plantId))}</td><td>${esc(p.name||"-")}</td><td>${esc(p.ca||"-")}</td><td>${esc(p.unit||"-")}</td><td>${esc((p.sizes||[]).join(", ")||"Único")}</td><td><span class="stock-number ${stockQty(p)===0?"stock-zero":""}">${stockQty(p)}</span></td><td class="action-cell">${isSSMA()?`<button class="table-action" onclick="openEpiModal('${p.id}')">Editar</button>`:""}${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEpi('${p.id}')">Remover</button>`:""}</td></tr>`).join("")||'<tr><td colspan="7" class="empty-state">Nenhum EPI cadastrado.</td></tr>'}

function renderPlants(){$("plantsGrid").innerHTML=db.plants.map(p=>`<div class="plant-card"><strong>${esc(p.name)}</strong>${canDeleteOperational()?`<button class="mini-remove" onclick="removePlant('${p.id}')">Remover</button>`:""}</div>`).join("")||'<div class="empty-state">Nenhuma usina cadastrada.</div>'}
function renderUsers(){$("usersTable").innerHTML=db.users.map(u=>`<tr><td>${esc(u.name||u.email||"-")}</td><td>${esc(u.email||"-")}</td><td><span class="status info">${esc(humanRole(u.role))}</span></td><td>${esc(u.plantId==="TODAS"?"Todas as usinas":plantName(u.plantId))}</td><td><span class="status ok">${esc(u.status||"-")}</span></td><td class="action-cell"><button class="table-action" onclick="openUserEdit('${u.id}')">Editar nome</button>${isOwner()&&u.id!==auth.currentUser.uid?`<button class="table-action danger-btn" onclick="removeUser('${u.id}')">Remover</button>`:""}</td></tr>`).join("")}
function renderAudit(){$("auditTable").innerHTML=[...db.audit].sort((a,b)=>new Date(fmtRaw(b.createdAt))-new Date(fmtRaw(a.createdAt))).map(a=>`<tr><td>${fmtDate(a.createdAt)}</td><td>${esc(a.userName||a.userEmail||"-")}</td><td><span class="status info">${esc(a.action||"-")}</span></td><td>${esc(a.record||"-")}</td></tr>`).join("")}
function renderSettings(){$("companyName").value=db.settings.companyName||"";$("companyLogoPreview").src=db.settings.logoDataUrl||"./logo-symbol.png";renderPlants()}
function refresh(){renderDashboard();renderMovements();renderEmployees();renderEpis();renderUsers();renderAudit();renderSettings();populateSelects();populateReportFilters()}

function populateSelects(){const employees=db.employees.filter(e=>e.status==="Ativo");$("mEmployeeSuggestions").innerHTML=employees.map(e=>`<option value="${escAttr(e.name)}"></option>`).join("");$("ePlant").innerHTML=db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");$("pPlant").innerHTML=db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");resolveMovementEmployee(false)}
function resolveMovementEmployee(refreshEpis=true){const typed=($("mEmployeeSearch")?.value||"").trim().toLowerCase();const employee=db.employees.find(e=>e.status==="Ativo"&&(e.name||"").trim().toLowerCase()===typed);$("mEmployeeId").value=employee?.id||"";if($("mPlant"))$("mPlant").value=employee?plantName(employee.plantId):"";if(refreshEpis)updateMovementPlantAndEpis(employee);else if(!employee&&$("mEpi")){$("mEpi").innerHTML='<option value="">Digite e selecione o colaborador</option>';$("mSize").innerHTML='<option value="">-</option>'}return employee}
function updateMovementPlantAndEpis(employee=resolveMovementEmployee(false)){if(!$("mEpi"))return;const available=employee?db.epis.filter(p=>p.plantId===employee.plantId):[];$("mEpi").innerHTML=available.length?available.map(p=>`<option value="${p.id}">${esc(p.name)} — estoque ${stockQty(p)}</option>`).join(""):'<option value="">Nenhum EPI disponível para esta usina</option>';updateMovementSizes()}
function updateMovementSizes(){const p=epi($("mEpi")?.value);if(!$("mSize"))return;const sizes=(p?.sizes||[]).filter(Boolean);$("mSize").innerHTML=(sizes.length?sizes:["Único"]).map(s=>`<option value="${escAttr(s)}">${esc(s)}</option>`).join("")}
$("mEmployeeSearch").addEventListener("input",()=>resolveMovementEmployee(true));$("mEmployeeSearch").addEventListener("change",()=>resolveMovementEmployee(true));$("mEpi").addEventListener("change",updateMovementSizes);$("mType").addEventListener("change",()=>$("returnDispositionWrap").classList.toggle("hidden",$("mType").value!=="Devolução"));

function closeModal(id){$(id).classList.remove("open")}window.closeModal=closeModal;
function openMovementModal(){if(!db.employees.length){alert("Cadastre um colaborador antes.");return}populateSelects();$("mEmployeeSearch").value="";$("mEmployeeId").value="";$("mPlant").value="";$("mEpi").innerHTML='<option value="">Digite e selecione o colaborador</option>';$("mSize").innerHTML='<option value="">-</option>';$("mDate").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);$("mQty").value=1;$("mSignature").value="ASSINADO";$("mType").value="Entrega";$("returnDispositionWrap").classList.add("hidden");$("mObs").value="";$("movementModal").classList.add("open");setTimeout(()=>$("mEmployeeSearch").focus(),50)}window.openMovementModal=openMovementModal;
function openEmployeeModal(){if(!db.plants.length){alert("Cadastre uma usina em Configurações antes.");return}populateSelects();$("employeeModal").classList.add("open")}window.openEmployeeModal=openEmployeeModal;
function openEpiModal(id=""){$("epiForm").reset();populateSelects();$("pId").value=id;if(id){const p=epi(id);if(!p)return;$("epiModalTitle").textContent="Editar EPI / Reabastecer";$("epiSaveButton").textContent="Salvar alterações";$("pPlant").value=p.plantId||"";$("pName").value=p.name||"";$("pCA").value=p.ca||"";$("pUnit").value=p.unit||"Unidade";$("pSizes").value=(p.sizes||[]).join(", ");$("pStock").value=stockQty(p)}else{$("epiModalTitle").textContent="Novo EPI";$("epiSaveButton").textContent="Cadastrar";$("pStock").value=0}$("epiModal").classList.add("open")}window.openEpiModal=openEpiModal;
function openPlantModal(){$("plantModal").classList.add("open")}window.openPlantModal=openPlantModal;
function openSignatureModal(id,current){$("signatureMovementId").value=id;$("signatureStatus").value=current==="ASSINADO"?"ASSINADO":"PENDENTE";$("signatureModal").classList.add("open")}window.openSignatureModal=openSignatureModal;
function openUserEdit(id){const u=db.users.find(x=>x.id===id);if(!u)return;$("editUserId").value=id;$("editUserName").value=u.name||"";$("userEditModal").classList.add("open")}window.openUserEdit=openUserEdit;

async function logAudit(action,record){await addDoc(collection(firestore,"auditLogs"),{action,record,userUid:auth.currentUser.uid,userEmail:auth.currentUser.email,userName:profile.name||auth.currentUser.email,createdAt:serverTimestamp()})}
$("plantForm").onsubmit=async e=>{e.preventDefault();try{const name=$("uName").value.trim();await addDoc(collection(firestore,"plants"),{name,createdAt:serverTimestamp(),createdBy:auth.currentUser.uid});await logAudit("CADASTRO_USINA",name);e.target.reset();closeModal("plantModal");await loadAll()}catch(err){console.error(err);alert("Não foi possível cadastrar a usina.")}};
$("employeeForm").onsubmit=async e=>{e.preventDefault();try{const data={name:$("eName").value.trim(),reg:$("eReg").value.trim(),role:$("eRole").value.trim(),plantId:$("ePlant").value,admission:$("eAdmission").value,status:"Ativo",createdAt:serverTimestamp(),createdBy:auth.currentUser.uid};await addDoc(collection(firestore,"employees"),data);await logAudit("CADASTRO_COLABORADOR",data.name);e.target.reset();closeModal("employeeModal");await loadAll()}catch(err){console.error(err);alert("Não foi possível cadastrar o colaborador.")}};
$("epiForm").onsubmit=async e=>{e.preventDefault();try{const id=$("pId").value,data={plantId:$("pPlant").value,name:$("pName").value.trim(),ca:$("pCA").value.trim(),unit:$("pUnit").value,sizes:$("pSizes").value.split(",").map(x=>x.trim()).filter(Boolean),stockQty:Math.max(0,+$("pStock").value||0),updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid};if(id){await setDoc(doc(firestore,"epis",id),data,{merge:true});await logAudit("EDICAO_EPI",`${data.name} — ${plantName(data.plantId)} — estoque ${data.stockQty}`)}else{data.createdAt=serverTimestamp();data.createdBy=auth.currentUser.uid;await addDoc(collection(firestore,"epis"),data);await logAudit("CADASTRO_EPI",`${data.name} — ${plantName(data.plantId)} — estoque ${data.stockQty}`)}e.target.reset();closeModal("epiModal");await loadAll()}catch(err){console.error(err);alert("Não foi possível salvar o EPI.")}};

$("movementForm").onsubmit=async e=>{e.preventDefault();const employee=resolveMovementEmployee(false),type=$("mType").value,qty=Math.max(1,+$("mQty").value||1),epiId=$("mEpi").value,p=epi(epiId);if(!employee){alert("Selecione um colaborador sugerido pelo sistema.");return}if(!p){alert("Selecione um EPI.");return}if(p.plantId!==employee.plantId){alert("O EPI selecionado não pertence à usina do colaborador.");return}const epiRef=doc(firestore,"epis",epiId),moveRef=doc(collection(firestore,"movements"));try{await runTransaction(firestore,async tx=>{const es=await tx.get(epiRef);if(!es.exists())throw new Error("EPI_NAO_ENCONTRADO");const current=stockQty(es.data());let next=current;const disposition=type==="Devolução"?$("mReturnDisposition").value:null;if(type==="Entrega"){if(current<qty)throw new Error("ESTOQUE_INSUFICIENTE");next=current-qty}else if(disposition==="REESTOQUE")next=current+qty;if(next!==current)tx.update(epiRef,{stockQty:next,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});tx.set(moveRef,{date:new Date($("mDate").value),type,employeeId:employee.id,plantId:employee.plantId,epiId,qty,size:$("mSize").value,signatureStatus:$("mSignature").value,returnDisposition:disposition,obs:$("mObs").value.trim(),userUid:auth.currentUser.uid,userEmail:auth.currentUser.email,userName:profile.name||auth.currentUser.email,createdAt:serverTimestamp()})});await logAudit(type.toUpperCase(),`${p.name} → ${employee.name}`);e.target.reset();closeModal("movementModal");await loadAll()}catch(err){console.error(err);alert(err.message==="ESTOQUE_INSUFICIENTE"?"Estoque insuficiente para esta entrega.":"Não foi possível registrar a movimentação.")}};

$("signatureForm").onsubmit=async e=>{e.preventDefault();try{await updateDoc(doc(firestore,"movements",$("signatureMovementId").value),{signatureStatus:$("signatureStatus").value,signatureUpdatedAt:serverTimestamp(),signatureUpdatedBy:auth.currentUser.uid});await logAudit("ASSINATURA_EPI",`Movimentação ${$("signatureMovementId").value}: ${$("signatureStatus").value}`);closeModal("signatureModal");await loadAll()}catch(err){console.error(err);alert("Não foi possível alterar a assinatura.")}};
$("userEditForm").onsubmit=async e=>{e.preventDefault();try{const id=$("editUserId").value,name=$("editUserName").value.trim();await updateDoc(doc(firestore,"users",id),{name,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});await logAudit("EDICAO_USUARIO",name);if(id===auth.currentUser.uid)profile.name=name;closeModal("userEditModal");await loadAll()}catch(err){console.error(err);alert("Não foi possível editar o nome do usuário.")}};

async function removeMovement(id){if(!canDeleteOperational())return;if(!confirm("Remover esta movimentação? O estoque será ajustado automaticamente."))return;const moveRef=doc(firestore,"movements",id);try{await runTransaction(firestore,async tx=>{const ms=await tx.get(moveRef);if(!ms.exists())return;const m=ms.data(),er=doc(firestore,"epis",m.epiId),es=await tx.get(er);if(es.exists()){const current=stockQty(es.data()),qty=+m.qty||0;let next=current;if(m.type==="Entrega")next=current+qty;else if(m.type==="Devolução"&&(m.returnDisposition||"REESTOQUE")==="REESTOQUE"){if(current<qty)throw new Error("ESTOQUE_INCONSISTENTE");next=current-qty}if(next!==current)tx.update(er,{stockQty:next,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid})}tx.delete(moveRef)});await logAudit("REMOCAO_MOVIMENTACAO",id);await loadAll()}catch(err){console.error(err);alert(err.message==="ESTOQUE_INCONSISTENTE"?"Não é possível remover esta devolução porque parte desse estoque já foi utilizado.":"Não foi possível remover a movimentação.")}}window.removeMovement=removeMovement;
async function removeEmployee(id){if(!canDeleteOperational())return;if(db.movements.some(m=>m.employeeId===id)){alert("Este colaborador possui movimentações. Remova as movimentações relacionadas antes.");return}const e=emp(id);if(!confirm(`Remover ${e?.name||"este colaborador"}?`))return;try{await deleteDoc(doc(firestore,"employees",id));await logAudit("REMOCAO_COLABORADOR",e?.name||id);await loadAll()}catch(err){console.error(err);alert("Não foi possível remover o colaborador.")}}window.removeEmployee=removeEmployee;
async function removeEpi(id){if(!canDeleteOperational())return;if(db.movements.some(m=>m.epiId===id)){alert("Este EPI possui movimentações. Remova as movimentações relacionadas antes.");return}const p=epi(id);if(!confirm(`Remover ${p?.name||"este EPI"}?`))return;try{await deleteDoc(doc(firestore,"epis",id));await logAudit("REMOCAO_EPI",p?.name||id);await loadAll()}catch(err){console.error(err);alert("Não foi possível remover o EPI.")}}window.removeEpi=removeEpi;
async function removePlant(id){if(!canDeleteOperational())return;if(db.employees.some(e=>e.plantId===id)||db.epis.some(p=>p.plantId===id)){alert("Esta usina possui colaboradores ou EPIs vinculados. Remova ou transfira esses cadastros antes.");return}const name=plantName(id);if(!confirm(`Remover a usina ${name}?`))return;try{await deleteDoc(doc(firestore,"plants",id));await logAudit("REMOCAO_USINA",name);await loadAll()}catch(err){console.error(err);alert("Não foi possível remover a usina.")}}window.removePlant=removePlant;
async function removeUser(id){if(!isOwner())return;if(id===auth.currentUser.uid){alert("O proprietário não pode remover o próprio acesso enquanto estiver conectado.");return}const u=db.users.find(x=>x.id===id);if(!confirm(`Remover o acesso de ${u?.name||u?.email||"este usuário"}?`))return;try{await deleteDoc(doc(firestore,"users",id));await logAudit("REMOCAO_USUARIO",u?.email||id);await loadAll()}catch(err){console.error(err);alert("Não foi possível remover o usuário.")}}window.removeUser=removeUser;

function resizeLogo(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>{const i=new Image();i.onerror=reject;i.onload=()=>{const max=420,s=Math.min(1,max/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(i.width*s));c.height=Math.max(1,Math.round(i.height*s));c.getContext("2d").drawImage(i,0,0,c.width,c.height);resolve(c.toDataURL("image/png",.92))};i.src=r.result};r.readAsDataURL(file)})}
$("companyLogoFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{pendingLogoDataUrl=await resizeLogo(f);$("companyLogoPreview").src=pendingLogoDataUrl}catch(err){console.error(err);alert("Não foi possível processar a imagem.")}});$("removeCompanyLogo").addEventListener("click",()=>{pendingLogoDataUrl="";$("companyLogoFile").value="";$("companyLogoPreview").src="./logo-symbol.png"});$("companyForm").onsubmit=async e=>{e.preventDefault();try{const data={companyName:$("companyName").value.trim(),logoDataUrl:pendingLogoDataUrl||"",updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid};await setDoc(doc(firestore,"settings","company"),data,{merge:true});await logAudit("CONFIGURACOES_EMPRESA",data.companyName);await loadAll()}catch(err){console.error(err);alert("Não foi possível salvar as configurações.")}};

function populateReportFilters(){const currentPlant=$("reportPlant").value;$("reportEmployeeSuggestions").innerHTML=db.employees.map(e=>`<option value="${escAttr(e.name)}"></option>`).join("");$("reportPlant").innerHTML='<option value="">Todas as usinas</option>'+db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");if([...$("reportPlant").options].some(o=>o.value===currentPlant))$("reportPlant").value=currentPlant;updateReportSummary()}
function resolveReportEmployee(refresh=true){const value=$("reportEmployeeSearch").value.trim().toLowerCase();const exact=db.employees.find(e=>(e.name||"").trim().toLowerCase()===value);$("reportEmployeeId").value=exact?.id||"";if(exact){$("reportPlant").value=exact.plantId;$("reportPlant").disabled=true}else{$("reportPlant").disabled=false}if(refresh)updateReportSummary()}
$("reportEmployeeSearch").addEventListener("input",resolveReportEmployee);$("reportPlant").addEventListener("change",updateReportSummary);$("reportFrom").addEventListener("change",updateReportSummary);$("reportTo").addEventListener("change",updateReportSummary);
function filteredReportMoves(showAlert=false){resolveReportEmployee(false);const typed=$("reportEmployeeSearch").value.trim(),employeeId=$("reportEmployeeId").value,plantId=$("reportPlant").value,from=$("reportFrom").value?new Date($("reportFrom").value+"T00:00:00"):null,to=$("reportTo").value?new Date($("reportTo").value+"T23:59:59"):null;if(showAlert&&typed&&!employeeId){alert("Selecione um colaborador sugerido pelo sistema ou apague o nome para gerar por usina/período.");return null}return [...db.movements].filter(m=>{const d=new Date(fmtRaw(m.date));return(!employeeId||m.employeeId===employeeId)&&(!plantId||m.plantId===plantId)&&(!from||d>=from)&&(!to||d<=to)}).sort((a,b)=>new Date(fmtRaw(a.date))-new Date(fmtRaw(b.date)))}
function updateReportSummary(){const rows=filteredReportMoves(false)||[];const ent=rows.filter(x=>x.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),dev=rows.filter(x=>x.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0);$("reportSummary").textContent=`${rows.length} registro(s) encontrado(s) • ${ent} entregue(s) • ${dev} devolvido(s)`}
function clearReportFilters(){$("reportEmployeeSearch").value="";$("reportEmployeeId").value="";$("reportPlant").disabled=false;$("reportPlant").value="";$("reportFrom").value="";$("reportTo").value="";updateReportSummary()}window.clearReportFilters=clearReportFilters;
function reportHeader(){const logo=db.settings.logoDataUrl?`<img src="${db.settings.logoDataUrl}" alt="Logo">`:"",company=esc(db.settings.companyName||"Empresa");return`<div class="r-head">${logo}<div><h1>${company}</h1><h2>Gestão de EPIs</h2></div></div>`}
function printFilteredReport(){const rows=filteredReportMoves(true);if(!rows)return;const employeeId=$("reportEmployeeId").value,employee=emp(employeeId),plantId=$("reportPlant").value,sub=[employee?`Colaborador: ${employee.name}`:"",plantId?`Usina: ${plantName(plantId)}`:"Todas as usinas",$("reportFrom").value?`A partir de: ${new Date($("reportFrom").value+"T12:00").toLocaleDateString("pt-BR")}`:"",$("reportTo").value?`Até: ${new Date($("reportTo").value+"T12:00").toLocaleDateString("pt-BR")}`:""] .filter(Boolean).join(" • ");const popup=window.open("","_blank");if(!popup){alert("Permita pop-ups para gerar o relatório.");return}const tr=rows.map(m=>`<tr><td>${esc(fmtDate(m.date))}</td><td>${esc(m.type)}</td><td>${esc(emp(m.employeeId)?.name||"-")}</td><td>${esc(plantName(m.plantId))}</td><td>${esc(epi(m.epiId)?.name||"-")}</td><td>${m.qty||0}</td><td>${esc(m.size||"-")}</td><td>${esc(returnText(m))}</td><td>${esc(sigLabel(m.signatureStatus))}</td><td>${esc(m.obs||"-")}</td></tr>`).join("");popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório de EPIs</title><style>body{font-family:Arial;padding:28px;color:#111}.r-head{display:flex;align-items:center;gap:16px;border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:16px}.r-head img{max-width:90px;max-height:70px;border-radius:8px}.r-head h1{margin:0;font-size:20px}.r-head h2{margin:3px 0 0;font-size:13px;font-weight:400;color:#555}h3{margin-bottom:4px}.sub{color:#555;font-size:12px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}.foot{font-size:10px;color:#666;margin-top:15px}</style></head><body>${reportHeader()}<h3>Relatório geral de EPIs</h3><p class="sub">${esc(sub)}</p><table><thead><tr><th>Data</th><th>Tipo</th><th>Colaborador</th><th>Usina</th><th>EPI</th><th>Qtd.</th><th>Tamanho</th><th>Destino devolução</th><th>Assinatura</th><th>Observações</th></tr></thead><tbody>${tr}</tbody></table><div class="foot">Emitido em ${new Date().toLocaleString("pt-BR")}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);popup.document.close()}window.printFilteredReport=printFilteredReport;
function downloadFilteredCSV(){const rows=filteredReportMoves(true);if(!rows)return;const data=[["Data","Tipo","Colaborador","Usina","EPI","Quantidade","Tamanho","Destino devolução","Assinatura","Observações"],...rows.map(m=>[fmtDate(m.date),m.type,emp(m.employeeId)?.name||"",plantName(m.plantId),epi(m.epiId)?.name||"",m.qty,m.size||"",returnText(m),sigLabel(m.signatureStatus),m.obs||""])];const csv=data.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n"),blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="relatorio-epis-filtrado.csv";a.click();URL.revokeObjectURL(a.href)}window.downloadFilteredCSV=downloadFilteredCSV;
