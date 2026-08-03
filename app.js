import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, addDoc, setDoc,
  serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const $ = id => document.getElementById(id);

let profile = null;
let db = {plants:[],employees:[],epis:[],stock:[],movements:[],users:[],audit:[]};

const plantName=id=>db.plants.find(x=>x.id===id)?.name||"-";
const emp=id=>db.employees.find(x=>x.id===id);
const epi=id=>db.epis.find(x=>x.id===id);
const fmtDate=s=>{
  if(!s) return "-";
  const d = s?.toDate ? s.toDate() : new Date(s);
  return d.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
};
const daysUntil=s=>{
  if(!s) return 99999;
  const d=s?.toDate?s.toDate():new Date(String(s).length===10?s+"T12:00":s);
  return Math.ceil((d-new Date())/86400000);
};
const role = () => profile?.role || "";
const isOwner=()=>role()==="PROPRIETARIO" || profile?.isOwner===true;
const isAdmin=()=>isOwner()||role()==="ADMINISTRADOR";
const isSSMA=()=>isAdmin()||role()==="SSMA";
const canView=()=>isSSMA()||role()==="VISUALIZADOR";

function showLoginError(msg){$("loginError").textContent=msg;$("loginError").classList.add("show")}
function clearLoginError(){$("loginError").classList.remove("show")}

$("loginForm").addEventListener("submit", async e=>{
  e.preventDefault(); clearLoginError();
  try{
    await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value);
  }catch(err){
    console.error(err);
    showLoginError("Não foi possível entrar. Confira o e-mail e a senha.");
  }
});
$("logoutBtn").addEventListener("click",()=>signOut(auth));

onAuthStateChanged(auth, async user=>{
  if(!user){profile=null;$("loginScreen").classList.remove("hidden");return}
  try{
    const snap=await getDoc(doc(firestore,"users",user.uid));
    if(!snap.exists()) throw new Error("Usuário sem perfil no Firestore.");
    profile={uid:user.uid,email:user.email,...snap.data()};
    if(profile.status!=="ATIVO") throw new Error("Usuário não está ativo.");
    $("userName").textContent=profile.name||user.email.split("@")[0];
    $("userRole").textContent=profile.role||"SEM PERFIL";
    $("userAvatar").textContent=(profile.name||user.email).split(/[\s@]/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
    applyPermissions();
    await loadAll();
    $("loginScreen").classList.add("hidden");
  }catch(err){
    console.error(err);
    await signOut(auth);
    showLoginError("Sua conta existe, mas não está autorizada corretamente no sistema.");
  }
});

function applyPermissions(){
  document.querySelector('[data-view="usuarios"]').style.display=isAdmin()?"":"none";
  document.querySelector('[data-view="auditoria"]').style.display=isAdmin()?"":"none";
  document.querySelector('[data-view="usinas"]').style.display=isAdmin()?"":"none";
  document.querySelector('[data-view="movimentacoes"]').style.display=isSSMA()?"":"none";
  document.querySelector('[data-view="colaboradores"]').style.display=canView()?"":"none";
  document.querySelector('[data-view="epis"]').style.display=canView()?"":"none";
  document.querySelector('[data-view="estoque"]').style.display=canView()?"":"none";
  $("btnNovaMov").style.display=isSSMA()?"":"none";
  document.querySelectorAll("#colaboradores .primary,#epis .primary,#usinas .primary").forEach(b=>{
    if(b.closest("#colaboradores")) b.style.display=isSSMA()?"":"none";
    if(b.closest("#epis")||b.closest("#usinas")) b.style.display=isAdmin()?"":"none";
  });
}

async function readCollection(name){
  const snap=await getDocs(collection(firestore,name));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function loadAll(){
  const tasks=[
    readCollection("plants"),readCollection("employees"),readCollection("epis"),
    readCollection("stock"),readCollection("movements")
  ];
  if(isAdmin()){tasks.push(readCollection("users"),readCollection("auditLogs"))}
  const res=await Promise.all(tasks);
  db.plants=res[0];db.employees=res[1];db.epis=res[2];db.stock=res[3];db.movements=res[4];
  db.users=isAdmin()?res[5]:[];db.audit=isAdmin()?res[6]:[];
  refresh();
}

function navTo(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $(view).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const titles={dashboard:["Dashboard","Visão geral do controle de EPIs."],movimentacoes:["Entregas e Devoluções","Registre e consulte todas as movimentações."],colaboradores:["Colaboradores","Cadastro e ficha digital dos colaboradores."],epis:["Catálogo de EPIs","Cadastre EPI, C.A., validade e vida útil."],estoque:["Estoque","Controle de saldo e estoque mínimo por usina."],usinas:["Usinas","Unidades disponíveis no sistema."],relatorios:["Relatórios","Exportações e consultas gerenciais."],usuarios:["Usuários","Perfis e permissões de acesso."],auditoria:["Auditoria","Rastreabilidade das ações realizadas."]};
  $("pageTitle").textContent=titles[view][0];$("pageSubtitle").textContent=titles[view][1];
}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>navTo(b.dataset.view));
$("btnNovaMov").onclick=openMovementModal;

function renderDashboard(){
  const now=new Date(),month=now.getMonth(),year=now.getFullYear();
  const monthMoves=db.movements.filter(m=>{const d=m.date?.toDate?m.date.toDate():new Date(m.date);return d.getMonth()===month&&d.getFullYear()===year});
  const entregas=monthMoves.filter(m=>m.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0);
  const devol=monthMoves.filter(m=>m.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0);
  const low=db.stock.filter(s=>(+s.qty||0)<=(+s.min||0)).length;
  const caSoon=db.epis.filter(p=>daysUntil(p.caExpiry)<=120).length;
  $("kpis").innerHTML=[
    ["EPIs entregues no mês",entregas,"Movimentações confirmadas"],["Devoluções no mês",devol,"Devoluções registradas"],
    ["Estoque baixo",low,"Itens no mínimo ou abaixo"],["C.A. vencendo",caSoon,"Até 120 dias"]
  ].map(x=>`<div class="kpi"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");
  const alerts=[];
  db.stock.filter(s=>(+s.qty||0)<=(+s.min||0)).forEach(s=>alerts.push(`<div class="alert"><span class="pill danger">Estoque</span><div><strong>${epi(s.epiId)?.name||"EPI"}</strong><span>${plantName(s.plantId)} — ${s.qty} disponível(is), mínimo ${s.min}</span></div></div>`));
  db.epis.filter(p=>daysUntil(p.caExpiry)<=120).forEach(p=>alerts.push(`<div class="alert"><span class="pill warning">C.A.</span><div><strong>${p.name}</strong><span>C.A. ${p.ca} — ${daysUntil(p.caExpiry)<0?"vencido":daysUntil(p.caExpiry)+" dia(s) restantes"}</span></div></div>`));
  $("alerts").innerHTML=alerts.join("")||'<div class="empty-state">Sem alertas no momento.</div>';
  $("recentMoves").innerHTML=[...db.movements].sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).slice(0,6).map(m=>`<tr><td>${fmtDate(m.date)}</td><td>${emp(m.employeeId)?.name||"-"}</td><td>${epi(m.epiId)?.name||"-"}</td><td><span class="status ${m.type==="Entrega"?"info":"ok"}">${m.type}</span></td></tr>`).join("");
}
function fmtRaw(v){return v?.toDate?v.toDate():v||0}
function renderMovements(){
  const q=($("movSearch")?.value||"").toLowerCase(), type=$("movType")?.value||"";
  $("movementsTable").innerHTML=[...db.movements].sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).filter(m=>(!type||m.type===type)&&((emp(m.employeeId)?.name||"").toLowerCase().includes(q)||(epi(m.epiId)?.name||"").toLowerCase().includes(q))).map(m=>`<tr><td>${fmtDate(m.date)}</td><td>${emp(m.employeeId)?.name||"-"}</td><td>${plantName(m.plantId||emp(m.employeeId)?.plantId)}</td><td>${epi(m.epiId)?.name||"-"}</td><td>${m.qty}</td><td>${m.size||"-"}</td><td><span class="status ${m.type==="Entrega"?"info":"ok"}">${m.type}</span></td><td>${m.userName||m.userEmail||"-"}</td></tr>`).join("")||'<tr><td colspan="8" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
}
function renderEmployees(){
  const q=($("empSearch")?.value||"").toLowerCase();
  $("employeesTable").innerHTML=db.employees.filter(e=>e.name.toLowerCase().includes(q)||(e.reg||"").toLowerCase().includes(q)).map(e=>{const last=[...db.movements].filter(m=>m.employeeId===e.id&&m.type==="Entrega").sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)))[0];return `<tr><td>${e.name}</td><td>${e.reg}</td><td>${e.role}</td><td>${plantName(e.plantId)}</td><td><span class="status ok">${e.status}</span></td><td>${last?fmtDate(last.date):"Sem registro"}</td></tr>`}).join("")||'<tr><td colspan="6" class="empty-state">Nenhum colaborador cadastrado.</td></tr>';
}
function renderEpis(){
  $("episTable").innerHTML=db.epis.map(p=>{let d=daysUntil(p.caExpiry),cls=d<=60?"danger":d<=120?"warning":"ok";return `<tr><td>${p.name}</td><td>${p.ca}</td><td>${p.caExpiry?new Date(p.caExpiry+"T12:00").toLocaleDateString("pt-BR"):"-"}</td><td>${p.unit}</td><td>${p.lifeDays} dias</td><td>${(p.sizes||[]).join(", ")}</td><td><span class="status ${cls}">${d<0?"Vencido":d+" dias"}</span></td></tr>`}).join("")||'<tr><td colspan="7" class="empty-state">Nenhum EPI cadastrado.</td></tr>';
}
function renderStock(){
  $("stockTable").innerHTML=db.stock.map(s=>`<tr><td>${plantName(s.plantId)}</td><td>${epi(s.epiId)?.name||"-"}</td><td>${s.qty}</td><td>${s.min}</td><td><span class="status ${(+s.qty||0)<=(+s.min||0)?"danger":"ok"}">${(+s.qty||0)<=(+s.min||0)?"Reposição":"Normal"}</span></td></tr>`).join("")||'<tr><td colspan="5" class="empty-state">Nenhum estoque cadastrado ainda.</td></tr>';
}
function renderPlants(){$("plantsGrid").innerHTML=db.plants.map(p=>`<div class="plant-card"><strong>${p.name}</strong></div>`).join("")||'<div class="empty-state">Nenhuma usina cadastrada.</div>'}
function renderUsers(){$("usersTable").innerHTML=db.users.map(u=>`<tr><td>${u.name||u.email||"-"}</td><td>${u.email||"-"}</td><td><span class="status info">${u.role||"-"}</span></td><td>${u.plantId||u.plant||"-"}</td><td><span class="status ok">${u.status||"-"}</span></td></tr>`).join("")}
function renderAudit(){$("auditTable").innerHTML=[...db.audit].sort((a,b)=>new Date(fmtRaw(b.createdAt))-new Date(fmtRaw(a.createdAt))).map(a=>`<tr><td>${fmtDate(a.createdAt)}</td><td>${a.userName||a.userEmail||"-"}</td><td><span class="status info">${a.action}</span></td><td>${a.record||"-"}</td></tr>`).join("")}
function refresh(){renderDashboard();renderMovements();renderEmployees();renderEpis();renderStock();renderPlants();renderUsers();renderAudit();populateSelects()}
function populateSelects(){
  $("mEmployee").innerHTML=db.employees.filter(e=>e.status==="Ativo").map(e=>`<option value="${e.id}">${e.name} — ${plantName(e.plantId)}</option>`).join("");
  $("mEpi").innerHTML=db.epis.map(p=>`<option value="${p.id}">${p.name} — C.A. ${p.ca}</option>`).join("");
  $("ePlant").innerHTML=db.plants.map(p=>`<option value="${p.id}">${p.name}</option>`).join("");
}
function closeModal(id){$(id).classList.remove("open")}
window.closeModal=closeModal;
function openMovementModal(){
  if(!db.employees.length||!db.epis.length){alert("Cadastre pelo menos um colaborador e um EPI antes da movimentação.");return}
  populateSelects();$("mDate").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);$("movementModal").classList.add("open")
}
window.openMovementModal=openMovementModal;
window.openEmployeeModal=()=>{populateSelects();if(!db.plants.length){alert("Cadastre uma usina primeiro.");return}$("employeeModal").classList.add("open")};
window.openEpiModal=()=>$("epiModal").classList.add("open");
window.openPlantModal=()=>$("plantModal").classList.add("open");
$("mType").onchange=()=>{const show=$("mType").value==="Devolução";$("returnReasonWrap").classList.toggle("hidden",!show);$("returnStateWrap").classList.toggle("hidden",!show)};

async function logAudit(action,record){
  await addDoc(collection(firestore,"auditLogs"),{action,record,userUid:auth.currentUser.uid,userEmail:auth.currentUser.email,userName:profile.name||auth.currentUser.email,createdAt:serverTimestamp()});
}
$("plantForm").onsubmit=async e=>{
  e.preventDefault();
  try{await addDoc(collection(firestore,"plants"),{name:$("uName").value.trim(),createdAt:serverTimestamp(),createdBy:auth.currentUser.uid});await logAudit("CADASTRO_USINA",$("uName").value.trim());e.target.reset();closeModal("plantModal");await loadAll()}
  catch(err){console.error(err);alert("Não foi possível cadastrar a usina.")}
};
$("employeeForm").onsubmit=async e=>{
  e.preventDefault();
  try{const data={name:$("eName").value.trim(),reg:$("eReg").value.trim(),role:$("eRole").value.trim(),plantId:$("ePlant").value,admission:$("eAdmission").value,status:"Ativo",createdAt:serverTimestamp(),createdBy:auth.currentUser.uid};await addDoc(collection(firestore,"employees"),data);await logAudit("CADASTRO_COLABORADOR",data.name);e.target.reset();closeModal("employeeModal");await loadAll()}
  catch(err){console.error(err);alert("Não foi possível cadastrar o colaborador.")}
};
$("epiForm").onsubmit=async e=>{
  e.preventDefault();
  try{const data={name:$("pName").value.trim(),ca:$("pCA").value.trim(),caExpiry:$("pCAExpiry").value,unit:$("pUnit").value,lifeDays:+$("pLife").value,sizes:$("pSizes").value.split(",").map(x=>x.trim()).filter(Boolean),createdAt:serverTimestamp(),createdBy:auth.currentUser.uid};await addDoc(collection(firestore,"epis"),data);await logAudit("CADASTRO_EPI",data.name);e.target.reset();closeModal("epiModal");await loadAll()}
  catch(err){console.error(err);alert("Não foi possível cadastrar o EPI.")}
};
$("movementForm").onsubmit=async e=>{
  e.preventDefault();
  const employee=emp($("mEmployee").value), type=$("mType").value, qty=+$("mQty").value, epiId=$("mEpi").value;
  if(!employee||!epi(epiId)){alert("Selecione colaborador e EPI.");return}
  const stockId=`${employee.plantId}_${epiId}`, stockRef=doc(firestore,"stock",stockId), moveRef=doc(collection(firestore,"movements"));
  try{
    await runTransaction(firestore,async tx=>{
      const stockSnap=await tx.get(stockRef);
      let current=stockSnap.exists()?(+stockSnap.data().qty||0):0;
      let min=stockSnap.exists()?(+stockSnap.data().min||0):0;
      if(type==="Entrega"&&current<qty) throw new Error("ESTOQUE_INSUFICIENTE");
      const next=type==="Entrega"?current-qty:current+qty;
      tx.set(stockRef,{plantId:employee.plantId,epiId,qty:next,min,updatedAt:serverTimestamp()},{merge:true});
      tx.set(moveRef,{date:new Date($("mDate").value),type,employeeId:employee.id,plantId:employee.plantId,epiId,qty,size:$("mSize").value.trim(),reason:type==="Devolução"?$("mReason").value:null,state:type==="Devolução"?$("mState").value:null,obs:$("mObs").value.trim(),signed:true,userUid:auth.currentUser.uid,userEmail:auth.currentUser.email,userName:profile.name||auth.currentUser.email,createdAt:serverTimestamp()});
    });
    await logAudit(type.toUpperCase(),`${epi(epiId).name} → ${employee.name}`);
    e.target.reset();closeModal("movementModal");await loadAll();alert("Movimentação registrada com sucesso.");
  }catch(err){console.error(err);alert(err.message==="ESTOQUE_INSUFICIENTE"?"Estoque insuficiente. Como o banco está novo, cadastre/ajuste o estoque antes da primeira entrega.":"Não foi possível registrar a movimentação.")}
};

function downloadCSV(type){
  let rows=[],name=`relatorio-${type}.csv`;
  if(type==="movimentacoes")rows=[["Data","Tipo","Colaborador","Usina","EPI","Quantidade","Tamanho"],...db.movements.map(m=>[fmtDate(m.date),m.type,emp(m.employeeId)?.name||"",plantName(m.plantId),epi(m.epiId)?.name||"",m.qty,m.size||""])];
  if(type==="colaboradores")rows=[["Colaborador","Matrícula","Função","Usina","Status"],...db.employees.map(e=>[e.name,e.reg,e.role,plantName(e.plantId),e.status])];
  if(type==="estoque")rows=[["Usina","EPI","Disponível","Mínimo"],...db.stock.map(s=>[plantName(s.plantId),epi(s.epiId)?.name||"",s.qty,s.min])];
  if(type==="ca")rows=[["EPI","C.A.","Validade","Dias restantes"],...db.epis.map(p=>[p.name,p.ca,p.caExpiry,daysUntil(p.caExpiry)])];
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href)
}
window.downloadCSV=downloadCSV;
