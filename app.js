import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, runTransaction, writeBatch, query, where, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseApp=initializeApp(firebaseConfig), auth=getAuth(firebaseApp), firestore=getFirestore(firebaseApp);
setPersistence(auth,browserLocalPersistence).catch(err=>console.error("Persistência de login:",err));
const $=id=>document.getElementById(id);
let profile=null, pendingLogoDataUrl=null;
let db={plants:[],employees:[],epis:[],movements:[],archivedMovements:[],users:[],audit:[],settings:{}};

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
let registrationInProgress=false,pendingWatcher=null,ownerUsersRefreshTimer=null,userStatusFilter="";
let pendingUserUnsubscribe=null,ownerUsersUnsubscribe=null,movementArchiveLoaded=false,movementArchiveMode=false,movementPage=1;const MOVEMENT_PAGE_SIZE=50;
let deferredInstallPrompt=null,updateAvailableVersion="",updateBannerDismissed=false,swRegistration=null,updateReloading=false;
let qrScannerStream=null,qrScannerTimer=null,qrScannerBusy=false;
let auditLoaded=false,auditLoading=false;

const APP_VERSION="2.0.4";

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
function showUpdateAvailable(remote=""){
  updateAvailableVersion=remote||updateAvailableVersion||"nova";
  const btn=$("systemUpdateBtn");if(btn){btn.classList.remove("hidden");const small=btn.querySelector("small");if(small)small.textContent=remote?`Versão ${remote}`:"Atualizar sistema"}
  const banner=$("appUpdateBanner");
  if(banner&&!updateBannerDismissed){
    banner.classList.remove("hidden");
    if($("appUpdateVersionText"))$("appUpdateVersionText").textContent=remote?`Versão ${remote} pronta para instalar.`:"Uma nova versão do sistema está pronta.";
  }
}
function dismissUpdateBanner(){updateBannerDismissed=true;$("appUpdateBanner")?.classList.add("hidden")}window.dismissUpdateBanner=dismissUpdateBanner;
async function checkSystemUpdate(manual=false){
  try{
    const res=await fetch(`./version.json?ts=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
    if(!res.ok)return;
    const remote=normalizeVersion((await res.json()).version);
    const hasUpdate=!!remote&&remote!==APP_VERSION;
    if(hasUpdate)showUpdateAvailable(remote);
    else{
      updateAvailableVersion="";
      $("systemUpdateBtn")?.classList.add("hidden");
      $("appUpdateBanner")?.classList.add("hidden");
    }
    if(manual)showToast(hasUpdate?`Nova versão ${remote} disponível.`:"Seu sistema já está atualizado.");
    if($("settingsLastCheck"))$("settingsLastCheck").textContent=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
  }catch(err){console.debug("Verificação de atualização indisponível.",err)}
}
async function forceSystemUpdate(){
  if(updateReloading)return;updateReloading=true;
  const btn=$("systemUpdateBtn");
  if(btn){btn.disabled=true;btn.classList.add("updating");const small=btn.querySelector("small");if(small)small.textContent="Atualizando..."}
  showToast("Aplicando atualização...");
  try{
    if("serviceWorker" in navigator){
      const reg=swRegistration||await navigator.serviceWorker.getRegistration("./");
      if(reg){
        await reg.update().catch(()=>{});
        if(reg.waiting)reg.waiting.postMessage({type:"SKIP_WAITING"});
      }
    }
    if("caches" in window){
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith("gestao-epis-")).map(k=>caches.delete(k)));
    }
  }catch(err){console.warn("Atualização:",err)}
  setTimeout(()=>{
    const url=new URL(location.href);
    url.searchParams.set("update",Date.now());
    location.replace(url.toString());
  },350);
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
function epiConsumptionStats(epiId,days=90){
  const cutoff=Date.now()-days*86400000;
  const delivered=db.movements.filter(m=>m.epiId===epiId&&m.type==="Entrega"&&new Date(fmtRaw(m.date)).getTime()>=cutoff).reduce((a,m)=>a+Number(m.qty||0),0);
  const monthly=delivered/(days/30);
  const p=epi(epiId),qty=stockQty(p);
  const autonomy=monthly>0?qty/monthly:null;
  let forecast="normal";
  if(qty===0)forecast="critical";
  else if(monthly>0&&autonomy<=1)forecast="critical";
  else if(monthly>0&&autonomy<=2)forecast="warning";
  else if(epiStockState(p).key==="low")forecast="warning";
  return {delivered,monthly,autonomy,forecast};
}
function fmtMonthly(v){return v<0.05?"0":v<10?v.toFixed(1):Math.round(v).toString()}
function fmtAutonomy(v){return v==null?"Sem histórico":v<0.1?"< 0,1 mês":`${v.toFixed(1).replace(".",",")} ${v<1.5?"mês":"meses"}`}

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



function isStandaloneMode(){return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true}
function updatePwaInstallUI(){
  const installed=isStandaloneMode();
  if($("installAppBtn"))$("installAppBtn").classList.toggle("hidden",installed);
  if($("settingsInstallBtn"))$("settingsInstallBtn").classList.toggle("hidden",installed);
  if($("pwaInstallStatusText"))$("pwaInstallStatusText").textContent=installed?"Instalado neste dispositivo":deferredInstallPrompt?"Pronto para instalar":"Instalação disponível pelo menu do navegador";
  if($("pwaInstallStatus"))$("pwaInstallStatus").classList.toggle("installed",installed);
}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;updatePwaInstallUI()});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;updatePwaInstallUI();showToast("Gestão de EPIs instalado com sucesso.")});
async function installPwa(){
  if(isStandaloneMode()){showToast("O aplicativo já está instalado.");return}
  if(deferredInstallPrompt){
    try{
      deferredInstallPrompt.prompt();
      const result=await deferredInstallPrompt.userChoice;
      deferredInstallPrompt=null;updatePwaInstallUI();
      if(result.outcome==="accepted")showToast("Instalação iniciada.");
      else showToast("Instalação cancelada.","error");
      return;
    }catch(err){console.warn("Instalação PWA:",err)}
  }
  if($("pwaHelpText")){
    $("pwaHelpText").textContent=/Android/i.test(navigator.userAgent)?"O Chrome não liberou o botão automático neste momento. Você ainda pode instalar pelo menu do navegador.":"A instalação automática não está disponível neste navegador. Use a opção de adicionar/instalar do próprio navegador.";
  }
  $("pwaHelpModal")?.classList.add("open");
}
window.installPwa=installPwa;
updatePwaInstallUI();

async function registerAppServiceWorker(){
  if(!("serviceWorker" in navigator))return;
  try{
    const reg=await navigator.serviceWorker.register(`./sw.js?v=${APP_VERSION}`,{scope:"./",updateViaCache:"none"});
    swRegistration=reg;
    if(reg.waiting&&navigator.serviceWorker.controller)showUpdateAvailable(updateAvailableVersion);
    reg.addEventListener("updatefound",()=>{
      const worker=reg.installing;if(!worker)return;
      worker.addEventListener("statechange",()=>{
        if(worker.state==="installed"&&navigator.serviceWorker.controller)showUpdateAvailable(updateAvailableVersion);
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(updateReloading)return;
      checkSystemUpdate().catch(()=>{});
    });
    await reg.update().catch(()=>{});
    updatePwaInstallUI();
  }catch(err){console.warn("Service Worker:",err)}
}
registerAppServiceWorker();
checkSystemUpdate();
updateCheckTimer=setInterval(checkSystemUpdate,60*1000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkSystemUpdate()});
window.addEventListener("pageshow",()=>checkSystemUpdate());window.addEventListener("online",()=>checkSystemUpdate());



function setAuthenticatedUi(authenticated){
  const app=$("app");
  if(app)app.classList.toggle("hidden",!authenticated);
  if(!authenticated){
    try{closeMobileMenu()}catch(_){}
    try{stopQrScanner(true)}catch(_){}
    document.body.classList.remove("menu-open");
  }
}
function resetLoggedOutUi(){
  setAuthenticatedUi(false);
  profile=null;
  if(presenceTimer){clearInterval(presenceTimer);presenceTimer=null}
  if(ownerUsersRefreshTimer){clearInterval(ownerUsersRefreshTimer);ownerUsersRefreshTimer=null}
  if(ownerUsersUnsubscribe){ownerUsersUnsubscribe();ownerUsersUnsubscribe=null}
  stopPendingWatcher();
  $("accessPendingScreen")?.classList.add("hidden");
  $("loginScreen")?.classList.remove("hidden");
  setAuthMode("login");
}
function setAuthMode(mode){
  const login=mode==="login";$("loginTabBtn").classList.toggle("active",login);$("registerTabBtn").classList.toggle("active",!login);
  $("loginForm").classList.toggle("hidden",!login);$("registerForm").classList.toggle("hidden",login);
  $("authCardSubtitle").textContent=login?"Entre com sua conta autorizada.":"Cadastre-se para solicitar acesso ao sistema.";
  $("loginNote").textContent=login?"Acesso restrito a usuários cadastrados e ativos.":"A função e a usina serão definidas pelo Proprietário após a solicitação.";
  clearLoginError();$("registerError").classList.remove("show");$("registerError").textContent="";
}
$("loginTabBtn").addEventListener("click",()=>setAuthMode("login"));$("registerTabBtn").addEventListener("click",()=>setAuthMode("register"));
function showRegisterError(msg){$("registerError").textContent=msg;$("registerError").classList.add("show")}
function firebaseAuthMessage(err){const c=err?.code||"";if(c.includes("email-already-in-use"))return "Este e-mail já possui uma conta. Use a opção Entrar.";if(c.includes("weak-password"))return "A senha precisa ter pelo menos 6 caracteres.";if(c.includes("invalid-email"))return "Informe um e-mail válido.";if(c.includes("too-many-requests"))return "Muitas tentativas. Aguarde alguns minutos.";return "Não foi possível concluir a solicitação de acesso."}
function stopPendingWatcher(){
  if(pendingWatcher){clearInterval(pendingWatcher);pendingWatcher=null}
  if(pendingUserUnsubscribe){pendingUserUnsubscribe();pendingUserUnsubscribe=null}
}
function showPendingAccess(data,state="PENDENTE"){
  setAuthenticatedUi(false);$("loginScreen").classList.add("hidden");$("accessPendingScreen").classList.remove("hidden");$("pendingUserName").textContent=data?.name||"Usuário";$("pendingUserEmail").textContent=data?.email||auth.currentUser?.email||"-";$("pendingEnterBtn").classList.add("hidden");
  const icon=$("pendingStateIcon");icon.className="pending-state-icon";
  if(state==="BLOQUEADO"){icon.classList.add("blocked");icon.textContent="×";$("pendingStateKicker").textContent="ACESSO BLOQUEADO";$("pendingStateTitle").textContent="Acesso bloqueado";$("pendingStateText").textContent="Seu acesso foi bloqueado pelo Proprietário do Sistema. Entre em contato com o responsável para solicitar a reativação.";$("pendingLastCheck").textContent="Acesso indisponível.";stopPendingWatcher();return}
  icon.classList.add("waiting");icon.textContent="⌛";$("pendingStateKicker").textContent="SOLICITAÇÃO ENVIADA";$("pendingStateTitle").textContent="Aguardando aprovação";$("pendingStateText").textContent="Seu cadastro foi recebido. O Proprietário do Sistema precisa definir sua função e usina antes de liberar o acesso.";$("pendingLastCheck").textContent="Aguardando liberação em tempo real...";startPendingWatcher();
}
function showApprovedAccess(data){stopPendingWatcher();setAuthenticatedUi(false);$("loginScreen").classList.add("hidden");$("accessPendingScreen").classList.remove("hidden");$("pendingUserName").textContent=data?.name||"Usuário";$("pendingUserEmail").textContent=data?.email||auth.currentUser?.email||"-";const icon=$("pendingStateIcon");icon.className="pending-state-icon approved";icon.textContent="✓";$("pendingStateKicker").textContent="ACESSO APROVADO";$("pendingStateTitle").textContent="Seu acesso foi liberado";$("pendingStateText").textContent=`Função: ${humanRole(data.role)} • ${data.plantId==="TODAS"?"Todas as usinas":plantName(data.plantId)}.`;$("pendingLastCheck").textContent="A aprovação chegou em tempo real. Clique abaixo para entrar.";$("pendingEnterBtn").classList.remove("hidden")}
function startPendingWatcher(){
  stopPendingWatcher();if(!auth.currentUser)return;
  pendingUserUnsubscribe=onSnapshot(doc(firestore,"users",auth.currentUser.uid),snap=>{
    if(!snap.exists())return;
    const d={uid:snap.id,email:auth.currentUser?.email,...snap.data()};
    $("pendingLastCheck").textContent=`Atualizado: ${new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`;
    if(d.status==="ATIVO")showApprovedAccess(d);
    else if(d.status==="BLOQUEADO")showPendingAccess(d,"BLOQUEADO");
  },err=>console.debug("Aguardando aprovação:",err));
}
async function enterApprovedSystem(){if(!auth.currentUser)return;const s=await getDoc(doc(firestore,"users",auth.currentUser.uid));if(!s.exists())return;const d={uid:auth.currentUser.uid,email:auth.currentUser.email,...s.data()};if(d.status!=="ATIVO"){showPendingAccess(d,d.status);return}profile=d;$("accessPendingScreen").classList.add("hidden");updateProfileUI();applyPermissions();startPresence();await loadAll();$("loginScreen").classList.add("hidden");setAuthenticatedUi(true);handleEmployeeDeepLink();handleStartupView()}
$("pendingEnterBtn").addEventListener("click",()=>enterApprovedSystem().catch(err=>{console.error(err);userAlert("Não foi possível entrar no sistema agora.")}));
$("pendingLogoutBtn").addEventListener("click",async()=>{stopPendingWatcher();setAuthenticatedUi(false);await signOut(auth);resetLoggedOutUi()});
$("registerForm").addEventListener("submit",async e=>{e.preventDefault();$("registerError").classList.remove("show");const name=$("registerName").value.trim(),email=$("registerEmail").value.trim().toLowerCase(),p=$("registerPassword").value,p2=$("registerPassword2").value;if(name.length<3){showRegisterError("Informe seu nome completo.");return}if(p!==p2){showRegisterError("As senhas não coincidem.");return}registrationInProgress=true;try{const cred=await createUserWithEmailAndPassword(auth,email,p);const data={name,email,status:"PENDENTE",role:"",plantId:"",isOwner:false,photoUrl:"",createdAt:serverTimestamp(),requestedAt:serverTimestamp(),hierarchyVersion:1};await setDoc(doc(firestore,"users",cred.user.uid),data);registrationInProgress=false;$("registerForm").reset();showPendingAccess({...data,uid:cred.user.uid,email},"PENDENTE")}catch(err){registrationInProgress=false;console.error(err);showRegisterError(firebaseAuthMessage(err));if(auth.currentUser)await signOut(auth).catch(()=>{})}});
$("loginForm").addEventListener("submit",async e=>{e.preventDefault();clearLoginError();try{await signInWithEmailAndPassword(auth,$("loginEmail").value.trim(),$("loginPassword").value)}catch(err){console.error(err);showLoginError("Não foi possível entrar. Confira o e-mail e a senha.")}});
$("logoutBtn").addEventListener("click",async()=>{try{closeMobileMenu();setAuthenticatedUi(false);await signOut(auth)}catch(err){console.error("Logout:",err);resetLoggedOutUi()}});if(ownerUsersUnsubscribe){ownerUsersUnsubscribe();ownerUsersUnsubscribe=null}stopPendingWatcher();signOut(auth)});

onAuthStateChanged(auth,async user=>{
  if(registrationInProgress)return;
  if(!user){resetLoggedOutUi();return}
  try{
    const s=await getDoc(doc(firestore,"users",user.uid));if(!s.exists()){await signOut(auth);showLoginError("Esta conta ainda não possui solicitação de acesso.");return}
    const d={uid:user.uid,email:user.email,...s.data()};
    if(d.status==="PENDENTE"){profile=null;showPendingAccess(d,"PENDENTE");return}
    if(d.status==="BLOQUEADO"){profile=null;showPendingAccess(d,"BLOQUEADO");return}
    if(d.status!=="ATIVO"){await signOut(auth);showLoginError("Sua conta não está autorizada para acessar o sistema.");return}
    profile=d;
  }catch(err){console.error(err);await signOut(auth);showLoginError("Não foi possível validar seu acesso ao sistema.");return}
  $("accessPendingScreen").classList.add("hidden");updateProfileUI();applyPermissions();startPresence();
  try{await loadAll();$("loginScreen").classList.add("hidden");setAuthenticatedUi(true);handleEmployeeDeepLink();handleStartupView()}catch(err){console.error("Falha ao carregar dados:",err);$("loginScreen").classList.add("hidden");setAuthenticatedUi(true);showToast("Você continua conectado. Alguns dados não puderam ser atualizados agora.","error")}
});
function updateProfileUI(){
  if(!profile)return;
  const displayName=profile.name||auth.currentUser?.email||"Usuário";
  $("userName").textContent=displayName;$("userRole").textContent=humanRole(profile.role);$("userPlant").textContent=profile.plantId==="TODAS"?"Todas as usinas":(plantName(profile.plantId)||"Usina não definida");
  if($("topUserName"))$("topUserName").textContent=displayName;if($("topUserRole"))$("topUserRole").textContent=`${humanRole(profile.role)}${profile.plantId&&profile.plantId!=="TODAS"?` • ${plantName(profile.plantId)}`:""}`;
  const initials=displayName.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  if($("topUserAvatar")){if(profile.photoUrl)$("topUserAvatar").innerHTML=`<img src="${profile.photoUrl}" alt="">`;else $("topUserAvatar").textContent=initials||"U"}
}
function applyPermissions(){document.querySelector('[data-view="usuarios"]').style.display=isOwner()?"":"none";document.querySelector('[data-view="auditoria"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="configuracoes"]').style.display=isAdmin()?"":"none";document.querySelector('[data-view="movimentacoes"]').style.display=isSSMA()?"":"none";document.querySelector('[data-view="colaboradores"]').style.display=canView()?"":"none";document.querySelector('[data-view="leitorqr"]').style.display=canView()?"":"none";document.querySelector('[data-view="epis"]').style.display=canView()?"":"none";document.querySelectorAll(".action-ssma").forEach(b=>b.style.display=isSSMA()?"":"none");if($("bottomMovBtn"))$("bottomMovBtn").style.display=isSSMA()?"":"none"}

async function readCollection(name){const snap=await getDocs(collection(firestore,name));return snap.docs.map(d=>({id:d.id,...d.data()}))}
function assignedPlantId(){
  if(!profile)return "";
  if(isAdmin()||profile.plantId==="TODAS")return "";
  return profile.plantId||"";
}
async function readPlantsForProfile(){
  const pid=assignedPlantId();
  if(!pid)return readCollection("plants");
  const snap=await getDoc(doc(firestore,"plants",pid));
  return snap.exists()?[{id:snap.id,...snap.data()}]:[];
}
async function readScopedCollection(name){
  const pid=assignedPlantId();
  if(!pid)return readCollection(name);
  const snap=await getDocs(query(collection(firestore,name),where("plantId","==",pid)));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
function enforceAssignedPlant(){
  const pid=assignedPlantId();
  if(!pid)return;
  dashboardPlantId=pid;
}

function sixMonthCutoff(){
  const d=new Date();d.setHours(0,0,0,0);d.setMonth(d.getMonth()-6);return d;
}
async function readRecentMovements(){
  const cutoff=sixMonthCutoff(),pid=assignedPlantId();
  if(pid){
    const snap=await getDocs(query(collection(firestore,"movements"),where("plantId","==",pid)));
    return snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>new Date(fmtRaw(m.date))>=cutoff).sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).slice(0,1500);
  }
  const snap=await getDocs(query(collection(firestore,"movements"),where("date",">=",cutoff),orderBy("date","desc"),limit(1500)));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function readArchivedMovements(){
  const cutoff=sixMonthCutoff(),pid=assignedPlantId();
  if(pid){
    const snap=await getDocs(query(collection(firestore,"movements"),where("plantId","==",pid)));
    return snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>new Date(fmtRaw(m.date))<cutoff).sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)));
  }
  const snap=await getDocs(query(collection(firestore,"movements"),where("date","<",cutoff),orderBy("date","desc")));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
function allLoadedMovements(){return movementArchiveLoaded?[...db.movements,...db.archivedMovements]:db.movements}
async function ensureArchivedMovements(showMessage=true){
  if(movementArchiveLoaded)return db.archivedMovements;
  if(showMessage)showToast("Carregando histórico anterior...");
  try{
    db.archivedMovements=await readArchivedMovements();movementArchiveLoaded=true;
    if(showMessage)showToast(`${db.archivedMovements.length} registro(s) histórico(s) carregado(s).`);
    return db.archivedMovements;
  }catch(err){console.error("Histórico:",err);showToast("Não foi possível carregar o histórico anterior.","error");return []}
}
async function readSettings(){const snap=await getDoc(doc(firestore,"settings","company"));return snap.exists()?snap.data():{}}
async function loadAll(){
  const tasks=[readPlantsForProfile(),readScopedCollection("employees"),readScopedCollection("epis"),readRecentMovements(),readSettings()];
  if(isOwner())tasks.push(readCollection("users"));
  const res=await Promise.all(tasks);
  db.plants=res[0];db.employees=res[1];db.epis=res[2];db.movements=res[3];db.settings=res[4]||{};db.users=isOwner()?res[5]:[];
  pendingLogoDataUrl=db.settings.logoDataUrl||null;enforceAssignedPlant();applyBranding();updateProfileUI();refresh();startOwnerUsersRefresh();
}
async function refreshOwnerUsers(){if(!isOwner())return;try{db.users=await readCollection("users");renderUsers();renderNotifications();renderPendingUsersBadge()}catch(err){console.debug("Atualização de usuários:",err)}}
function startOwnerUsersRefresh(){
  if(ownerUsersRefreshTimer){clearInterval(ownerUsersRefreshTimer);ownerUsersRefreshTimer=null}
  if(ownerUsersUnsubscribe){ownerUsersUnsubscribe();ownerUsersUnsubscribe=null}
  if(!isOwner())return;
  ownerUsersUnsubscribe=onSnapshot(collection(firestore,"users"),snap=>{
    db.users=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderUsers();renderPendingUsersBadge();renderNotifications();
  },err=>{console.debug("Usuários em tempo real:",err);refreshOwnerUsers()});
}
function renderPendingUsersBadge(){const count=isOwner()?db.users.filter(u=>u.status==="PENDENTE").length:0,b=$("pendingUsersBadge");if(b){b.textContent=count;b.classList.toggle("hidden",!count)}if($("pendingUsersCount"))$("pendingUsersCount").textContent=count;if($("activeUsersCount"))$("activeUsersCount").textContent=db.users.filter(u=>u.status==="ATIVO").length;if($("blockedUsersCount"))$("blockedUsersCount").textContent=db.users.filter(u=>u.status==="BLOQUEADO").length;if($("allUsersCount"))$("allUsersCount").textContent=db.users.length}
async function ensureAuditLoaded(force=false){
  if(!isAdmin()||auditLoading||(!force&&auditLoaded))return;
  auditLoading=true;
  try{db.audit=await readCollection("auditLogs");auditLoaded=true;renderAudit()}
  catch(err){console.error("Auditoria:",err);showToast("Não foi possível atualizar a auditoria.","error")}
  finally{auditLoading=false}
}
async function reloadOperationalData(){
  const [epis,movements]=await Promise.all([readScopedCollection("epis"),readRecentMovements()]);
  db.epis=epis;db.movements=movements;if(movementArchiveLoaded){db.archivedMovements=[];movementArchiveLoaded=false;movementArchiveMode=false}refresh();
}

function navTo(view){
  if(view!=="leitorqr")stopQrScanner();
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $(view).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const t={dashboard:["Painel geral","Indicadores do controle de EPIs."],movimentacoes:["Entregas e Devoluções","Registre e acompanhe movimentações."],colaboradores:["Colaboradores","Cadastro e histórico dos colaboradores."],leitorqr:["Leitor de QR","Abra a ficha do colaborador pelo código QR."],epis:["Catálogo de EPIs","Controle de EPIs separado por usina."],relatorios:["Relatórios","Gere relatórios conforme os filtros selecionados."],usuarios:["Usuários e perfis","Gerencie nomes e acessos do sistema."],auditoria:["Auditoria","Rastreabilidade das ações realizadas."],configuracoes:["Configurações","Empresa, logo e cadastro das usinas."]};
  $("pageTitle").textContent=t[view][0];$("pageSubtitle").textContent=t[view][1];
  if($("dashboardPlantWrap"))$("dashboardPlantWrap").style.display=view==="dashboard"?"":"none";
  
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
  renderStockByPlant();renderTopEpis(scopedMoves);renderDashboardAttention();renderStockForecast();renderNotifications();renderMenuBadges();
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


function renderStockForecast(){
  const target=$("stockForecastGrid");if(!target)return;
  const plant=dashboardPlantId;
  const rows=db.epis.filter(p=>!plant||p.plantId===plant).map(p=>({p,stats:epiConsumptionStats(p.id)}))
    .sort((a,b)=>({critical:0,warning:1,normal:2}[a.stats.forecast]-({critical:0,warning:1,normal:2}[b.stats.forecast]) || (a.stats.autonomy??999)-(b.stats.autonomy??999)))
    .slice(0,8);
  target.innerHTML=rows.map(({p,stats})=>`<article class="forecast-card forecast-${stats.forecast}">
    <div class="forecast-card-head"><div><span>${esc(plantName(p.plantId))}</span><strong>${esc(p.name)}</strong></div><i class="forecast-dot"></i></div>
    <div class="forecast-metrics">
      <div><span>Estoque</span><b>${stockQty(p)}</b></div>
      <div><span>Consumo médio</span><b>${fmtMonthly(stats.monthly)}/mês</b></div>
      <div><span>Autonomia</span><b>${fmtAutonomy(stats.autonomy)}</b></div>
    </div>
    <div class="forecast-footer"><span>${stats.forecast==="critical"?"Reposição prioritária":stats.forecast==="warning"?"Planejar reposição":"Estoque confortável"}</span><button onclick="goToEpi('${p.plantId}')">Abrir EPI</button></div>
  </article>`).join("")||'<div class="empty-state">Nenhum EPI disponível para análise.</div>';
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
function movementSourceRows(){return movementArchiveMode?db.archivedMovements:db.movements}
function resetMovementPage(){movementPage=1;renderMovements()}window.resetMovementPage=resetMovementPage;
function changeMovementPage(delta){movementPage=Math.max(1,movementPage+delta);renderMovements()}window.changeMovementPage=changeMovementPage;
async function toggleMovementArchive(){
  if(!movementArchiveMode){await ensureArchivedMovements();movementArchiveMode=true}
  else movementArchiveMode=false;
  movementPage=1;renderMovements();
}
window.toggleMovementArchive=toggleMovementArchive;
function renderMovements(){
  const q=($("movSearch")?.value||"").toLowerCase(),type=$("movType")?.value||"",sig=$("movSignature")?.value||"";
  const filtered=[...movementSourceRows()].sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))).filter(x=>(!type||x.type===type)&&(!sig||(x.signatureStatus||"PENDENTE")===sig)&&(((emp(x.employeeId)?.name||"").toLowerCase().includes(q))||((epi(x.epiId)?.name||"").toLowerCase().includes(q))));
  const total=filtered.length,totalPages=Math.max(1,Math.ceil(total/MOVEMENT_PAGE_SIZE));if(movementPage>totalPages)movementPage=totalPages;
  const from=(movementPage-1)*MOVEMENT_PAGE_SIZE,rows=filtered.slice(from,from+MOVEMENT_PAGE_SIZE);
  $("movementsTable").innerHTML=rows.map(x=>`<tr><td>${fmtDate(x.date)}</td><td><span class="status ${x.type==="Entrega"?"info":"ok"}">${esc(x.type)}</span></td><td>${esc(emp(x.employeeId)?.name||"-")}</td><td>${esc(plantName(x.plantId))}</td><td>${esc(epi(x.epiId)?.name||"-")}</td><td>${x.qty||0}</td><td>${esc(x.size||"-")}</td><td>${esc(returnText(x))}</td><td><span class="status ${sigClass(x.signatureStatus)}">${sigLabel(x.signatureStatus)}</span></td><td class="obs-cell">${esc(x.obs||"-")}</td><td class="action-cell">${isSSMA()?`<button class="table-action" onclick="openMovementEdit('${x.id}')">Editar</button><button class="table-action" onclick="openSignatureModal('${x.id}','${x.signatureStatus||"PENDENTE"}')">Assinatura</button>`:""}${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeMovement('${x.id}')">Remover</button>`:""}</td></tr>`).join("")||'<tr><td colspan="11" class="empty-state">Nenhum registro encontrado neste período.</td></tr>';
  if($("movementPageInfo"))$("movementPageInfo").textContent=total?`${from+1}–${Math.min(from+MOVEMENT_PAGE_SIZE,total)} de ${total} registro(s) • página ${movementPage}/${totalPages}`:"0 registros";
  if($("movementPrevBtn"))$("movementPrevBtn").disabled=movementPage<=1;
  if($("movementNextBtn"))$("movementNextBtn").disabled=movementPage>=totalPages;
  if($("movementPeriodLabel"))$("movementPeriodLabel").textContent=movementArchiveMode?"Arquivo histórico — registros anteriores aos últimos 6 meses.":"Período atual — últimos 6 meses.";
  if($("movementArchiveBtn"))$("movementArchiveBtn").textContent=movementArchiveMode?"Voltar aos últimos 6 meses":"Consultar histórico anterior";
  if($("movementArchiveInfo")){$("movementArchiveInfo").classList.toggle("hidden",!movementArchiveMode);$("movementArchiveInfo").textContent=movementArchiveMode?`Histórico preservado no banco: ${db.archivedMovements.length} registro(s) anterior(es) ao período atual.`:""}
}

function setEmployeeView(mode){employeeView=mode;$("employeeCardsBtn").classList.toggle("active",mode==="cards");$("employeeListBtn").classList.toggle("active",mode==="list");$("employeeCards").classList.toggle("hidden",mode!=="cards");$("employeeListWrap").classList.toggle("hidden",mode!=="list")}
window.setEmployeeView=setEmployeeView;
function renderEmployees(){
  const q=($("empSearch")?.value||"").toLowerCase(),list=db.employees.filter(e=>(e.name||"").toLowerCase().includes(q)||(e.reg||"").toLowerCase().includes(q));
  $("employeeCards").innerHTML=list.map(e=>{const moves=db.movements.filter(m=>m.employeeId===e.id),delivered=moves.filter(m=>m.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),pending=moves.filter(m=>(m.signatureStatus||"PENDENTE")!=="ASSINADO").length,initials=(e.name||"?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();return `<article class="entity-card employee-card" onclick="openEmployeeHistory('${e.id}')"><div class="entity-card-head"><div class="employee-avatar">${esc(initials)}</div><div><h4>${esc(e.name)}</h4><p>${esc(e.role||"-")} • ${esc(plantName(e.plantId))}</p></div></div><div class="entity-card-meta"><span>Matrícula <strong>${esc(e.reg||"-")}</strong></span><span>EPIs entregues <strong>${delivered}</strong></span></div><div class="entity-card-footer"><span class="clean-status ${pending?"has-pending":"clear"}"><i>${pending?"!":"✓"}</i>${pending?`${pending} pendência(s)`:"Situação regular"}</span><div class="card-actions" onclick="event.stopPropagation()">${isSSMA()?`<button class="table-action" onclick="openEmployeeEdit('${e.id}')">Editar</button>`:""}<button class="table-action" onclick="openEmployeeHistory('${e.id}')">Ficha</button>${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEmployee('${e.id}')">Remover</button>`:""}</div></div></article>`}).join("")||'<div class="empty-state">Nenhum colaborador cadastrado.</div>';
  $("employeesTable").innerHTML=list.map(e=>{const last=[...db.movements].filter(m=>m.employeeId===e.id&&m.type==="Entrega").sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)))[0];return `<tr><td><button class="employee-name-link" onclick="openEmployeeHistory('${e.id}')">${esc(e.name)}</button></td><td>${esc(e.reg||"-")}</td><td>${esc(e.role||"-")}</td><td>${esc(plantName(e.plantId))}</td><td><span class="status ok">${esc(e.status||"Ativo")}</span></td><td>${last?fmtDate(last.date):"Sem registro"}</td><td class="action-cell">${isSSMA()?`<button class="table-action" onclick="openEmployeeEdit('${e.id}')">Editar</button>`:""}<button class="table-action" onclick="openEmployeeHistory('${e.id}')">Histórico</button>${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEmployee('${e.id}')">Remover</button>`:""}</td></tr>`}).join("")||'<tr><td colspan="7" class="empty-state">Nenhum colaborador cadastrado.</td></tr>';
  setEmployeeView(employeeView);
}
function employeeDeepLink(id){return `${location.origin}${location.pathname}?employee=${encodeURIComponent(id)}`}
function employeeQrUrl(id,size=800){return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=24&format=png&data=${encodeURIComponent(employeeDeepLink(id))}`}
function safeFilename(v){return String(v||"colaborador").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase()}
async function downloadEmployeeQr(id){
  const e=emp(id);if(!e)return;
  const url=employeeQrUrl(id,1000);
  try{
    showToast("Preparando QR Code...");
    const res=await fetch(url,{cache:"no-store"});
    if(!res.ok)throw new Error("QR_DOWNLOAD");
    const blob=await res.blob(),objectUrl=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=objectUrl;a.download=`qr-epi-${safeFilename(e.name)}.png`;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(objectUrl),2000);
    showToast("QR Code baixado em PNG.");
  }catch(err){
    console.error(err);
    const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener";a.click();
    showToast("O QR foi aberto em alta resolução. Salve a imagem pelo navegador.","error");
  }
}
window.downloadEmployeeQr=downloadEmployeeQr;
function printEmployeeQr(id){
  const e=emp(id);if(!e)return;
  const popup=window.open("","_blank");if(!popup){userAlert("O navegador bloqueou a janela de impressão.");return}
  const qr=employeeQrUrl(id,1000);
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR EPI - ${esc(e.name)}</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,sans-serif;color:#111;display:grid;place-items:center;padding:30px}.label{width:82mm;border:1px solid #bbb;border-radius:12px;padding:10mm;text-align:center}.logo{max-width:45mm;max-height:16mm;margin-bottom:5mm}.qr{width:55mm;height:55mm}.name{font-size:17px;font-weight:700;margin-top:5mm}.meta{font-size:11px;color:#555;margin-top:2mm}.hint{font-size:9px;color:#777;margin-top:5mm;border-top:1px solid #ddd;padding-top:4mm}</style></head><body><div class="label">${db.settings.logoDataUrl?`<img class="logo" src="${db.settings.logoDataUrl}">`:""}<div><img class="qr" src="${qr}"></div><div class="name">${esc(e.name)}</div><div class="meta">${esc(e.role||"-")} • ${esc(plantName(e.plantId))}</div><div class="hint">Escaneie para abrir a ficha de EPI do colaborador</div></div><script>window.onload=()=>setTimeout(()=>window.print(),600)<\/script></body></html>`);
  popup.document.close();
}
window.printEmployeeQr=printEmployeeQr;
function openEmployeeHistory(id){
  const e=emp(id);if(!e)return;
  const moves=[...db.movements].filter(m=>m.employeeId===id).sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))),delivered=moves.filter(m=>m.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),returned=moves.filter(m=>m.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0),pending=moves.filter(m=>(m.signatureStatus||"PENDENTE")!=="ASSINADO").length;
  $("employeeHistoryTitle").textContent=e.name;$("employeeHistoryMeta").textContent=`${e.role||"Função não informada"} • ${plantName(e.plantId)} • Matrícula ${e.reg||"-"}`;
  const initials=(e.name||"EP").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase();$("employeeHistoryAvatar").textContent=initials;$("employeeHistoryNameHero").textContent=e.name;$("employeeHistoryRoleHero").textContent=`${e.role||"Função não informada"} • ${plantName(e.plantId)}`;
  const deepLink=employeeDeepLink(e.id);$("employeeQrImage").src=employeeQrUrl(e.id,220);
  $("employeeHistorySummary").innerHTML=`<div class="history-stat"><span>Entregue</span><strong>${delivered}</strong></div><div class="history-stat"><span>Devolvido</span><strong>${returned}</strong></div><div class="history-stat"><span>Registros</span><strong>${moves.length}</strong></div><div class="history-stat ${pending?"history-stat-alert":""}"><span>Assinaturas pendentes</span><strong>${pending}</strong></div><div class="history-period-note">Ficha rápida: últimos 6 meses. O histórico anterior permanece disponível em Entregas / Devoluções e Relatórios.</div>`;
  $("employeeQuickDelivery").onclick=()=>openMovementForEmployee(id,"Entrega");$("employeeQuickReturn").onclick=()=>openMovementForEmployee(id,"Devolução");$("employeePrintSheet").onclick=()=>printEmployeeSheet(id);$("employeeDownloadQr").onclick=()=>downloadEmployeeQr(id);$("employeePrintQr").onclick=()=>printEmployeeQr(id);
  $("employeeHistoryTable").innerHTML=moves.map(m=>`<tr><td>${fmtDate(m.date)}</td><td><span class="status ${m.type==="Entrega"?"info":"ok"}">${esc(m.type)}</span></td><td>${esc(epi(m.epiId)?.name||"-")}</td><td>${m.qty||0}</td><td>${esc(m.size||"-")}</td><td>${esc(returnText(m))}</td><td><span class="status ${sigClass(m.signatureStatus)}">${sigLabel(m.signatureStatus)}</span></td><td>${esc(m.obs||"-")}</td></tr>`).join("")||'<tr><td colspan="8" class="empty-state">Nenhuma entrega ou devolução registrada.</td></tr>';
  $("employeeHistoryModal").classList.add("open");
}
window.openEmployeeHistory=openEmployeeHistory;
function openMovementForEmployee(id,type){closeModal("employeeHistoryModal");openMovementModal();selectMovementEmployee(id);$("mType").value=type;$("mType").dispatchEvent(new Event("change"))}
window.openMovementForEmployee=openMovementForEmployee;
function printEmployeeSheet(id){
  const e=emp(id);if(!e)return;const moves=[...db.movements].filter(m=>m.employeeId===id).sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date))),popup=window.open("","_blank");if(!popup){userAlert("O navegador bloqueou a abertura da ficha para impressão.");return}
  const qr=employeeQrUrl(id,500);
  const rows=moves.map(m=>`<tr><td>${esc(fmtDate(m.date))}</td><td>${esc(m.type)}</td><td>${esc(epi(m.epiId)?.name||"-")}</td><td>${m.qty||0}</td><td>${esc(m.size||"-")}</td><td>${esc(sigLabel(m.signatureStatus))}</td><td>${esc(m.obs||"-")}</td></tr>`).join("");
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ficha de EPI - ${esc(e.name)}</title><style>body{font-family:Arial;color:#111;padding:28px}.head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #1f5135;padding-bottom:14px}.brand{display:flex;gap:14px;align-items:center}.brand img.logo{max-width:85px;max-height:60px}.qr{width:110px;height:110px}.meta{margin:18px 0;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.meta div{border:1px solid #ddd;padding:9px;border-radius:6px}.meta span{font-size:9px;color:#666;display:block}.meta strong{font-size:12px}table{width:100%;border-collapse:collapse;font-size:9px}th,td{border:1px solid #bbb;padding:6px;text-align:left}th{background:#eef5f0}.sign{margin-top:55px;display:grid;grid-template-columns:1fr 1fr;gap:70px}.line{border-top:1px solid #222;text-align:center;padding-top:5px;font-size:10px}.foot{margin-top:18px;font-size:9px;color:#777}</style></head><body><div class="head"><div class="brand">${db.settings.logoDataUrl?`<img class="logo" src="${db.settings.logoDataUrl}">`:""}<div><h2>${esc(db.settings.companyName||"Empresa")}</h2><div>Ficha individual de entrega e devolução de EPIs</div></div></div><img class="qr" src="${qr}"></div><div class="meta"><div><span>COLABORADOR</span><strong>${esc(e.name)}</strong></div><div><span>FUNÇÃO</span><strong>${esc(e.role||"-")}</strong></div><div><span>USINA</span><strong>${esc(plantName(e.plantId))}</strong></div><div><span>MATRÍCULA</span><strong>${esc(e.reg||"-")}</strong></div><div><span>ADMISSÃO</span><strong>${esc(e.admission||"-")}</strong></div><div><span>STATUS</span><strong>${esc(e.status||"Ativo")}</strong></div></div><table><thead><tr><th>Data</th><th>Tipo</th><th>EPI</th><th>Qtd.</th><th>Tamanho</th><th>Assinatura</th><th>Observações</th></tr></thead><tbody>${rows}</tbody></table><div class="sign"><div class="line">Colaborador</div><div class="line">Responsável pela entrega</div></div><div class="foot">Emitido em ${new Date().toLocaleString("pt-BR")}</div><script>window.onload=()=>setTimeout(()=>window.print(),450)<\/script></body></html>`);popup.document.close();
}
window.printEmployeeSheet=printEmployeeSheet;


function setEpiView(mode){epiView=mode;$("epiCardsBtn").classList.toggle("active",mode==="cards");$("epiListBtn").classList.toggle("active",mode==="list");$("epiCards").classList.toggle("hidden",mode!=="cards");$("epiListWrap").classList.toggle("hidden",mode!=="list")}
window.setEpiView=setEpiView;
function renderEpis(){
  const plantFilter=$("epiPlantFilter")?.value||"",list=[...db.epis].filter(p=>!plantFilter||p.plantId===plantFilter).sort((a,b)=>(plantName(a.plantId)+a.name).localeCompare(plantName(b.plantId)+b.name));
  $("epiCards").innerHTML=list.map(p=>{
    const state=epiStockState(p),qty=stockQty(p),min=epiMin(p),target=Math.max(min*2,qty,1),pct=Math.max(0,Math.min(100,Math.round((qty/target)*100))),stats=epiConsumptionStats(p.id);
    return `<article class="entity-card epi-card">
      <div class="epi-card-top"><div><span class="eyebrow">${esc(plantName(p.plantId))}</span><h4>${esc(p.name||"-")}</h4><p>C.A. ${esc(p.ca||"-")} • ${esc(p.unit||"-")}</p></div><span class="stock-state-chip stock-${state.key}"><i></i>${state.label}</span></div>
      <div class="epi-stock-row"><strong>${qty}</strong><span>em estoque</span><small>Mínimo ${min}</small></div>
      <div class="stock-progress stock-progress-${state.key}"><span style="width:${pct}%"></span></div>
      <div class="epi-intelligence-row">
        <div><span>Consumo médio</span><strong>${fmtMonthly(stats.monthly)}/mês</strong></div>
        <div><span>Autonomia</span><strong>${fmtAutonomy(stats.autonomy)}</strong></div>
      </div>
      <div class="epi-sizes">Tamanhos <strong>${esc((p.sizes||[]).join(", ")||"Único")}</strong></div>
      <div class="entity-card-footer"><span class="forecast-mini forecast-${stats.forecast}">${stats.forecast==="critical"?"Reposição prioritária":stats.forecast==="warning"?"Atenção":"Normal"}</span><div class="card-actions">${isSSMA()?`<button class="table-action" onclick="openEpiModal('${p.id}')">Editar / Reabastecer</button>`:""}${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEpi('${p.id}')">Remover</button>`:""}</div></div>
    </article>`
  }).join("")||'<div class="empty-state">Nenhum EPI cadastrado para este filtro.</div>';
  $("episTable").innerHTML=list.map(p=>{const s=epiStockState(p),stats=epiConsumptionStats(p.id);return `<tr><td>${esc(plantName(p.plantId))}</td><td>${esc(p.name||"-")}</td><td>${esc(p.ca||"-")}</td><td>${esc(p.unit||"-")}</td><td>${esc((p.sizes||[]).join(", ")||"Único")}</td><td>${stockQty(p)}</td><td>${epiMin(p)}</td><td>${fmtMonthly(stats.monthly)}/mês</td><td>${fmtAutonomy(stats.autonomy)}</td><td><span class="stock-state-chip stock-${s.key}"><i></i>${s.label}</span></td><td class="action-cell">${isSSMA()?`<button class="table-action" onclick="openEpiModal('${p.id}')">Editar</button>`:""}${canDeleteOperational()?`<button class="table-action danger-btn" onclick="removeEpi('${p.id}')">Remover</button>`:""}</td></tr>`}).join("")||'<tr><td colspan="11" class="empty-state">Nenhum EPI cadastrado.</td></tr>';
  setEpiView(epiView);
}
function renderPlants(){$("plantsGrid").innerHTML=db.plants.map(p=>`<div class="plant-card"><strong>${esc(p.name)}</strong>${canDeleteOperational()?`<button class="mini-remove" onclick="removePlant('${p.id}')">Remover</button>`:""}</div>`).join("")||'<div class="empty-state">Nenhuma usina cadastrada.</div>'}
function roleClass(v){return ({PROPRIETARIO:"role-owner",ADMINISTRADOR:"role-admin",SSMA:"role-ssma",VISUALIZADOR:"role-viewer"}[v]||"role-default")}
function userAvatarHtml(u,cls="user-avatar"){const initials=(u.name||u.email||"?").split(/[\s@]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();return u.photoUrl?`<div class="${cls}"><img src="${u.photoUrl}" alt=""></div>`:`<div class="${cls} avatar-initials">${esc(initials)}</div>`}
function setUserView(mode){userView=mode;$("userCardsBtn").classList.toggle("active",mode==="cards");$("userListBtn").classList.toggle("active",mode==="list");$("userCards").classList.toggle("hidden",mode!=="cards");$("userListWrap").classList.toggle("hidden",mode!=="list")}
window.setUserView=setUserView;
function setUserStatusFilter(status){userStatusFilter=status||"";if($("userStatusFilter"))$("userStatusFilter").value=userStatusFilter;renderUsers()}window.setUserStatusFilter=setUserStatusFilter;
function userStatusClass(s){return s==="PENDENTE"?"pending":s==="BLOQUEADO"?"blocked":"active"}function userStatusLabel(s){return s==="PENDENTE"?"Aguardando aprovação":s==="BLOQUEADO"?"Bloqueado":"Ativo"}
function renderUsers(){
  if(!$("usersTable")||!$("userCards")||!isOwner())return;renderPendingUsersBadge();
  const q=($("userSearch")?.value||"").trim().toLowerCase(),status=$("userStatusFilter")?.value||userStatusFilter||"",list=db.users.filter(u=>(!status||u.status===status)&&(!q||(u.name||"").toLowerCase().includes(q)||(u.email||"").toLowerCase().includes(q))).sort((a,b)=>(a.status==="PENDENTE"?0:a.status==="BLOQUEADO"?2:1)-(b.status==="PENDENTE"?0:b.status==="BLOQUEADO"?2:1)||(a.name||a.email||"").localeCompare(b.name||b.email||""));
  $("userCards").innerHTML=list.map(u=>{const presence=userPresenceState(u),sc=userStatusClass(u.status),role=u.role?humanRole(u.role):"Função não definida",plant=u.plantId?(u.plantId==="TODAS"?"Todas as usinas":plantName(u.plantId)):"Usina não definida";return `<article class="entity-card user-card user-status-${sc}"><div class="user-card-head">${userAvatarHtml(u)}<div><h4>${esc(u.name||u.email||"-")}</h4><p>${esc(u.email||"-")}</p></div><span class="access-status-chip ${sc}">${userStatusLabel(u.status)}</span></div><div class="user-role-line"><span class="role-chip ${u.role?roleClass(u.role):"role-default"}">${esc(role)}</span><span>${esc(plant)}</span></div>${u.status==="ATIVO"?`<div class="user-presence-line"><span class="presence-dot ${presence.key}"></span><div><strong>${presence.label}</strong><small>${presence.detail}</small></div></div>`:`<div class="user-request-info"><span>Solicitado em</span><strong>${u.requestedAt?fmtDate(u.requestedAt):u.createdAt?fmtDate(u.createdAt):"-"}</strong></div>`}<div class="entity-card-footer"><span></span><div class="card-actions user-access-actions">${u.status==="PENDENTE"?`<button class="table-action approve-btn" onclick="openUserApproval('${u.id}')">Aprovar acesso</button>`:""}${u.status==="ATIVO"?`<button class="table-action" onclick="openUserEdit('${u.id}')">Editar</button>${u.id!==auth.currentUser.uid?`<button class="table-action block-btn" onclick="blockUser('${u.id}')">Bloquear</button>`:""}`:""}${u.status==="BLOQUEADO"?`<button class="table-action approve-btn" onclick="openUserApproval('${u.id}',true)">Reativar</button>`:""}${u.id!==auth.currentUser.uid?`<button class="table-action danger-btn" onclick="removeUser('${u.id}')">Remover acesso</button>`:""}</div></div></article>`}).join("")||'<div class="empty-state">Nenhum usuário encontrado para este filtro.</div>';
  $("usersTable").innerHTML=list.map(u=>{const last=fmtRaw(u.lastSeenAt),sc=userStatusClass(u.status),role=u.role?humanRole(u.role):"-",plant=u.plantId?(u.plantId==="TODAS"?"Todas as usinas":plantName(u.plantId)):"-";return `<tr><td>${userAvatarHtml(u,"user-avatar small")}</td><td>${esc(u.name||"-")}</td><td>${esc(u.email||"-")}</td><td><span class="access-status-chip ${sc}">${userStatusLabel(u.status)}</span></td><td>${esc(role)}</td><td>${esc(plant)}</td><td>${last?fmtDate(last):"Sem registro"}</td><td class="action-cell">${u.status==="PENDENTE"?`<button class="table-action approve-btn" onclick="openUserApproval('${u.id}')">Aprovar</button>`:""}${u.status==="ATIVO"?`<button class="table-action" onclick="openUserEdit('${u.id}')">Editar</button>${u.id!==auth.currentUser.uid?`<button class="table-action block-btn" onclick="blockUser('${u.id}')">Bloquear</button>`:""}`:""}${u.status==="BLOQUEADO"?`<button class="table-action approve-btn" onclick="openUserApproval('${u.id}',true)">Reativar</button>`:""}${u.id!==auth.currentUser.uid?`<button class="table-action danger-btn" onclick="removeUser('${u.id}')">Remover</button>`:""}</td></tr>`}).join("")||'<tr><td colspan="8" class="empty-state">Nenhum usuário encontrado.</td></tr>';setUserView(userView);
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
  if($("settingsVersion"))$("settingsVersion").textContent=`v${APP_VERSION}`;updatePwaInstallUI();if($("settingsConnection"))$("settingsConnection").textContent=navigator.onLine?"Online":"Offline";if($("settingsLastCheck"))$("settingsLastCheck").textContent=new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
}

function populateDashboardFilters(){
  const dashboard=$("dashboardPlantFilter"),epiFilter=$("epiPlantFilter");if(!dashboard)return;
  const pid=assignedPlantId();
  if(pid){
    const p=db.plants.find(x=>x.id===pid),label=p?.name||"Usina atribuída",options=`<option value="${pid}">${esc(label)}</option>`;
    dashboard.innerHTML=options;dashboard.value=pid;dashboard.disabled=true;dashboardPlantId=pid;
    if(epiFilter){epiFilter.innerHTML=options;epiFilter.value=pid;epiFilter.disabled=true}
    if($("dashboardPlantWrap"))$("dashboardPlantWrap").classList.add("locked-plant");
    return;
  }
  const options='<option value="">Todas as usinas</option>'+db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  const dcur=dashboardPlantId,ecur=epiFilter?.value||"";
  dashboard.disabled=false;dashboard.innerHTML=options;
  if([...dashboard.options].some(o=>o.value===dcur))dashboard.value=dcur;else dashboardPlantId="";
  if(epiFilter){epiFilter.disabled=false;epiFilter.innerHTML=options;if([...epiFilter.options].some(o=>o.value===ecur))epiFilter.value=ecur}
  if($("dashboardPlantWrap"))$("dashboardPlantWrap").classList.remove("locked-plant");
}
if($("dashboardPlantFilter"))$("dashboardPlantFilter").addEventListener("change",()=>{dashboardPlantId=assignedPlantId()||$("dashboardPlantFilter").value;renderDashboard()});
function populateSelects(){
  const options=db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join(""),pid=assignedPlantId();
  $("ePlant").innerHTML=options;$("pPlant").innerHTML=options;
  if(pid){$("ePlant").value=pid;$("pPlant").value=pid;$("ePlant").disabled=true;$("pPlant").disabled=true}
  else{$("ePlant").disabled=false;$("pPlant").disabled=false}
}
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
function openMovementEdit(id){const m=allLoadedMovements().find(x=>x.id===id);if(!m)return;populateSelects();resetMovementForm();const e=emp(m.employeeId);$("mMovementId").value=id;$("movementModalTitle").textContent="Editar entrega / devolução";$("movementSaveButton").textContent="Salvar alterações";$("mType").value=m.type||"Entrega";if(e)selectMovementEmployee(e.id);$("mEpi").value=m.epiId||"";updateMovementSizes();$("mSize").value=m.size||$("mSize").value;$("mQty").value=m.qty||1;const d=fmtRaw(m.date);if(d){const local=new Date(new Date(d).getTime()-new Date().getTimezoneOffset()*60000);$("mDate").value=local.toISOString().slice(0,16)}$("mSignature").value=m.signatureStatus||"PENDENTE";$("mReturnDisposition").value=m.returnDisposition||"REESTOQUE";$("returnDispositionWrap").classList.toggle("hidden",$("mType").value!=="Devolução");$("mObs").value=m.obs||"";$("movementModal").classList.add("open")}
window.openMovementEdit=openMovementEdit;
function openEmployeeModal(){if(!db.plants.length){userAlert("Cadastre uma usina em Configurações antes.");return}populateSelects();$("employeeForm").reset();$("eId").value="";$("employeeModalTitle").textContent="Novo colaborador";$("employeeSaveButton").textContent="Cadastrar";$("employeeModal").classList.add("open")}
window.openEmployeeModal=openEmployeeModal;
function openEmployeeEdit(id){const e=emp(id);if(!e)return;populateSelects();$("eId").value=id;$("eName").value=e.name||"";$("eReg").value=e.reg||"";$("eRole").value=e.role||"";$("ePlant").value=e.plantId||"";$("eAdmission").value=e.admission||"";$("employeeModalTitle").textContent="Editar colaborador";$("employeeSaveButton").textContent="Salvar alterações";$("employeeModal").classList.add("open")}
window.openEmployeeEdit=openEmployeeEdit;
function openEpiModal(id=""){$("epiForm").reset();populateSelects();$("pId").value=id;if(id){const p=epi(id);if(!p)return;$("epiModalTitle").textContent="Editar EPI / Reabastecer";$("epiSaveButton").textContent="Salvar alterações";$("pPlant").value=p.plantId||"";$("pName").value=p.name||"";$("pCA").value=p.ca||"";$("pUnit").value=p.unit||"Unidade";$("pSizes").value=(p.sizes||[]).join(", ");$("pStock").value=stockQty(p);$("pMinStock").value=epiMin(p)}else{$("epiModalTitle").textContent="Novo EPI";$("epiSaveButton").textContent="Cadastrar";$("pStock").value=0;$("pMinStock").value=0}$("epiModal").classList.add("open")}window.openEpiModal=openEpiModal;
function openPlantModal(){$("plantModal").classList.add("open")}window.openPlantModal=openPlantModal;
function openSignatureModal(id,current){$("signatureMovementId").value=id;$("signatureStatus").value=current==="ASSINADO"?"ASSINADO":"PENDENTE";$("signatureModal").classList.add("open")}window.openSignatureModal=openSignatureModal;
function populateApprovalPlants(selected=""){const s=$("approvalPlant");s.innerHTML='<option value="">Selecione a usina</option><option value="TODAS">Todas as usinas</option>'+db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");if(selected)s.value=selected}
function openUserApproval(id,reactivate=false){if(!isOwner())return;const u=db.users.find(x=>x.id===id);if(!u)return;$("approvalUserId").value=id;$("approvalUserName").textContent=u.name||"Usuário";$("approvalUserEmail").textContent=u.email||"-";$("approvalAvatar").textContent=(u.name||u.email||"U").split(/[\s@]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();$("approvalRole").value=u.role&&u.role!=="PROPRIETARIO"?u.role:"";populateApprovalPlants(u.plantId||"");document.querySelector("#userApprovalModal .modal-head h3").textContent=reactivate?"Reativar usuário":"Aprovar usuário";$("userApprovalModal").classList.add("open")}window.openUserApproval=openUserApproval;
$("approvalRole").addEventListener("change",()=>{if($("approvalRole").value==="ADMINISTRADOR"&&!$("approvalPlant").value)$("approvalPlant").value="TODAS"});
$("userApprovalForm").onsubmit=async e=>{e.preventDefault();if(!isOwner())return;const id=$("approvalUserId").value,u=db.users.find(x=>x.id===id),role=$("approvalRole").value,plantId=$("approvalPlant").value;if(!u||!role||!plantId){showToast("Selecione a função e a usina.","error");return}if((role==="SSMA"||role==="VISUALIZADOR")&&plantId==="TODAS"){showToast("SSMA e Visualizador precisam estar vinculados a uma usina específica.","error");return}try{const data={status:"ATIVO",role,plantId,isOwner:false,approvedAt:serverTimestamp(),approvedBy:auth.currentUser.uid,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid};await updateDoc(doc(firestore,"users",id),data);const i=db.users.findIndex(x=>x.id===id);if(i>=0)db.users[i]={...db.users[i],...data,approvedAt:new Date(),updatedAt:new Date()};logAudit("APROVACAO_USUARIO",`${u.name||u.email} • ${humanRole(role)} • ${plantId==="TODAS"?"Todas as usinas":plantName(plantId)}`);closeModal("userApprovalModal");renderUsers();renderNotifications();renderPendingUsersBadge();showToast(`Acesso de ${u.name||u.email} aprovado.`)}catch(err){console.error(err);showToast("Não foi possível aprovar o usuário.","error")}};
async function blockUser(id){if(!isOwner()||id===auth.currentUser.uid)return;const u=db.users.find(x=>x.id===id);if(!u)return;try{await updateDoc(doc(firestore,"users",id),{status:"BLOQUEADO",blockedAt:serverTimestamp(),blockedBy:auth.currentUser.uid,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});u.status="BLOQUEADO";u.blockedAt=new Date();logAudit("BLOQUEIO_USUARIO",u.name||u.email);renderUsers();renderNotifications();showToast(`Acesso de ${u.name||u.email} bloqueado.`)}catch(err){console.error(err);showToast("Não foi possível bloquear o usuário.","error")}}window.blockUser=blockUser;
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

function populateReportFilters(){
  const currentPlant=$("reportPlant").value,pid=assignedPlantId();
  $("reportEmployeeSuggestions").innerHTML=db.employees.map(e=>`<option value="${escAttr(e.name)}"></option>`).join("");
  if(pid){
    $("reportPlant").innerHTML=db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
    $("reportPlant").value=pid;$("reportPlant").disabled=true;
  }else{
    $("reportPlant").disabled=false;$("reportPlant").innerHTML='<option value="">Todas as usinas</option>'+db.plants.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
    if([...$("reportPlant").options].some(o=>o.value===currentPlant))$("reportPlant").value=currentPlant;
  }
  updateReportSummary();
}
function resolveReportEmployee(refresh=true){const value=$("reportEmployeeSearch").value.trim().toLowerCase();const exact=db.employees.find(e=>(e.name||"").trim().toLowerCase()===value);$("reportEmployeeId").value=exact?.id||"";if(exact){$("reportPlant").value=exact.plantId;$("reportPlant").disabled=true}else{$("reportPlant").disabled=!!assignedPlantId();if(assignedPlantId())$("reportPlant").value=assignedPlantId()}if(refresh)updateReportSummary()}
$("reportEmployeeSearch").addEventListener("input",resolveReportEmployee);$("reportPlant").addEventListener("change",updateReportSummary);$("reportFrom").addEventListener("change",()=>{updateReportArchiveHint();updateReportSummary()});$("reportTo").addEventListener("change",()=>{updateReportArchiveHint();updateReportSummary()});
function reportNeedsArchive(){
  const from=$("reportFrom").value?new Date($("reportFrom").value+"T00:00:00"):null;
  return !!(from&&from<sixMonthCutoff());
}
function updateReportArchiveHint(){
  const needs=reportNeedsArchive()&&!movementArchiveLoaded;
  if($("reportArchiveHint"))$("reportArchiveHint").classList.toggle("hidden",!needs);
  if($("reportLoadArchiveBtn"))$("reportLoadArchiveBtn").style.display=needs?"":"none";
}
async function loadReportArchive(){await ensureArchivedMovements();updateReportArchiveHint();updateReportSummary()}window.loadReportArchive=loadReportArchive;
function filteredReportMoves(showAlert=false){
  resolveReportEmployee(false);const typed=$("reportEmployeeSearch").value.trim(),employeeId=$("reportEmployeeId").value,plantId=$("reportPlant").value,from=$("reportFrom").value?new Date($("reportFrom").value+"T00:00:00"):null,to=$("reportTo").value?new Date($("reportTo").value+"T23:59:59"):null;
  if(showAlert&&typed&&!employeeId){userAlert("Selecione um colaborador sugerido pelo sistema ou apague o nome para gerar por usina/período.");return null}
  if(showAlert&&reportNeedsArchive()&&!movementArchiveLoaded){showToast("Carregue o histórico anterior antes de gerar este período.","error");return null}
  return [...allLoadedMovements()].filter(m=>{const d=new Date(fmtRaw(m.date));return(!employeeId||m.employeeId===employeeId)&&(!plantId||m.plantId===plantId)&&(!from||d>=from)&&(!to||d<=to)}).sort((a,b)=>new Date(fmtRaw(a.date))-new Date(fmtRaw(b.date)))
}
function updateReportSummary(){const rows=filteredReportMoves(false)||[];const ent=rows.filter(x=>x.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0),dev=rows.filter(x=>x.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0);$("reportSummary").textContent=`${rows.length} registro(s) encontrado(s) • ${ent} entregue(s) • ${dev} devolvido(s)`}
function clearReportFilters(){$("reportEmployeeSearch").value="";$("reportEmployeeId").value="";$("reportPlant").disabled=!!assignedPlantId();$("reportPlant").value=assignedPlantId()||"";$("reportFrom").value="";$("reportTo").value="";updateReportArchiveHint();updateReportSummary()}window.clearReportFilters=clearReportFilters;
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
  if(isOwner())db.users.filter(u=>u.status==="PENDENTE").forEach(u=>list.push({key:`user-pending:${u.id}:${notificationStamp(u.requestedAt||u.createdAt)}`,type:"warning",title:"Novo usuário aguardando aprovação",text:`${u.name||u.email} • definir função e usina`,action:`navTo(\'usuarios\');setUserStatusFilter(\'PENDENTE\')`,time:notificationStamp(u.requestedAt||u.createdAt)}));
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


function qrEmployeeIdFromValue(value){
  try{
    const url=new URL(value,location.href);
    return url.searchParams.get("employee")||url.searchParams.get("colaborador")||"";
  }catch(_){
    const m=String(value||"").match(/[?&](?:employee|colaborador)=([^&#]+)/i);
    return m?decodeURIComponent(m[1]):"";
  }
}
function openEmployeeFromQrValue(value){
  const id=qrEmployeeIdFromValue(value);
  if(!id){showToast("Este QR não pertence a uma ficha de colaborador do sistema.","error");return false}
  const employee=emp(id);
  if(!employee){showToast("Colaborador não encontrado ou fora da sua usina autorizada.","error");return false}
  stopQrScanner();openEmployeeHistory(id);return true;
}
async function startQrScanner(){
  if(!canView())return;
  if(!navigator.mediaDevices?.getUserMedia){showToast("A câmera não está disponível neste navegador.","error");return}
  if(!("BarcodeDetector" in window)){showToast("Este navegador não possui leitor QR integrado. Use a busca pelo nome abaixo.","error");return}
  stopQrScanner();
  try{
    qrScannerStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false});
    const video=$("qrVideo");video.srcObject=qrScannerStream;await video.play();
    $("qrCameraIdle").classList.add("hidden");$("qrCameraActive").classList.remove("hidden");$("qrScannerStatus").textContent="Procurando QR Code...";
    const detector=new BarcodeDetector({formats:["qr_code"]});
    const scan=async()=>{
      if(!qrScannerStream||qrScannerBusy)return;
      if(video.readyState<2){qrScannerTimer=requestAnimationFrame(scan);return}
      qrScannerBusy=true;
      try{
        const codes=await detector.detect(video);
        if(codes?.length){
          $("qrScannerStatus").textContent="QR encontrado...";
          if(openEmployeeFromQrValue(codes[0].rawValue))return;
        }
      }catch(err){console.debug("Leitor QR:",err)}
      finally{qrScannerBusy=false}
      if(qrScannerStream)qrScannerTimer=requestAnimationFrame(scan);
    };
    qrScannerTimer=requestAnimationFrame(scan);
  }catch(err){
    console.error("Câmera:",err);stopQrScanner();
    showToast(err?.name==="NotAllowedError"?"Permissão da câmera negada. Libere a câmera para este site.":"Não foi possível abrir a câmera.","error");
  }
}
function stopQrScanner(){
  if(qrScannerTimer){cancelAnimationFrame(qrScannerTimer);qrScannerTimer=null}
  if(qrScannerStream){qrScannerStream.getTracks().forEach(t=>t.stop());qrScannerStream=null}
  qrScannerBusy=false;
  const video=$("qrVideo");if(video)video.srcObject=null;
  if($("qrCameraActive"))$("qrCameraActive").classList.add("hidden");
  if($("qrCameraIdle"))$("qrCameraIdle").classList.remove("hidden");
}
window.startQrScanner=startQrScanner;window.stopQrScanner=stopQrScanner;
function renderQrEmployeeSuggestions(){
  const input=$("qrEmployeeSearch"),box=$("qrEmployeeSuggestions");if(!input||!box)return;
  const q=input.value.trim().toLowerCase();
  if(!q){box.innerHTML="";return}
  const rows=db.employees.filter(e=>(e.name||"").toLowerCase().includes(q)).sort((a,b)=>(a.name||"").localeCompare(b.name||"")).slice(0,6);
  box.innerHTML=rows.map(e=>`<button type="button" onclick="openEmployeeHistory('${e.id}');$('qrEmployeeSearch').value='';$('qrEmployeeSuggestions').innerHTML=''"><span class="employee-avatar qr-mini-avatar">${esc((e.name||"?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase())}</span><span><strong>${esc(e.name)}</strong><small>${esc(e.role||"-")} • ${esc(plantName(e.plantId))}</small></span><b>›</b></button>`).join("")||'<div class="qr-no-result">Nenhum colaborador encontrado.</div>';
}
window.renderQrEmployeeSuggestions=renderQrEmployeeSuggestions;
document.addEventListener("visibilitychange",()=>{if(document.visibilityState!=="visible")stopQrScanner()});

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


function handleStartupView(){
  const view=new URLSearchParams(location.search).get("view");
  const allowed=["dashboard","movimentacoes","colaboradores","leitorqr","epis","relatorios","usuarios","auditoria","configuracoes"];
  if(!view||!allowed.includes(view))return;
  if(view==="movimentacoes"&&!isSSMA())return;
  if(view==="usuarios"&&!isOwner())return;
  if(view==="auditoria"&&!isAdmin())return;
  if(view==="configuracoes"&&!isAdmin())return;
  navTo(view);
}
