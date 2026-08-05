import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction, writeBatch } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseApp=initializeApp(firebaseConfig), auth=getAuth(firebaseApp), firestore=getFirestore(firebaseApp);
setPersistence(auth,browserLocalPersistence).catch(err=>console.error("Persistência de login:",err));
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

let dashboardPlantId="", employeeView="cards", epiView="cards", userView="cards", pendingUserPhotoDataUrl=null;
let auditLoaded=false,auditLoading=false;

const APP_VERSION="1.8";

let presenceTimer=null,lastPresenceWrite=0;
let employeeDeepLinkHandled=false;
function userPresenceState(u){
  const raw=fmtRaw(u?.lastSeenAt);
  if(!raw)return {key:"offline",label:"Sem registro",detail:"Nunca acessou"};
  const diff=Date.now()-new Date(raw).getTime();
  if(diff<120000)return {key:"online",label:"Online agora",detail:"Ativo neste momento"};
  if(diff<900000)return {key:"recent",label:"Ativo recentemente",detail:`Há ${Math.max(1,Math.round(diff/60000))} min`};
  return {key:"offline",label:"Offline",detail:fmtDate(raw)};
}
async function writePresence(force=false){
  if(!auth.currentUser||!profile)return;
  const now=Date.now(); if(!force&&now-lastPresenceWrite<60000)return; lastPresenceWrite=now;
  try{
    await updateDoc(doc(firestore,"users",auth.currentUser.uid),{lastSeenAt:serverTimestamp(),lastSeenDevice:navigator.userAgent.includes("Mobile")?"MOBILE":"NAVEGADOR"});
    const u=db.users.find(x=>x.id===auth.currentUser.uid); if(u){u.lastSeenAt=new Date();u.lastSeenDevice=navigator.userAgent.includes("Mobile")?"MOBILE":"NAVEGADOR";renderUsers()}
  }catch(err){console.debug("Presença:",err)}
}
function startPresence(){writePresence(true);if(presenceTimer)clearInterval(presenceTimer);presenceTimer=setInterval(()=>writePresence(false),60000)}
window.addEventListener("focus",()=>writePresence(false));
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")writePresence(false)});

let updateCheckTimer=null;
function normalizeVersion(v){return String(v||"").trim()}
async function checkSystemUpdate(manual=false){
  try{
    const res=await fetch(`./version.json?ts=${Date.now()}`,{cache:"no-store"});
    if(!res.ok)return;
    const remote=normalizeVersion((await res.json()).version);
    const btn=$("systemUpdateBtn");
    if(btn)btn.classList.toggle("hidden",!remote||remote===APP_VERSION);if(manual)showToast(remote&&remote!==APP_VERSION?`Nova versão ${remote} disponível.`:"Seu sistema já está atualizado.");if($("settingsLastCheck"))$("settingsLastCheck").textContent=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  }catch(err){console.debug("Verificação de atualização indisponível.",err)}
}
async function forceSystemUpdate(){
  const btn=$("systemUpdateBtn");
  if(btn){btn.disabled=true;btn.classList.add("updating");btn.querySelector("small").textContent="Atualizando..."}
  try{
    if("serviceWorker" in navigator){
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
    }
    if("caches" in window){
      const keys=await caches.keys();
      await Promise.all(keys.map(k=>caches.delete(k)));
    }
  }catch(err){console.warn("Limpeza de cache:",err)}
  const url=new URL(location.href);
  url.searchParams.set("update",Date.now());
  location.replace(url.toString());
}
window.forceSystemUpdate=forceSystemUpdate;window.checkSystemUpdate=checkSystemUpdate;
if($("systemVersionLabel"))$("systemVersionLabel").textContent=`v${APP_VERSION}`;

function epiMin(p){return Math.max(0,Number(p?.minStock??0)||0)}
function epiStockState(p){
  const qty=stockQty(p), min=epiMin(p);
  if(qty===0)return {key:"zero",label:"Sem estoque"};
  if(min>0 && qty<=min)return {key:"low",label:"Estoque baixo"};
  return {key:"ok",label:"Estoque normal"};
}
function showToast(message,type="success"){
  const box=document.createElement("div");
  box.className=`toast ${type}`;
  box.innerHTML=`<span>${type==="success"?"✓":"!"}</span><div>${esc(message)}</div>`;
  $("toastContainer").appendChild(box);
  requestAnimationFrame(()=>box.classList.add("show"));
  setTimeout(()=>{box.classList.remove("show");setTimeout(()=>box.remove(),220)},2600);
}
window.showToast=showToast;
function userAlert(message){showToast(message,"error")}
window.userAlert=userAlert;



function showLoginError(msg){$("loginError").textContent=msg;$("loginError").classList.add("show")}
function clearLoginError(){$("loginError").classList.remove("show")}
function loadCachedBrand(){try{const c=JSON.parse(localStorage.getItem("epiCompanyBrand")||"null");if(c?.logoDataUrl){$("sidebarBrandLogo").src=c.logoDataUrl}$("loginBrandLogo").src="./logo-symbol.png";if(c?.companyName)$("sidebarCompanyName").textContent=c.companyName}catch(_){$("loginBrandLogo").src="./logo-symbol.png"}}
function cacheBrand(){localStorage.setItem("epiCompanyBrand",JSON.stringify({companyName:db.settings.companyName||"",logoDataUrl:db.settings.logoDataUrl||""}))}
function applyBranding(){const src=db.settings.logoDataUrl||"./logo-symbol.png", name=db.settings.companyName||"Gestão de EPIs";$("sidebarBrandLogo").src=src;$("loginBrandLogo").src="./logo-symbol.png";$("companyLogoPreview").src=src;$("sidebarCompanyName").textContent=name;$("sidebarSystemName").textContent=name==="Gestão de EPIs"?"Controle e Gestão":"Gestão de EPIs";cacheBrand()}
loadCachedBrand();


async function registerAppServiceWorker(){
  if(!("serviceWorker" in navigator))return;
  try{
    const reg=await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{updateViaCache:"none"});
    reg.addEventListener("updatefound",()=>{
      const worker=reg.installing;
      if(!worker)return;
      worker.addEventListener("statechange",()=>{
        if(worker.state==="installed"&&navigator.serviceWorker.controller){
          const btn=$("systemUpdateBtn");if(btn)btn.classList.remove("hidden");
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange",()=>{});
    await reg.update().catch(()=>{});
  }catch(err){console.warn("Service Worker:",err)}
}
registerAppServiceWorker();
checkSystemUpdate();
updateCheckTimer=setInterval(checkSystemUpdate,10*60*1000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkSystemUpdate()});

$("loginForm").addEventListener("submit",async e=>{e.preventDefault();clearLoginError();try{await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}catch(err){console.error(err);showLoginError("Não foi possível entrar. Confira o e-mail e a senha.")}});
$("logoutBtn").addEventListener("click",()=>signOut(auth));

onAuthStateChanged(auth,async user=>{
  if(!user){profile=null;$("loginScreen").classList.remove("hidden");return}
  try{
    const snap=await getDoc(doc(firestore,"users",user.uid));
    if(!snap.exists())throw new Error("Sem perfil");
    profile={uid:user.uid,email:user.email,...snap.data()};
    if(profile.status!=="ATIVO")throw new Error("Inativo");
  }catch(err){
    console.error(err);await signOut(auth);showLoginError("Sua conta existe, mas não está autorizada corretamente no sistema.");return;
  }
  updateProfileUI();applyPermissions();startPresence();
  try{await loadAll();$("loginScreen").classList.add("hidden");handleEmployeeDeepLink()}
  catch(err){console.error("Falha ao carregar dados:",err);$("loginScreen").classList.add("hidden");showToast("Você continua conectado. Alguns dados não puderam ser atualizados agora.","error")}
});
function updateProfileUI(){
  if(!profile)return;
  const displayName=profile.name||auth.currentUser?.email||"Usuário";
  $("userName").textContent=displayName;$("userRole").textContent=humanRole(profile.role);$("userPlant").textContent=profile.plantId==="TODAS"?"Todas as usinas":plantName(profile.plantId);
  if($("topUserName"))$("topUserName").textContent=displayName;if($("topUserRole"))$("topUserRole").textContent=humanRole(profile.role);
  const initials=displayName.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  if($("topUserAvatar")){if(profile.photoUrl)$("topUserAvatar").innerHTML=`<img src="${profile.photoUrl}" alt="">`;else $("topUserAvatar").textContent=initials||"U"}
}
function applyPermissions(){document.querySelector('[data-view="usuarios"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="auditoria"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="configuracoes"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="movimentacoes"]').style.display=isSSMA()?"":"none";document.querySelector('[data-view="colaboradores"]').style.display=canView()?"":"none";document.querySelector('[data-view="epis"]').style.display=canView()?"":"none";document.querySelectorAll(".action-ssma").forEach(b=>b.style.display=isSSMA()?"":"none");if($("bottomMovBtn"))$("bottomMovBtn").style.display=isSSMA()?"":"none"}

async function readCollection(name){const snap=await getDocs(collection(firestore,name));return snap.docs.map(d=>({id:d.id,...d.data()}))}
async function readSettings(){const snap=await getDoc(doc(firestore,"settings","company"));return snap.exists()?snap.data():{}}
async function loadAll(){
  const tasks=[readCollection("plants"),readCollection("employees"),readCollection("epis"),readCollection("movements"),readSettings()];
  if(isAdmin())tasks.push(readCollection("users"));
  const res=await Promise.all(tasks);
  db.plants=res[0];db.employees=res[1];db.epis=res[2];db.movements=res[3];db.settings=res[4]||{};db.users=isAdmin()?res[5]:[];
  pendingLogoDataUrl=db.settings.logoDataUrl||null;applyBranding();updateProfileUI();refresh();
}
async function ensureAuditLoaded(force=false){
  if(!isAdmin()||auditLoading||(!force&&auditLoaded))return;
  auditLoading=true;
  try{db.audit=await readCollection("auditLogs");auditLoaded=true;renderAudit()}
  catch(err){console.error("Auditoria:",err);showToast("Não foi possível atualizar a auditoria.","error")}
  finally{auditLoading=false}
}
async function reloadOperationalData(){
  const [epis,movements]=await Promise.all([readCollection("epis"),readCollection("movements")]);
  db.epis=epis;db.movements=movements;refresh();
}

function navTo(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $(view).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const t={dashboard:["Painel geral","Indicadores do controle de EPIs."],movimentacoes:["Entregas e Devoluções","Registre e acompanhe movimentações."],colaboradores:["Colaboradores","Cadastro e histórico dos colaboradores."],epis:["Catálogo de EPIs","Controle de EPIs separado por usina."],relatorios:["Relatórios","Gere relatórios conforme os filtros selecionados."],usuarios:["Usuários e perfis","Gerencie nomes e acessos do sistema."],auditoria:["Auditoria","Rastreabilidade das ações realizadas."],configuracoes:["Configurações","Empresa, logo e cadastro das usinas."]};
  $("pageTitle").textContent=t[view][0];$("pageSubtitle").textContent=t[view][1];
  if($("dashboardPlantWrap"))$("dashboardPlantWrap").style.display=view==="dashboard"?"":"none";
  document.querySelectorAll("[data-mobile-view]").forEach(b=>b.classList.toggle("active",b.dataset.mobileView===view));
  if(view==="auditoria")ensureAuditLoaded();
}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{navTo(b.dataset.view);closeMobileMenu()});
function openMobileMenu(){document.querySelector(".sidebar").classList.add("mobile-open");$("mobileMenuOverlay").classList.add("show");document.body.classList.add("menu-open")}
function closeMobileMenu(){document.querySelector(".sidebar").classList.remove("mobile-open");$("mobileMenuOverlay").classList.remove("show");document.body.classList.remove("menu-open")}
$("mobileMenuBtn").addEventListener("click",()=>document.querySelector(".sidebar").classList.contains("mobile-open")?closeMobileMenu():openMobileMenu());
$("mobileMenuOverlay").addEventListener("click",closeMobileMenu);
window.closeMobileMenu=closeMobileMenu;

function renderDashboard(){
  const plant=dashboardPlantId,scopedMoves=db.movements.filter(x=>!plant||x.plantId===plant),scopedEpis=db.epis.filter(p=>!plant||p.plantId===plant);
  const now=new Date(),m=now.getMonth(),y=now.getFullYear(),month=scopedMoves.filter(x=>{const d=new Date(fmtRaw(x.date));return d.getMonth()===m&&d.getFullYear()===y});
  const ent=month.filter(x=>x.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),dev=month.filter(x=>x.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0),stock=scopedEpis.reduce((a,p)=>a+stockQty(p),0),pend=scopedMoves.filter(x=>(x.signatureStatus||"PENDENTE")!=="ASSINADO").length,low=scopedEpis.filter(p=>["zero","low"].includes(epiStockState(p).key)).length;
  const iconSvg={delivery:'<svg viewBox="0 0 24 24"><path d="M5 12h12"></path><path d="M13 8l4 4-4 4"></path><path d="M5 6v12"></path></svg>',return:'<svg viewBox="0 0 24 24"><path d="M19 12H7"></path><path d="M11 8l-4 4 4 4"></path><path d="M19 6v12"></path></svg>',stock:'<svg viewBox="0 0 24 24"><path d="M4 7l8-4 8 4-8 4z"></path><path d="M4 7v10l8 4 8-4V7"></path><path d="M12 11v10"></path></svg>',signature:'<svg viewBox="0 0 24 24"><path d="M5 19h14"></path><path d="M7 15l7-7 3 3-7 7H7z"></path><path d="M15 7l1.5-1.5 3 3L18 10"></path></svg>'};
  const kpis=[["delivery","Entregues no mês",ent,"Quantidade entregue","green",false],["return","Devoluções no mês",dev,"Quantidade devolvida","blue",false],["stock","Itens em estoque",stock,`${low} item(ns) em atenção`,"amber",false],["signature","Assinaturas pendentes",pend,"Abrir pendências","red",true]];
  $("kpis").innerHTML=kpis.map(x=>x[5]?`<button class="kpi kpi-clickable kpi-${x[4]}" onclick="openPendingSignatures()"><div class="kpi-top"><span class="kpi-icon">${iconSvg[x[0]]}</span><span>${x[1]}</span></div><strong>${x[2]}</strong><small>${x[3]}</small></button>`:`<div class="kpi kpi-${x[4]}"><div class="kpi-top"><span class="kpi-icon">${iconSvg[x[0]]}</span><span>${x[1]}</span></div><strong>${x[2]}</strong><small>${x[3]}</small></div>`).join("");
  if($("quickActions"))$("quickActions").innerHTML=isSSMA()?`<span class="quick-actions-title">Ações rápidas</span><button onclick="openMovementModalPreset('Entrega')"><b>＋</b> Registrar entrega</button><button onclick="openMovementModalPreset('Devolução')"><b>↩</b> Registrar devolução</button><button onclick="openEmployeeModal()"><b>●</b> Novo colaborador</button><button onclick="openEpiModal()"><b>⌖</b> Novo EPI</button>`:"";
  renderMovementChart(scopedMoves);
  $("recentMoves").innerHTML=[...scopedMoves].sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).slice(0,6).map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(emp(x.employeeId)?.name||"-")}</td><td>${esc(epi(x.epiId)?.name||"-")}</td><td><span class="status ${x.type==="Entrega"?"info":"ok"}">${esc(x.type)}</span></td><td><span class="status ${sigClass(x.signatureStatus)}">${sigLabel(x.signatureStatus)}</span></td></tr>`).join("")||'<tr><td colspan="5" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
  renderStockByPlant();renderTopEpis(scopedMoves);renderDashboardAttention();renderNotifications();renderMenuBadges();
}
function renderStockByPlant(){
  const rows=db.plants.map(p=>({id:p.id,name:p.name,total:db.epis.filter(e=>e.plantId===p.id).reduce((a,e)=>a+stockQty(e),0)})).sort((a,b)=>b.total-a.total),max=Math.max(1,...rows.map(x=>x.total));
  $("stockByPlant").innerHTML=rows.map(x=>`<button class="insight-row" onclick="dashboardPlantId='${x.id}';$('dashboardPlantFilter').value='${x.id}';renderDashboard()"><div><strong>${esc(x.name)}</strong><small>${x.total} unidade(s)</small></div><div class="mini-progress"><span style="width:${Math.round((x.total/max)*100)}%"></span></div></button>`).join("")||'<div class="empty-state">Nenhuma usina cadastrada.</div>';
}
function renderTopEpis(scopedMoves){
  const cutoff=Date.now()-30*24*60*60*1000,counts=new Map();scopedMoves.filter(m=>m.type==="Entrega"&&new Date(fmtRaw(m.date)).getTime()>=cutoff).forEach(m=>counts.set(m.epiId,(counts.get(m.epiId)||0)+Number(m.qty||0)));
  const rows=[...counts.entries()].map(([id,total])=>({id,total,name:epi(id)?.name||"EPI",plantId:epi(id)?.plantId})).sort((a,b)=>b.total-a.total).slice(0,5);
  $("topEpis").innerHTML=rows.map((x,i)=>`<button class="ranking-row" onclick="goToEpi('${x.plantId||""}')"><span class="rank-number">${i+1}</span><div><strong>${esc(x.name)}</strong><small>${esc(plantName(x.plantId))}</small></div><b>${x.total}</b></button>`).join("")||'<div class="empty-state">Sem entregas nos últimos 30 dias.</div>';
}
function renderDashboardAttention(){
  const zero=db.epis.filter(p=>stockQty(p)===0).length,low=db.epis.filter(p=>epiStockState(p).key==="low").length,pend=db.movements.filter(m=>(m.signatureStatus||"PENDENTE")!=="ASSINADO").length,items=[];
  if(zero)items.push(`<button class="attention-item critical" onclick="goToEpi('')"><span>!</span><div><strong>${zero} EPI(s) sem estoque</strong><small>Necessário reabastecimento</small></div></button>`);
  if(low)items.push(`<button class="attention-item warning" onclick="goToEpi('')"><span>!</span><div><strong>${low} EPI(s) em estoque mínimo</strong><small>Planejar reposição</small></div></button>`);
  if(pend)items.push(`<button class="attention-item info" onclick="openPendingSignatures()"><span>i</span><div><strong>${pend} assinatura(s) pendente(s)</strong><small>Aguardando ficha física</small></div></button>`);
  $("dashboardAttention").innerHTML=items.join("")||'<div class="empty-state">Nenhuma atenção no momento.</div>';
}

function renderMovementChart(moves){
  const chart=$("movementChart");if(!chart)return;const months=[],base=new Date();
  for(let i=5;i>=0;i--){const d=new Date(base.getFullYear(),base.getMonth()-i,1);months.push({year:d.getFullYear(),month:d.getMonth(),label:d.toLocaleDateString("pt-BR",{month:"short"}).replace(".","")})}
  const data=months.map(mm=>{const rows=moves.filter(x=>{const d=new Date(fmtRaw(x.date));return d.getFullYear()===mm.year&&d.getMonth()===mm.month});return {...mm,delivery:rows.filter(x=>x.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),returns:rows.filter(x=>x.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0)}}),max=Math.max(1,...data.flatMap(x=>[x.delivery,x.returns]));
  chart.innerHTML=data.map(x=>`<div class="chart-month"><div class="chart-bars"><div class="chart-bar chart-delivery" style="height:${Math.max(x.delivery?8:2,Math.round((x.delivery/max)*110))}px"><span>${x.delivery||""}</span></div><div class="chart-bar chart-return" style="height:${Math.max(x.returns?8:2,Math.round((x.returns/max)*110))}px"><span>${x.returns||""}</span></div></div><small>${x.label}</small></div>`).join("");
}
function openMovementModalPreset(type){openMovementModal();$("mType").value=type;$("mType").dispatchEvent(new Event("change"))}
window.openMovementModalPreset=openMovementModalPreset;
function goToEpi(plantId=""){navTo("epis");$("epiPlantFilter").value=plantId;renderEpis()}
window.goToEpi=goToEpi;
function renderMenuBadges(){
  const pend=db.movements.filter(x=>(x.signatureStatus||"PENDENTE")!=="ASSINADO").length;
  const low=db.epis.filter(p=>["zero","low"].includes(epiStockState(p).key)).length;
  const mb=$("movementPendingBadge"), eb=$("epiAlertBadge");
  if(mb){mb.textContent=pend;mb.classList.toggle("hidden",!pend)}
  if(eb){eb.textContent=low;eb.classList.toggle("hidden",!low)}
}
function openPendingSignatures(){
  const rows=[...db.movements].filter(x=>(x.signatureStatus||"PENDENTE")!=="ASSINADO").sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)));
  $("pendingSignaturesTable").innerHTML=rows.map(x=>`<tr><td>${fmtDate(x.date)}</td><td>${esc(emp(x.employeeId)?.name||"-")}</td><td>${esc(plantName(x.plantId))}</td><td>${esc(epi(x.epiId)?.name||"-")}</td><td>${esc(x.type)}</td><td><button class="table-action" onclick="closeModal('pendingSignaturesModal');openSignatureModal('${x.id}','${x.signatureStatus||"PENDENTE"}')">Atualizar assinatura</button></td></tr>`).join("")||'<tr><td colspan="6" class="empty-state">Nenhuma assinatura pendente.</td></tr>';
  $("pendingSignaturesModal").classList.add("open");
}
window.openPendingSignatures=openPendingSignatures;

function returnText(x){if(x.type!=="Devolução")return"-";return x.returnDisposition==="DESCARTE"?"Descarte":"Reestoque"}
function renderMovements(){
  const q=($("movSearch")?.value||"").toLowerCase(),type=$("movType")?.value||"",sig=$("movSignature")?.value||"";
  const rows=[...db.movements].sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).filter(x=>(!type||x.type===type)&&(!sig||(x.signatureStatus||"PENDENTE")===sig)&&(((emp(x.employeeId)?.name||"").toLowerCase().includes(q))||((epi(x.epiId)?.name||"").toLowerCase().includes(q))));
  $("movementsTable").innerHTML=rows.map(x=>`<tr><td>${fmtDate(x.date)}</td><td><span class="status ${x.type==="Entrega"?"info":"ok"}">${esc(x.type)}</span></td><td>${esc(emp(x.employeeId)?.name||"-")}</td><td>${esc(plantName(x.plantId))}</td><td>${esc(epi(x.epiId)?.name||"-")}</td><td>${x.qty||0}</td><td>${esc(x.size||"-")}</td><td>${esc(returnText(x))}</td><td><span class="status ${sigClass(x.signatureStatus)}">${sigLabel(x.signatureStatus)}</span></td><td class="obs-cell">${esc(x.obs||"-")}</td><td class="action-cell">${isSSMA()?`<button class="table-action" onclick="openMovementEdit('${x.id}')">Editar</button><button class="table-action" onclick="openSignatureModal('${x.id}','${x.signatureStatus||"PENDENTE"}')">Assinatura</button>`:""}${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeMovement('${x.id}')">Remover</button>`:""}</td></tr>`).join("")||'<tr><td colspan="11" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
}

function setEmployeeView(mode){employeeView=mode;$("employeeCardsBtn").classList.toggle("active",mode==="cards");$("employeeListBtn").classList.toggle("active",mode==="list");$("employeeCards").classList.toggle("hidden",mode!=="cards");$("employeeListWrap").classList.toggle("hidden",mode!=="list")}
window.setEmployeeView=setEmployeeView;
function renderEmployees(){
  const q=($("empSearch")?.value||"").toLowerCase(),list=db.employees.filter(e=>(e.name||"").toLowerCase().includes(q)||(e.reg||"").toLowerCase().includes(q));
  $("employeeCards").innerHTML=list.map(e=>{const moves=db.movements.filter(m=>m.employeeId===e.id),delivered=moves.filter(m=>m.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),pending=moves.filter(m=>(m.signatureStatus||"PENDENTE")!=="ASSINADO").length,initials=(e.name||"?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();return `<article class="entity-card employee-card" onclick="openEmployeeHistory('${e.id}')"><div class="entity-card-head"><div class="employee-avatar">${esc(initials)}</div><div><h4>${esc(e.name)}</h4><p>${esc(e.role||"-")} • ${esc(plantName(e.plantId))}</p></div></div><div class="entity-card-meta"><span>Matrícula <strong>${esc(e.reg||"-")}</strong></span><span>EPIs entregues <strong>${delivered}</strong></span></div><div class="entity-card-footer"><span class="clean-status ${pending?"has-pending":"clear"}"><i>${pending?"!":"✓"}</i>${pending?`${pending} pendência(s)`:"Situação regular"}</span><div class="card-actions" onclick="event.stopPropagation()">${isSSMA()?`<button class="table-action" onclick="openEmployeeEdit('${e.id}')">Editar</button>`:""}<button class="table-action" onclick="openEmployeeHistory('${e.id}')">Ficha</button>${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEmployee('${e.id}')">Remover</button>`:""}</div></div></article>`}).join("")||'<div class="empty-state">Nenhum colaborador cadastrado.</div>';
  $("employeesTable").innerHTML=list.map(e=>{const last=[...db.movements].filter(m=>m.employeeId===e.id&&m.type==="Entrega").sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)))[0];return `<tr><td><button class="employee-name-link" onclick="openEmployeeHistory('${e.id}')">${esc(e.name)}</button></td><td>${esc(e.reg||"-")}</td><td>${esc(e.role||"-")}</td><td>${esc(plantName(e.plantId))}</td><td><span class="status ok">${esc(e.status||"Ativo")}</span></td><td>${last?fmtDate(last.date):"Sem registro"}</td><td class="action-cell">${isSSMA()?`<button class="table-action" onclick="openEmployeeEdit('${e.id}')">Editar</button>`:""}<button class="table-action" onclick="openEmployeeHistory('${e.id}')">Histórico</button>${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEmployee('${e.id}')">Remover</button>`:""}</td></tr>`}).join("")||'<tr><td colspan="7" class="empty-state">Nenhum colaborador cadastrado.</td></tr>';
  setEmployeeView(employeeView);
}
function openEmployeeHistory(id){
  const e=emp(id);if(!e)return;
  const moves=[...db.movements].filter(m=>m.employeeId===id).sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))),delivered=moves.filter(m=>m.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),returned=moves.filter(m=>m.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0),pending=moves.filter(m=>(m.signatureStatus||"PENDENTE")!=="ASSINADO").length;
  $("employeeHistoryTitle").textContent=e.name;$("employeeHistoryMeta").textContent=`${e.role||"Função não informada"} • ${plantName(e.plantId)} • Matrícula ${e.reg||"-"}`;
  const initials=(e.name||"EP").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();$("employeeHistoryAvatar").textContent=initials;$("employeeHistoryNameHero").textContent=e.name;$("employeeHistoryRoleHero").textContent=`${e.role||"Função não informada"} • ${plantName(e.plantId)}`;
  const deepLink=`${location.origin}${location.pathname}?employee=${encodeURIComponent(e.id)}`;$("employeeQrImage").src=`https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(deepLink)}`;
  $("employeeHistorySummary").innerHTML=`<div class="history-stat"><span>Entregue</span><strong>${delivered}</strong></div><div class="history-stat"><span>Devolvido</span><strong>${returned}</strong></div><div class="history-stat"><span>Registros</span><strong>${moves.length}</strong></div><div class="history-stat ${pending?"history-stat-alert":""}"><span>Assinaturas pendentes</span><strong>${pending}</strong></div>`;
  $("employeeQuickDelivery").onclick=()=>openMovementForEmployee(id,"Entrega");$("employeeQuickReturn").onclick=()=>openMovementForEmployee(id,"Devolução");$("employeePrintSheet").onclick=()=>printEmployeeSheet(id);
  $("employeeHistoryTable").innerHTML=moves.map(m=>`<tr><td>${fmtDate(m.date)}</td><td><span class="status ${m.type==="Entrega"?"info":"ok"}">${esc(m.type)}</span></td><td>${esc(epi(m.epiId)?.name||"-")}</td><td>${m.qty||0}</td><td>${esc(m.size||"-")}</td><td>${esc(returnText(m))}</td><td><span class="status ${sigClass(m.signatureStatus)}">${sigLabel(m.signatureStatus)}</span></td><td>${esc(m.obs||"-")}</td></tr>`).join("")||'<tr><td colspan="8" class="empty-state">Nenhuma entrega ou devolução registrada.</td></tr>';
  $("employeeHistoryModal").classList.add("open");
}
window.openEmployeeHistory=openEmployeeHistory;
function openMovementForEmployee(id,type){closeModal("employeeHistoryModal");openMovementModal();selectMovementEmployee(id);$("mType").value=type;$("mType").dispatchEvent(new Event("change"))}
window.openMovementForEmployee=openMovementForEmployee;
function printEmployeeSheet(id){
  const e=emp(id);if(!e)return;const moves=[...db.movements].filter(m=>m.employeeId===id).sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))),popup=window.open("","_blank");if(!popup){userAlert("O navegador bloqueou a abertura da ficha para impressão.");return}
  const qr=`https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=6&data=${encodeURIComponent(`${location.origin}${location.pathname}?employee=${id}`)}`;
  const rows=moves.map(m=>`<tr><td>${esc(fmtDate(m.date))}</td><td>${esc(m.type)}</td><td>${esc(epi(m.epiId)?.name||"-")}</td><td>${m.qty||0}</td><td>${esc(m.size||"-")}</td><td>${esc(sigLabel(m.signatureStatus))}</td><td>${esc(m.obs||"-")}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ficha de EPI - ${esc(e.name)}</title><style>body{font-family:Arial;color:#111;padding:28px}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #1f5135;padding-bottom:14px}.brand{display:flex;gap:14px;align-items:center}.brand img.logo{max-width:85px;max-height:60px}.qr{width:110px;height:110px}.meta{margin:18px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.meta div{border:1px solid #ddd;padding:9px;border-radius:6px}.meta span{font-size:9px;color:#666;display:block}.meta strong{font-size:12px}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eef5f0}.sign{margin-top:55px;display:grid;grid-template-columns:1fr 1fr;gap:70px}.line{border-top:1px solid #222;text-align:center;padding-top:5px;font-size:10px}.foot{margin-top:18px;font-size:9px;color:#777}</style></head><body><div class="head"><div class="brand">${db.settings.logoDataUrl?`<img class="logo" src="${db.settings.logoDataUrl}">`:""}<div><h2>${esc(db.settings.companyName||"Empresa")}</h2><div>Ficha individual de entrega e devolução de EPIs</div></div></div><img class="qr" src="${qr}"></div><div class="meta"><div><span>COLABORADOR</span><strong>${esc(e.name)}</strong></div><div><span>FUNÇÃO</span><strong>${esc(e.role||"-")}</strong></div><div><span>USINA</span><strong>${esc(plantName(e.plantId))}</strong></div><div><span>MATRÍCULA</span><strong>${esc(e.reg||"-")}</strong></div><div><span>ADMISSÃO</span><strong>${esc(e.admission||"-")}</strong></div><div><span>STATUS</span><strong>${esc(e.status||"Ativo")}</strong></div></div><table><thead><tr><th>Data</th><th>Tipo</th><th>EPI</th><th>Qtd.</th><th>Tamanho</th><th>Assinatura</th><th>Observações</th></tr></thead><tbody>${rows}</tbody></table><div class="sign"><div class="line">Colaborador</div><div class="line">Responsável pela entrega</div></div><div class="foot">Emitido em ${new Date().toLocaleString("pt-BR")}</div><script>window.onload=()=>setTimeout(()=>window.print(),450)<\/script></body></html>`);popup.document.close();
}
window.printEmployeeSheet=printEmployeeSheet;


function setEpiView(mode){epiView=mode;$("epiCardsBtn").classList.toggle("active",mode==="cards");$("epiListBtn").classList.toggle("active",mode==="list");$("epiCards").classList.toggle("hidden",mode!=="cards");$("epiListWrap").classList.toggle("hidden",mode!=="list")}
window.setEpiView=setEpiView;
function renderEpis(){
  const plantFilter=$("epiPlantFilter")?.value||"",list=[...db.epis].filter(p=>!plantFilter||p.plantId===plantFilter).sort((a,b)=>(plantName(a.plantId)+a.name).localeCompare(plantName(b.plantId)+b.name));
  $("epiCards").innerHTML=list.map(p=>{const state=epiStockState(p),qty=stockQty(p),min=epiMin(p),target=Math.max(min*2,qty,1),pct=Math.max(0,Math.min(100,Math.round((qty/target)*100)));return `<article class="entity-card epi-card"><div class="epi-card-top"><div><span class="eyebrow">${esc(plantName(p.plantId))}</span><h4>${esc(p.name||"-")}</h4><p>C.A. ${esc(p.ca||"-")} • ${esc(p.unit||"-")}</p></div><span class="stock-state-chip stock-${state.key}"><i></i>${state.label}</span></div><div class="epi-stock-row"><strong>${qty}</strong><span>em estoque</span><small>Mínimo ${min}</small></div><div class="stock-progress stock-progress-${state.key}"><span style="width:${pct}%"></span></div><div class="epi-sizes">Tamanhos <strong>${esc((p.sizes||[]).join(", ")||"Único")}</strong></div><div class="entity-card-footer"><span></span><div class="card-actions">${isSSMA()?`<button class="table-action" onclick="openEpiModal('${p.id}')">Editar / Reabastecer</button>`:""}${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEpi('${p.id}')">Remover</button>`:""}</div></div></article>`}).join("")||'<div class="empty-state">Nenhum EPI cadastrado para este filtro.</div>';
  $("episTable").innerHTML=list.map(p=>{const s=epiStockState(p);return `<tr><td>${esc(plantName(p.plantId))}</td><td>${esc(p.name||"-")}</td><td>${esc(p.ca||"-")}</td><td>${esc(p.unit||"-")}</td><td>${esc((p.sizes||[]).join(", ")||"Único")}</td><td>${stockQty(p)}</td><td>${epiMin(p)}</td><td><span class="stock-state-chip stock-${s.key}"><i></i>${s.label}</span></td><td class="action-cell">${isSSMA()?`<button class="table-action" onclick="openEpiModal('${p.id}')">Editar</button>`:""}${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEpi('${p.id}')">Remover</button>`:""}</td></tr>`}).join("")||'<tr><td colspan="9" class="empty-state">Nenhum EPI cadastrado.</td></tr>';
  setEpiView(epiView);
}
function renderPlants(){$("plantsGrid").innerHTML=db.plants.map(p=>`<div class="plant-card"><strong>${esc(p.name)}</strong>${canDeleteOperational()?`<button class="mini-remove" onclick="removePlant('${p.id}')">Remover</button>`:""}</div>`).join("")||'<div class="empty-state">Nenhuma usina cadastrada.</div>'}
function roleClass(v){return ({PROPRIETARIO:"role-owner",ADMINISTRADOR:"role-admin",SSMA:"role-ssma",VISUALIZADOR:"role-viewer"}[v]||"role-default")}
function userAvatarHtml(u,cls="user-avatar"){const initials=(u.name||u.email||"?").split(/[\s@]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();return u.photoUrl?`<div class="${cls}"><img src="${u.photoUrl}" alt=""></div>`:`<div class="${cls} avatar-initials">${esc(initials)}</div>`}
function setUserView(mode){userView=mode;$("userCardsBtn").classList.toggle("active",mode==="cards");$("userListBtn").classList.toggle("active",mode==="list");$("userCards").classList.toggle("hidden",mode!=="cards");$("userListWrap").classList.toggle("hidden",mode!=="list")}
window.setUserView=setUserView;
function renderUsers(){
  if(!$("usersTable")||!$("userCards"))return;
  $("userCards").innerHTML=db.users.map(u=>{const presence=userPresenceState(u);return `<article class="entity-card user-card"><div class="user-card-head">${userAvatarHtml(u)}<div><h4>${esc(u.name||u.email||"-")}</h4><p>${esc(u.email||"-")}</p></div></div><div class="user-role-line"><span class="role-chip ${roleClass(u.role)}">${humanRole(u.role)}</span><span>${esc(u.plantId==="TODAS"?"Todas as usinas":plantName(u.plantId))}</span></div><div class="user-presence-line"><span class="presence-dot ${presence.key}"></span><div><strong>${presence.label}</strong><small>${presence.detail}</small></div></div><div class="entity-card-footer"><span></span><div class="card-actions"><button class="table-action" onclick="openUserEdit('${u.id}')">Editar</button>${isOwner()&&u.id!==auth.currentUser.uid?`<button class="table-action danger-btn" onclick="removeUser('${u.id}')">Remover</button>`:""}</div></div></article>`}).join("")||'<div class="empty-state">Nenhum usuário encontrado.</div>';
  $("usersTable").innerHTML=db.users.map(u=>{const presence=userPresenceState(u),last=fmtRaw(u.lastSeenAt);return `<tr><td>${userAvatarHtml(u,"user-avatar small")}</td><td>${esc(u.name||"-")}</td><td>${esc(u.email||"-")}</td><td><span class="role-chip ${roleClass(u.role)}">${humanRole(u.role)}</span></td><td>${esc(u.plantId==="TODAS"?"Todas as usinas":plantName(u.plantId))}</td><td><span class="presence-inline"><i class="${presence.key}"></i>${presence.label}</span></td><td>${last?fmtDate(last):"Sem registro"}</td><td><button class="table-action" onclick="openUserEdit('${u.id}')">Editar</button>${isOwner()&&u.id!==auth.currentUser.uid?`<button class="table-action danger-btn" onclick="removeUser('${u.id}')">Remover</button>`:""}</td></tr>`}).join("");
  setUserView(userView);
}

function renderAudit(){
  if(!$("auditTable"))return;
  const rows=[...db.audit].sort((a,b)=>new Date(fmtRaw(b.createdAt))-new Date(fmtRaw(a.createdAt)));
  $("auditBulkActions").classList.toggle("hidden",!isOwner());
  $("auditTotalLabel").textContent=`${rows.length} registro(s)`;
  $("auditTable").innerHTML=rows.map(a=>`<tr>
    <td class="check-col">${isOwner()?`<input class="audit-row-check" type="checkbox" value="${a.id}" onchange="updateAuditSelection()">`:""}</td>
    <td>${fmtDate(a.createdAt)}</td><td>${esc(a.userName||a.userEmail||"-")}</td><td><span class="status info">${esc(a.action||"-")}</span></td><td>${esc(a.record||"-")}</td>
    <td>${isOwner()?`<button class="table-action danger-btn" onclick="removeAudit('${a.id}')">Remover</button>`:"-"}</td>
  </tr>`).join("")||'<tr><td colspan="6" class="empty-state">Nenhum registro de auditoria.</td></tr>';
  if($("auditSelectAll"))$("auditSelectAll").checked=false;
  updateAuditSelection();
}
function getSelectedAuditIds(){return [...document.querySelectorAll(".audit-row-check:checked")].map(x=>x.value)}
function updateAuditSelection(){
  const ids=getSelectedAuditIds(),count=$("auditSelectedCount"),btn=$("auditRemoveSelectedBtn");
  if(count)count.textContent=ids.length;if(btn)btn.disabled=!ids.length;
  const all=[...document.querySelectorAll(".audit-row-check")],master=$("auditSelectAll");
  if(master){master.indeterminate=ids.length>0&&ids.length<all.length;master.checked=all.length>0&&ids.length===all.length}
}
window.updateAuditSelection=updateAuditSelection;
function toggleAllAudits(checked){document.querySelectorAll(".audit-row-check").forEach(x=>x.checked=checked);updateAuditSelection()}
window.toggleAllAudits=toggleAllAudits;
async function deleteAuditIds(ids){
  for(let i=0;i<ids.length;i+=400){
    const batch=writeBatch(firestore);
    ids.slice(i,i+400).forEach(id=>batch.delete(doc(firestore,"auditLogs",id)));
    await batch.commit();
  }
  const set=new Set(ids);db.audit=db.audit.filter(x=>!set.has(x.id));renderAudit();
}
async function removeSelectedAudits(){
  if(!isOwner())return;const ids=getSelectedAuditIds();if(!ids.length)return;
  
  try{await deleteAuditIds(ids);showToast(`${ids.length} registro(s) removido(s).`)}catch(err){console.error(err);userAlert("Não foi possível remover os registros selecionados.")}
}
window.removeSelectedAudits=removeSelectedAudits;
async function removeAllAudits(){
  if(!isOwner()||!db.audit.length)return;
  
  try{const ids=db.audit.map(x=>x.id);await deleteAuditIds(ids);showToast("Log de auditoria limpo.")}catch(err){console.error(err);userAlert("Não foi possível limpar o log de auditoria.")}
}
window.removeAllAudits=removeAllAudits;
function renderSettings(){$("companyName").value=db.settings.companyName||"";$("companyLogoPreview").src=db.settings.logoDataUrl||"./logo-symbol.png";renderPlants()}
function refresh(){populateDashboardFilters();renderDashboard();renderMovements();renderEmployees();renderEpis();renderUsers();renderAudit();renderSettings();populateSelects();populateReportFilters();renderMenuBadges()
  if($("settingsVersion"))$("settingsVersion").textContent=`v${APP_VERSION}`;if($("settingsConnection"))$("settingsConnection").textContent=navigator.onLine?"Online":"Offline";if($("settingsLastCheck"))$("settingsLastCheck").textContent=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
}

function populateDashboardFilters(){
  const dashboard=$("dashboardPlantFilter"), epiFilter=$("epiPlantFilter"); if(!dashboard)return;
  const options='<option value="">Todas as usinas</option>'+db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const dcur=dashboardPlantId, ecur=epiFilter?.value||"";
  dashboard.innerHTML=options;
  if([...dashboard.options].some(o=>o.value===dcur))dashboard.value=dcur;else dashboardPlantId="";
  epiFilter.innerHTML=options;
  if([...epiFilter.options].some(o=>o.value===ecur))epiFilter.value=ecur;
}
if($("dashboardPlantFilter"))$("dashboardPlantFilter").addEventListener("change",()=>{dashboardPlantId=$("dashboardPlantFilter").value;renderDashboard()});
function populateSelects(){$("ePlant").innerHTML=db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");$("pPlant").innerHTML=db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("")}
function renderMovementEmployeeSuggestions(){const box=$("mEmployeeSuggestBox"),input=$("mEmployeeSearch");if(!box||!input)return;const q=input.value.trim().toLowerCase();$("mEmployeeId").value="";if(!q){box.classList.add("hidden");box.innerHTML="";$("mPlant").value="";updateMovementPlantAndEpis(null);return}const matches=db.employees.filter(e=>e.status==="Ativo"&&(e.name||"").toLowerCase().includes(q)).sort((a,b)=>{const ap=(a.name||"").toLowerCase().startsWith(q)?0:1,bp=(b.name||"").toLowerCase().startsWith(q)?0:1;return ap-bp||(a.name||"").localeCompare(b.name||"")}).slice(0,8);box.innerHTML=matches.map(e=>`<button type="button" class="autocomplete-option" data-employee-id="${e.id}"><strong>${esc(e.name)}</strong><small>${esc(e.role||"-")} • ${esc(plantName(e.plantId))}</small></button>`).join("")||'<div class="autocomplete-empty">Nenhum colaborador encontrado.</div>';box.classList.remove("hidden");box.querySelectorAll("[data-employee-id]").forEach(btn=>btn.addEventListener("click",()=>selectMovementEmployee(btn.dataset.employeeId)))}
function selectMovementEmployee(id){const e=emp(id);if(!e)return;$("mEmployeeSearch").value=e.name;$("mEmployeeId").value=e.id;$("mPlant").value=plantName(e.plantId);$("mEmployeeSuggestBox").classList.add("hidden");updateMovementPlantAndEpis(e)}
function resolveMovementEmployee(refreshEpis=true){let e=emp($("mEmployeeId").value);if(!e){const typed=$("mEmployeeSearch").value.trim().toLowerCase();e=db.employees.find(x=>x.status==="Ativo"&&(x.name||"").trim().toLowerCase()===typed);if(e)$("mEmployeeId").value=e.id}if(e){$("mPlant").value=plantName(e.plantId);if(refreshEpis)updateMovementPlantAndEpis(e)}return e}
function updateMovementPlantAndEpis(e){if(!$("mEpi"))return;const available=e?db.epis.filter(p=>p.plantId===e.plantId):[];$("mEpi").innerHTML=available.length?available.map(p=>`<option value="${p.id}">${esc(p.name)} — estoque ${stockQty(p)}</option>`).join(""):'<option value="">Selecione primeiro o colaborador</option>';updateMovementSizes()}
function updateMovementSizes(){const p=epi($("mEpi")?.value);if(!$("mSize"))return;const sizes=(p?.sizes||[]).filter(Boolean);$("mSize").innerHTML=(sizes.length?sizes:["Único"]).map(s=>`<option value="${escAttr(s)}">${esc(s)}</option>`).join("")}
$("mEmployeeSearch").addEventListener("input",renderMovementEmployeeSuggestions);$("mEmployeeSearch").addEventListener("focus",()=>{if($("mEmployeeSearch").value.trim())renderMovementEmployeeSuggestions()});document.addEventListener("click",e=>{if(!e.target.closest(".autocomplete-field")&&$("mEmployeeSuggestBox"))$("mEmployeeSuggestBox").classList.add("hidden")});$("mEpi").addEventListener("change",updateMovementSizes);$("mType").addEventListener("change",()=>$("returnDispositionWrap").classList.toggle("hidden",$("mType").value!=="Devolução"));
function closeModal(id){$(id).classList.remove("open")}window.closeModal=closeModal;
function resetMovementForm(){$("movementForm").reset();$("mMovementId").value="";$("mEmployeeSearch").value="";$("mEmployeeId").value="";$("mPlant").value="";$("mEmployeeSuggestBox").classList.add("hidden");$("mEpi").innerHTML='<option value="">Selecione primeiro o colaborador</option>';$("mSize").innerHTML='<option value="">-</option>';$("mDate").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);$("mQty").value=1;$("mSignature").value="ASSINADO";$("mType").value="Entrega";$("returnDispositionWrap").classList.add("hidden");$("mObs").value=""}
function openMovementModal(){if(!db.employees.length){userAlert("Cadastre um colaborador antes.");return}populateSelects();resetMovementForm();$("movementModalTitle").textContent="Registrar entrega / devolução";$("movementSaveButton").textContent="Salvar movimentação";$("movementModal").classList.add("open");setTimeout(()=>$("mEmployeeSearch").focus(),50)}
window.openMovementModal=openMovementModal;
function openMovementEdit(id){const m=db.movements.find(x=>x.id===id);if(!m)return;populateSelects();resetMovementForm();const e=emp(m.employeeId);$("mMovementId").value=id;$("movementModalTitle").textContent="Editar entrega / devolução";$("movementSaveButton").textContent="Salvar alterações";$("mType").value=m.type||"Entrega";if(e)selectMovementEmployee(e.id);$("mEpi").value=m.epiId||"";updateMovementSizes();$("mSize").value=m.size||$("mSize").value;$("mQty").value=m.qty||1;const d=fmtRaw(m.date);if(d){const local=new Date(new Date(d).getTime()-new Date().getTimezoneOffset()*60000);$("mDate").value=local.toISOString().slice(0,16)}$("mSignature").value=m.signatureStatus||"PENDENTE";$("mReturnDisposition").value=m.returnDisposition||"REESTOQUE";$("returnDispositionWrap").classList.toggle("hidden",$("mType").value!=="Devolução");$("mObs").value=m.obs||"";$("movementModal").classList.add("open")}
window.openMovementEdit=openMovementEdit;
function openEmployeeModal(){if(!db.plants.length){userAlert("Cadastre uma usina em Configurações antes.");return}populateSelects();$("employeeForm").reset();$("eId").value="";$("employeeModalTitle").textContent="Novo colaborador";$("employeeSaveButton").textContent="Cadastrar";$("employeeModal").classList.add("open")}
window.openEmployeeModal=openEmployeeModal;
function openEmployeeEdit(id){const e=emp(id);if(!e)return;populateSelects();$("eId").value=id;$("eName").value=e.name||"";$("eReg").value=e.reg||"";$("eRole").value=e.role||"";$("ePlant").value=e.plantId||"";$("eAdmission").value=e.admission||"";$("employeeModalTitle").textContent="Editar colaborador";$("employeeSaveButton").textContent="Salvar alterações";$("employeeModal").classList.add("open")}
window.openEmployeeEdit=openEmployeeEdit;
function openEpiModal(id=""){$("epiForm").reset();populateSelects();$("pId").value=id;if(id){const p=epi(id);if(!p)return;$("epiModalTitle").textContent="Editar EPI / Reabastecer";$("epiSaveButton").textContent="Salvar alterações";$("pPlant").value=p.plantId||"";$("pName").value=p.name||"";$("pCA").value=p.ca||"";$("pUnit").value=p.unit||"Unidade";$("pSizes").value=(p.sizes||[]).join(", ");$("pStock").value=stockQty(p);$("pMinStock").value=epiMin(p)}else{$("epiModalTitle").textContent="Novo EPI";$("epiSaveButton").textContent="Cadastrar";$("pStock").value=0;$("pMinStock").value=0}$("epiModal").classList.add("open")}window.openEpiModal=openEpiModal;
function openPlantModal(){$("plantModal").classList.add("open")}window.openPlantModal=openPlantModal;
function openSignatureModal(id,current){$("signatureMovementId").value=id;$("signatureStatus").value=current==="ASSINADO"?"ASSINADO":"PENDENTE";$("signatureModal").classList.add("open")}window.openSignatureModal=openSignatureModal;
function openUserEdit(id){const u=db.users.find(x=>x.id===id);if(!u)return;$("editUserId").value=id;$("editUserName").value=u.name||"";pendingUserPhotoDataUrl=u.photoUrl||"";renderUserPhotoPreview(u);$("editUserPhotoFile").value="";$("userEditModal").classList.add("open")}
window.openUserEdit=openUserEdit;
function renderUserPhotoPreview(u){const img=$("editUserPhotoPreview");if(pendingUserPhotoDataUrl){img.src=pendingUserPhotoDataUrl;img.classList.remove("no-photo");img.alt="Foto do usuário"}else{img.removeAttribute("src");img.classList.add("no-photo");img.alt=(u?.name||"Usuário").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}}


function logAudit(action,record){
  const payload={action,record,userUid:auth.currentUser.uid,userEmail:auth.currentUser.email,userName:profile.name||auth.currentUser.email,createdAt:serverTimestamp()};
  addDoc(collection(firestore,"auditLogs"),payload).then(ref=>{
    if(auditLoaded){db.audit.unshift({id:ref.id,...payload,createdAt:new Date()});if($("auditoria")?.classList.contains("active"))renderAudit()}
  }).catch(err=>console.error("Falha ao gravar auditoria:",err));
  return Promise.resolve();
}
$("plantForm").onsubmit=async e=>{e.preventDefault();try{const name=$("uName").value.trim(),ref=await addDoc(collection(firestore,"plants"),{name,createdAt:serverTimestamp(),createdBy:auth.currentUser.uid});db.plants.push({id:ref.id,name});logAudit("CADASTRO_USINA",name);e.target.reset();closeModal("plantModal");refresh();showToast("Usina cadastrada com sucesso.")}catch(err){console.error(err);userAlert("Não foi possível cadastrar a usina.")}};
$("employeeForm").onsubmit=async e=>{e.preventDefault();try{
  const id=$("eId").value,data={name:$("eName").value.trim(),reg:$("eReg").value.trim(),role:$("eRole").value.trim(),plantId:$("ePlant").value,admission:$("eAdmission").value,status:"Ativo",updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid};
  if(id){await setDoc(doc(firestore,"employees",id),data,{merge:true});const i=db.employees.findIndex(x=>x.id===id);if(i>=0)db.employees[i]={...db.employees[i],...data};logAudit("EDICAO_COLABORADOR",data.name)}
  else{data.createdAt=serverTimestamp();data.createdBy=auth.currentUser.uid;const ref=await addDoc(collection(firestore,"employees"),data);db.employees.push({id:ref.id,...data});logAudit("CADASTRO_COLABORADOR",data.name)}
  e.target.reset();closeModal("employeeModal");refresh();showToast(id?"Colaborador atualizado.":"Colaborador cadastrado com sucesso.")
}catch(err){console.error(err);userAlert("Não foi possível salvar o colaborador.")}};
$("epiForm").onsubmit=async e=>{e.preventDefault();try{
  const id=$("pId").value,data={plantId:$("pPlant").value,name:$("pName").value.trim(),ca:$("pCA").value.trim(),unit:$("pUnit").value,sizes:$("pSizes").value.split(",").map(x=>x.trim()).filter(Boolean),stockQty:Math.max(0,+$("pStock").value||0),minStock:Math.max(0,+$("pMinStock").value||0),updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid};
  if(id){await setDoc(doc(firestore,"epis",id),data,{merge:true});const i=db.epis.findIndex(x=>x.id===id);if(i>=0)db.epis[i]={...db.epis[i],...data};logAudit("EDICAO_EPI",`${data.name} — ${plantName(data.plantId)} — estoque ${data.stockQty}`)}
  else{data.createdAt=serverTimestamp();data.createdBy=auth.currentUser.uid;const ref=await addDoc(collection(firestore,"epis"),data);db.epis.push({id:ref.id,...data});logAudit("CADASTRO_EPI",`${data.name} — ${plantName(data.plantId)} — estoque ${data.stockQty}`)}
  e.target.reset();closeModal("epiModal");refresh();showToast(id?"EPI atualizado com sucesso.":"EPI cadastrado com sucesso.")
}catch(err){console.error(err);userAlert("Não foi possível salvar o EPI.")}};

$("movementForm").onsubmit=async e=>{
  e.preventDefault();const movementId=$("mMovementId").value,employee=resolveMovementEmployee(false),type=$("mType").value,qty=Math.max(1,+$("mQty").value||1),epiId=$("mEpi").value,p=epi(epiId);
  if(!employee){userAlert("Selecione um colaborador nas sugestões.");return}if(!p){userAlert("Selecione um EPI.");return}if(p.plantId!==employee.plantId){userAlert("O EPI selecionado não pertence à usina do colaborador.");return}
  const newData={date:new Date($("mDate").value),type,employeeId:employee.id,plantId:employee.plantId,epiId,qty,size:$("mSize").value,signatureStatus:$("mSignature").value,returnDisposition:type==="Devolução"?$("mReturnDisposition").value:null,obs:$("mObs").value.trim(),updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid};
  try{
    if(!movementId){const epiRef=doc(firestore,"epis",epiId),moveRef=doc(collection(firestore,"movements"));await runTransaction(firestore,async tx=>{const es=await tx.get(epiRef);if(!es.exists())throw new Error("EPI_NAO_ENCONTRADO");const current=stockQty(es.data());let next=current;if(type==="Entrega"){if(current<qty)throw new Error("ESTOQUE_INSUFICIENTE");next=current-qty}else if(newData.returnDisposition==="REESTOQUE")next=current+qty;if(next!==current)tx.update(epiRef,{stockQty:next,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});tx.set(moveRef,{...newData,userUid:auth.currentUser.uid,userEmail:auth.currentUser.email,userName:profile.name||auth.currentUser.email,createdAt:serverTimestamp()})});await logAudit(type.toUpperCase(),`${p.name} → ${employee.name}`)}
    else{const moveRef=doc(firestore,"movements",movementId);await runTransaction(firestore,async tx=>{const ms=await tx.get(moveRef);if(!ms.exists())throw new Error("MOVIMENTO_NAO_ENCONTRADO");const old=ms.data(),oldRef=doc(firestore,"epis",old.epiId),newRef=doc(firestore,"epis",epiId),oldSnap=await tx.get(oldRef),newSnap=old.epiId===epiId?oldSnap:await tx.get(newRef);if(!oldSnap.exists()||!newSnap.exists())throw new Error("EPI_NAO_ENCONTRADO");const stocks=new Map([[old.epiId,stockQty(oldSnap.data())],[epiId,stockQty(newSnap.data())]]),adjust=(id,delta)=>{const value=(stocks.get(id)||0)+delta;if(value<0)throw new Error("ESTOQUE_INSUFICIENTE");stocks.set(id,value)};if(old.type==="Entrega")adjust(old.epiId,+Number(old.qty||0));else if(old.type==="Devolução"&&(old.returnDisposition||"REESTOQUE")==="REESTOQUE")adjust(old.epiId,-Number(old.qty||0));if(type==="Entrega")adjust(epiId,-qty);else if(newData.returnDisposition==="REESTOQUE")adjust(epiId,+qty);for(const [id,value] of stocks)tx.update(doc(firestore,"epis",id),{stockQty:value,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});tx.update(moveRef,newData)});await logAudit("EDICAO_MOVIMENTACAO",`${p.name} → ${employee.name}`)}
    e.target.reset();closeModal("movementModal");await reloadOperationalData();showToast(movementId?"Movimentação atualizada.":`${type} registrada com sucesso.`);
  }catch(err){console.error(err);userAlert(err.message==="ESTOQUE_INSUFICIENTE"?"Estoque insuficiente para concluir esta alteração.":"Não foi possível salvar a movimentação.")}
};

$("signatureForm").onsubmit=async e=>{
  e.preventDefault();
  const id=$("signatureMovementId").value,status=$("signatureStatus").value;
  try{
    await updateDoc(doc(firestore,"movements",id),{signatureStatus:status,signatureUpdatedAt:serverTimestamp(),signatureUpdatedBy:auth.currentUser.uid});
    logAudit("ASSINATURA_EPI",`Movimentação ${id}: ${status}`);
    const i=db.movements.findIndex(x=>x.id===id);
    if(i>=0)db.movements[i]={...db.movements[i],signatureStatus:status,signatureUpdatedAt:new Date(),signatureUpdatedBy:auth.currentUser.uid};
    closeModal("signatureModal");refresh();showToast("Status da assinatura atualizado.");
  }catch(err){console.error("Assinatura:",err);userAlert("Não foi possível alterar a assinatura. Verifique a conexão e as permissões do usuário.")}
};

function resizeUserPhoto(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>{const i=new Image();i.onerror=reject;i.onload=()=>{const size=240,c=document.createElement("canvas");c.width=size;c.height=size;const ctx=c.getContext("2d"),scale=Math.max(size/i.width,size/i.height),w=i.width*scale,h=i.height*scale;ctx.drawImage(i,(size-w)/2,(size-h)/2,w,h);resolve(c.toDataURL("image/jpeg",.82))};i.src=r.result};r.readAsDataURL(file)})}
$("editUserPhotoFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{pendingUserPhotoDataUrl=await resizeUserPhoto(f);renderUserPhotoPreview(db.users.find(x=>x.id===$("editUserId").value))}catch(err){console.error(err);userAlert("Não foi possível processar a foto.")}});
$("removeUserPhoto").addEventListener("click",()=>{pendingUserPhotoDataUrl="";renderUserPhotoPreview(db.users.find(x=>x.id===$("editUserId").value))});
$("userEditForm").onsubmit=async e=>{e.preventDefault();try{const id=$("editUserId").value,name=$("editUserName").value.trim();await updateDoc(doc(firestore,"users",id),{name,photoUrl:pendingUserPhotoDataUrl||"",updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});await logAudit("EDICAO_USUARIO",name);if(id===auth.currentUser.uid){profile.name=name;profile.photoUrl=pendingUserPhotoDataUrl||"";updateProfileUI()}const i=db.users.findIndex(x=>x.id===id);if(i>=0)db.users[i]={...db.users[i],name,photoUrl:pendingUserPhotoDataUrl||""};closeModal("userEditModal");renderUsers();showToast("Usuário atualizado.")}catch(err){console.error(err);userAlert("Não foi possível atualizar o usuário.")}};

async function removeMovement(id){if(!canDeleteOperational())return;const moveRef=doc(firestore,"movements",id);try{await runTransaction(firestore,async tx=>{const ms=await tx.get(moveRef);if(!ms.exists())return;const m=ms.data(),er=doc(firestore,"epis",m.epiId),es=await tx.get(er);if(es.exists()){const current=stockQty(es.data()),qty=+m.qty||0;let next=current;if(m.type==="Entrega")next=current+qty;else if(m.type==="Devolução"&&(m.returnDisposition||"REESTOQUE")==="REESTOQUE"){if(current<qty)throw new Error("ESTOQUE_INCONSISTENTE");next=current-qty}if(next!==current)tx.update(er,{stockQty:next,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid})}tx.delete(moveRef)});logAudit("REMOCAO_MOVIMENTACAO",id);await reloadOperationalData()}catch(err){console.error(err);userAlert(err.message==="ESTOQUE_INCONSISTENTE"?"Não é possível remover esta devolução porque parte desse estoque já foi utilizado.":"Não foi possível remover a movimentação.")}}window.removeMovement=removeMovement;
async function removeEmployee(id){if(!canDeleteOperational())return;if(db.movements.some(m=>m.employeeId===id)){userAlert("Este colaborador possui movimentações. Remova as movimentações relacionadas antes.");return}const e=emp(id);try{await deleteDoc(doc(firestore,"employees",id));logAudit("REMOCAO_COLABORADOR",e?.name||id);db.employees=db.employees.filter(x=>x.id!==id);refresh();showToast("Colaborador removido.")}catch(err){console.error(err);userAlert("Não foi possível remover o colaborador.")}}window.removeEmployee=removeEmployee;
async function removeEpi(id){if(!canDeleteOperational())return;if(db.movements.some(m=>m.epiId===id)){userAlert("Este EPI possui movimentações. Remova as movimentações relacionadas antes.");return}const p=epi(id);try{await deleteDoc(doc(firestore,"epis",id));logAudit("REMOCAO_EPI",p?.name||id);db.epis=db.epis.filter(x=>x.id!==id);refresh();showToast("EPI removido.")}catch(err){console.error(err);userAlert("Não foi possível remover o EPI.")}}window.removeEpi=removeEpi;
async function removePlant(id){if(!canDeleteOperational())return;if(db.employees.some(e=>e.plantId===id)||db.epis.some(p=>p.plantId===id)){userAlert("Esta usina possui colaboradores ou EPIs vinculados. Remova ou transfira esses cadastros antes.");return}const name=plantName(id);try{await deleteDoc(doc(firestore,"plants",id));logAudit("REMOCAO_USINA",name);db.plants=db.plants.filter(x=>x.id!==id);refresh();showToast("Usina removida.")}catch(err){console.error(err);userAlert("Não foi possível remover a usina.")}}window.removePlant=removePlant;
async function removeUser(id){if(!isOwner())return;if(id===auth.currentUser.uid){userAlert("O proprietário não pode remover o próprio acesso enquanto estiver conectado.");return}const u=db.users.find(x=>x.id===id);try{await deleteDoc(doc(firestore,"users",id));logAudit("REMOCAO_USUARIO",u?.email||id);db.users=db.users.filter(x=>x.id!==id);renderUsers();showToast("Usuário removido.")}catch(err){console.error(err);userAlert("Não foi possível remover o usuário.")}}window.removeUser=removeUser;
async function removeAudit(id){if(!isOwner())return;try{await deleteDoc(doc(firestore,"auditLogs",id));db.audit=db.audit.filter(x=>x.id!==id);renderAudit();showToast("Registro de auditoria removido.")}catch(err){console.error(err);userAlert("Não foi possível remover o registro.")}}
window.removeAudit=removeAudit;

function resizeLogo(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onerror=reject;r.onload=()=>{const i=new Image();i.onerror=reject;i.onload=()=>{const max=420,s=Math.min(1,max/Math.max(i.width,i.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(i.width*s));c.height=Math.max(1,Math.round(i.height*s));c.getContext("2d").drawImage(i,0,0,c.width,c.height);resolve(c.toDataURL("image/png",.92))};i.src=r.result};r.readAsDataURL(file)})}
$("companyLogoFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{pendingLogoDataUrl=await resizeLogo(f);$("companyLogoPreview").src=pendingLogoDataUrl}catch(err){console.error(err);userAlert("Não foi possível processar a imagem.")}});$("removeCompanyLogo").addEventListener("click",()=>{pendingLogoDataUrl="";$("companyLogoFile").value="";$("companyLogoPreview").src="./logo-symbol.png"});$("companyForm").onsubmit=async e=>{e.preventDefault();try{const data={companyName:$("companyName").value.trim(),logoDataUrl:pendingLogoDataUrl||"",updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid};await setDoc(doc(firestore,"settings","company"),data,{merge:true});logAudit("CONFIGURACOES_EMPRESA",data.companyName);db.settings={...db.settings,...data};applyBranding();renderSettings();showToast("Configurações salvas.")}catch(err){console.error(err);userAlert("Não foi possível salvar as configurações.")}};

function populateReportFilters(){const currentPlant=$("reportPlant").value;$("reportEmployeeSuggestions").innerHTML=db.employees.map(e=>`<option value="${escAttr(e.name)}"></option>`).join("");$("reportPlant").innerHTML='<option value="">Todas as usinas</option>'+db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");if([...$("reportPlant").options].some(o=>o.value===currentPlant))$("reportPlant").value=currentPlant;updateReportSummary()}
function resolveReportEmployee(refresh=true){const value=$("reportEmployeeSearch").value.trim().toLowerCase();const exact=db.employees.find(e=>(e.name||"").trim().toLowerCase()===value);$("reportEmployeeId").value=exact?.id||"";if(exact){$("reportPlant").value=exact.plantId;$("reportPlant").disabled=true}else{$("reportPlant").disabled=false}if(refresh)updateReportSummary()}
$("reportEmployeeSearch").addEventListener("input",resolveReportEmployee);$("reportPlant").addEventListener("change",updateReportSummary);$("reportFrom").addEventListener("change",updateReportSummary);$("reportTo").addEventListener("change",updateReportSummary);
function filteredReportMoves(showAlert=false){resolveReportEmployee(false);const typed=$("reportEmployeeSearch").value.trim(),employeeId=$("reportEmployeeId").value,plantId=$("reportPlant").value,from=$("reportFrom").value?new Date($("reportFrom").value+"T00:00:00"):null,to=$("reportTo").value?new Date($("reportTo").value+"T23:59:59"):null;if(showAlert&&typed&&!employeeId){userAlert("Selecione um colaborador sugerido pelo sistema ou apague o nome para gerar por usina/período.");return null}return [...db.movements].filter(m=>{const d=new Date(fmtRaw(m.date));return(!employeeId||m.employeeId===employeeId)&&(!plantId||m.plantId===plantId)&&(!from||d>=from)&&(!to||d<=to)}).sort((a,b)=>new Date(fmtRaw(a.date))-new Date(fmtRaw(b.date)))}
function updateReportSummary(){const rows=filteredReportMoves(false)||[];const ent=rows.filter(x=>x.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),dev=rows.filter(x=>x.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0);$("reportSummary").textContent=`${rows.length} registro(s) encontrado(s) • ${ent} entregue(s) • ${dev} devolvido(s)`}
function clearReportFilters(){$("reportEmployeeSearch").value="";$("reportEmployeeId").value="";$("reportPlant").disabled=false;$("reportPlant").value="";$("reportFrom").value="";$("reportTo").value="";updateReportSummary()}window.clearReportFilters=clearReportFilters;
function reportHeader(){const logo=db.settings.logoDataUrl?`<img src="${db.settings.logoDataUrl}" alt="Logo">`:"",company=esc(db.settings.companyName||"Empresa");return`<div class="r-head">${logo}<div><h1>${company}</h1><h2>Gestão de EPIs</h2></div></div>`}
function printFilteredReport(){const rows=filteredReportMoves(true);if(!rows)return;const employeeId=$("reportEmployeeId").value,employee=emp(employeeId),plantId=$("reportPlant").value,sub=[employee?`Colaborador: ${employee.name}`:"",plantId?`Usina: ${plantName(plantId)}`:"Todas as usinas",$("reportFrom").value?`A partir de: ${new Date($("reportFrom").value+"T12:00").toLocaleDateString("pt-BR")}`:"",$("reportTo").value?`Até: ${new Date($("reportTo").value+"T12:00").toLocaleDateString("pt-BR")}`:""] .filter(Boolean).join(" • ");const popup=window.open("","_blank");if(!popup){userAlert("Permita pop-ups para gerar o relatório.");return}const tr=rows.map(m=>`<tr><td>${esc(fmtDate(m.date))}</td><td>${esc(m.type)}</td><td>${esc(emp(m.employeeId)?.name||"-")}</td><td>${esc(plantName(m.plantId))}</td><td>${esc(epi(m.epiId)?.name||"-")}</td><td>${m.qty||0}</td><td>${esc(m.size||"-")}</td><td>${esc(returnText(m))}</td><td>${esc(sigLabel(m.signatureStatus))}</td><td>${esc(m.obs||"-")}</td></tr>`).join("");popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório de EPIs</title><style>body{font-family:Arial;padding:28px;color:#111}.r-head{display:flex;align-items:center;gap:16px;border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:16px}.r-head img{max-width:90px;max-height:70px;border-radius:8px}.r-head h1{margin:0;font-size:20px}.r-head h2{margin:3px 0 0;font-size:13px;font-weight:400;color:#555}h3{margin-bottom:4px}.sub{color:#555;font-size:12px}table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eee}.foot{font-size:10px;color:#666;margin-top:15px}</style></head><body>${reportHeader()}<h3>Relatório geral de EPIs</h3><p class="sub">${esc(sub)}</p><table><thead><tr><th>Data</th><th>Tipo</th><th>Colaborador</th><th>Usina</th><th>EPI</th><th>Qtd.</th><th>Tamanho</th><th>Destino devolução</th><th>Assinatura</th><th>Observações</th></tr></thead><tbody>${tr}</tbody></table><div class="foot">Emitido em ${new Date().toLocaleString("pt-BR")}</div><script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);popup.document.close()}window.printFilteredReport=printFilteredReport;
function downloadFilteredCSV(){const rows=filteredReportMoves(true);if(!rows)return;const data=[["Data","Tipo","Colaborador","Usina","EPI","Quantidade","Tamanho","Destino devolução","Assinatura","Observações"],...rows.map(m=>[fmtDate(m.date),m.type,emp(m.employeeId)?.name||"",plantName(m.plantId),epi(m.epiId)?.name||"",m.qty,m.size||"",returnText(m),sigLabel(m.signatureStatus),m.obs||""])];const csv=data.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n"),blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="relatorio-epis-filtrado.csv";a.click();URL.revokeObjectURL(a.href)}window.downloadFilteredCSV=downloadFilteredCSV;



function handleEmployeeDeepLink(){if(employeeDeepLinkHandled)return;const id=new URLSearchParams(location.search).get("employee");if(id&&emp(id)){employeeDeepLinkHandled=true;navTo("colaboradores");setTimeout(()=>openEmployeeHistory(id),80)}}
function notificationStorageKey(){return `gestao-epis-notifications-read:${auth.currentUser?.uid||"anon"}`}
function notificationReadSet(){try{return new Set(JSON.parse(localStorage.getItem(notificationStorageKey())||"[]"))}catch{return new Set()}}
function saveNotificationReadSet(set){localStorage.setItem(notificationStorageKey(),JSON.stringify([...set].slice(-500)))}
function notificationStamp(v){const raw=fmtRaw(v);return raw?new Date(raw).getTime():0}
function buildNotifications(){
  const list=[];
  db.epis.filter(p=>stockQty(p)===0).forEach(p=>list.push({key:`stock-zero:${p.id}:${notificationStamp(p.updatedAt)}`,type:"critical",title:`${p.name} sem estoque`,text:plantName(p.plantId),action:`goToEpi('${p.plantId}')`,time:notificationStamp(p.updatedAt)}));
  db.epis.filter(p=>epiStockState(p).key==="low").forEach(p=>list.push({key:`stock-low:${p.id}:${stockQty(p)}:${notificationStamp(p.updatedAt)}`,type:"warning",title:`${p.name} em estoque mínimo`,text:`${plantName(p.plantId)} • ${stockQty(p)} unidade(s)`,action:`goToEpi('${p.plantId}')`,time:notificationStamp(p.updatedAt)}));
  db.movements.filter(m=>(m.signatureStatus||"PENDENTE")!=="ASSINADO").forEach(m=>list.push({key:`signature:${m.id}:${notificationStamp(m.signatureUpdatedAt||m.updatedAt||m.date)}`,type:"info",title:"Assinatura pendente",text:`${emp(m.employeeId)?.name||"Colaborador"} • ${epi(m.epiId)?.name||"EPI"}`,action:`openPendingSignatures()`,time:new Date(fmtRaw(m.date)).getTime()}));
  const read=notificationReadSet();
  return list.map(n=>({...n,read:read.has(n.key)})).sort((a,b)=>Number(a.read)-Number(b.read)||({critical:0,warning:1,info:2}[a.type]-({critical:0,warning:1,info:2}[b.type]))||b.time-a.time);
}
function markNotificationRead(key){const set=notificationReadSet();set.add(key);saveNotificationReadSet(set);renderNotifications();showToast("Notificação marcada como lida.")}
window.markNotificationRead=markNotificationRead;
function markAllNotificationsRead(){const set=notificationReadSet();buildNotifications().forEach(n=>set.add(n.key));saveNotificationReadSet(set);renderNotifications();showToast("Notificações marcadas como lidas.")}
window.markAllNotificationsRead=markAllNotificationsRead;
function renderNotifications(){
  const list=buildNotifications(),unread=list.filter(x=>!x.read),critical=unread.filter(x=>x.type==="critical").length,warning=unread.filter(x=>x.type==="warning").length,info=unread.filter(x=>x.type==="info").length,total=unread.length;
  if($("notificationBadge")){$("notificationBadge").textContent=total>99?"99+":total;$("notificationBadge").classList.toggle("hidden",!total)}
  if($("notificationCriticalCount"))$("notificationCriticalCount").textContent=critical;if($("notificationWarningCount"))$("notificationWarningCount").textContent=warning;if($("notificationInfoCount"))$("notificationInfoCount").textContent=info;
  if($("markAllNotificationsBtn"))$("markAllNotificationsBtn").disabled=!total;
  if($("notificationList"))$("notificationList").innerHTML=list.map(n=>`<div class="notification-item ${n.type} ${n.read?"is-read":"is-unread"}" onclick="${n.action};closeNotificationPanel()"><span class="notification-type-dot"></span><div class="notification-copy"><strong>${esc(n.title)}</strong><small>${esc(n.text)}</small>${n.read?'<em>Lida</em>':''}</div><div class="notification-item-actions">${n.read?'':`<button type="button" onclick="event.stopPropagation();markNotificationRead('${escAttr(n.key)}')">Marcar como lida</button>`}<span class="notification-arrow">›</span></div></div>`).join("")||'<div class="notification-empty">Tudo certo por aqui.<br><small>Nenhuma notificação ativa.</small></div>';
}

function openNotificationPanel(){renderNotifications();$("notificationPanel").classList.add("open");$("notificationBackdrop").classList.remove("hidden");document.body.classList.add("notification-open")}
function closeNotificationPanel(){if($("notificationPanel"))$("notificationPanel").classList.remove("open");if($("notificationBackdrop"))$("notificationBackdrop").classList.add("hidden");document.body.classList.remove("notification-open")}
window.openNotificationPanel=openNotificationPanel;window.closeNotificationPanel=closeNotificationPanel;
if($("notificationBtn"))$("notificationBtn").addEventListener("click",openNotificationPanel);
function updateConnectionUI(){const online=navigator.onLine;if($("onlineChip")){$("onlineChip").classList.toggle("online",online);$("onlineChip").classList.toggle("offline",!online);$("onlineChip").querySelector("span:last-child").textContent=online?"Online":"Offline"}if($("settingsConnection"))$("settingsConnection").textContent=online?"Online":"Offline"}
window.addEventListener("online",()=>{updateConnectionUI();showToast("Conexão restabelecida.")});window.addEventListener("offline",()=>{updateConnectionUI();showToast("Você está offline.","error")});updateConnectionUI();

// Busca geral
function openGlobalSearch(){
  $("globalSearchModal").classList.add("open");
  $("globalSearchInput").value="";
  renderGlobalSearch("");
  setTimeout(()=>$("globalSearchInput").focus(),50);
}
if($("globalSearchBtn"))$("globalSearchBtn").addEventListener("click",openGlobalSearch);
document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openGlobalSearch()}});
if($("globalSearchInput"))$("globalSearchInput").addEventListener("input",e=>renderGlobalSearch(e.target.value));
function renderGlobalSearch(query){
  const q=(query||"").trim().toLowerCase();
  if(!q){$("globalSearchResults").innerHTML='<div class="search-empty">Digite para pesquisar colaboradores, EPIs e movimentações.</div>';return}
  const results=[];
  db.employees.filter(e=>[e.name,e.reg,e.role,plantName(e.plantId)].some(v=>String(v||"").toLowerCase().includes(q))).slice(0,6).forEach(e=>results.push({type:"Colaborador",title:e.name,sub:`${e.role||"-"} • ${plantName(e.plantId)}`,action:`openEmployeeHistory('${e.id}');closeModal('globalSearchModal')`}));
  db.epis.filter(p=>[p.name,p.ca,plantName(p.plantId)].some(v=>String(v||"").toLowerCase().includes(q))).slice(0,6).forEach(p=>results.push({type:"EPI",title:p.name,sub:`${plantName(p.plantId)} • Estoque ${stockQty(p)}`,action:`goToEpi('${p.plantId}');closeModal('globalSearchModal')`}));
  db.movements.filter(m=>[emp(m.employeeId)?.name,epi(m.epiId)?.name,plantName(m.plantId),m.type].some(v=>String(v||"").toLowerCase().includes(q))).slice(0,5).forEach(m=>results.push({type:"Movimentação",title:`${m.type} — ${emp(m.employeeId)?.name||"-"}`,sub:`${epi(m.epiId)?.name||"-"} • ${fmtDate(m.date)}`,action:`navTo('movimentacoes');$('movSearch').value='${escAttr(emp(m.employeeId)?.name||"")}';renderMovements();closeModal('globalSearchModal')`}));
  $("globalSearchResults").innerHTML=results.length?results.map(r=>`<button class="search-result" onclick="${r.action}"><span class="search-result-type">${r.type}</span><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></button>`).join(""):'<div class="search-empty">Nenhum resultado encontrado.</div>';
}
window.openGlobalSearch=openGlobalSearch;

// Navegação mobile inferior
document.querySelectorAll("[data-mobile-view]").forEach(btn=>btn.addEventListener("click",()=>{
  const v=btn.dataset.mobileView;
  if(v==="more"){openMobileMenu();return}
  if(v==="movimentacoes"&&!isSSMA()){showToast("Seu perfil não possui acesso a movimentações.","error");return}
  navTo(v);
  closeMobileMenu();
}));
