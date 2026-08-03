import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, addDoc, setDoc, updateDoc,
  serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const $ = id => document.getElementById(id);

let profile = null;
let db = {plants:[], employees:[], epis:[], movements:[], users:[], audit:[], settings:{}};
let pendingLogoDataUrl = null;

const plantName = id => db.plants.find(x=>x.id===id)?.name || "-";
const emp = id => db.employees.find(x=>x.id===id);
const epi = id => db.epis.find(x=>x.id===id);
const fmtRaw = v => v?.toDate ? v.toDate() : v || 0;
const fmtDate = s => {
  if(!s) return "-";
  const d = s?.toDate ? s.toDate() : new Date(s);
  return d.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
};
const role = () => profile?.role || "";
const isOwner = () => role()==="PROPRIETARIO" || profile?.isOwner===true;
const isAdmin = () => isOwner() || role()==="ADMINISTRADOR";
const isSSMA = () => isAdmin() || role()==="SSMA";
const canView = () => isSSMA() || role()==="VISUALIZADOR";
const stockQty = p => Math.max(0, Number(p?.stockQty ?? 0) || 0);
const movementSignature = m => m?.signatureStatus || (m?.signed===true ? "ASSINADO" : "PENDENTE");
const signatureLabel = value => value==="ASSINADO" ? "Assinado" : "Pendente";
const signatureClass = value => value==="ASSINADO" ? "ok" : "danger";

function showLoginError(msg){$("loginError").textContent=msg;$("loginError").classList.add("show")}
function clearLoginError(){$("loginError").classList.remove("show")}

function loadCachedBrand(){
  try{
    const cached=JSON.parse(localStorage.getItem("epiCompanyBrand")||"null");
    if(cached?.logoDataUrl){
      $("loginBrandLogo").src=cached.logoDataUrl;
      $("sidebarBrandLogo").src=cached.logoDataUrl;
    }
  }catch(_){}
}
function cacheBrand(){
  localStorage.setItem("epiCompanyBrand",JSON.stringify({
    companyName: db.settings.companyName || "",
    logoDataUrl: db.settings.logoDataUrl || ""
  }));
}
function applyBranding(){
  const src=db.settings.logoDataUrl || "./logo-symbol.png";
  $("sidebarBrandLogo").src=src;
  $("loginBrandLogo").src=src;
  $("companyLogoPreview").src=src;
  cacheBrand();
}

loadCachedBrand();

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
    if(!snap.exists()) throw new Error("Usuário sem perfil.");
    profile={uid:user.uid,email:user.email,...snap.data()};
    if(profile.status!=="ATIVO") throw new Error("Usuário inativo.");
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
  document.querySelector('[data-view="configuracoes"]').style.display=isAdmin()?"":"none";
  document.querySelector('[data-view="movimentacoes"]').style.display=isSSMA()?"":"none";
  document.querySelector('[data-view="colaboradores"]').style.display=canView()?"":"none";
  document.querySelector('[data-view="epis"]').style.display=canView()?"":"none";
  document.querySelectorAll(".action-ssma").forEach(b=>b.style.display=isSSMA()?"":"none");
}

async function readCollection(name){
  const snap=await getDocs(collection(firestore,name));
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}
async function readSettings(){
  const snap=await getDoc(doc(firestore,"settings","company"));
  return snap.exists()?snap.data():{};
}
async function loadAll(){
  const tasks=[
    readCollection("plants"),
    readCollection("employees"),
    readCollection("epis"),
    readCollection("movements"),
    readSettings()
  ];
  if(isAdmin()){tasks.push(readCollection("users"),readCollection("auditLogs"))}
  const res=await Promise.all(tasks);
  db.plants=res[0];
  db.employees=res[1];
  db.epis=res[2];
  db.movements=res[3];
  db.settings=res[4]||{};
  db.users=isAdmin()?res[5]:[];
  db.audit=isAdmin()?res[6]:[];
  pendingLogoDataUrl=db.settings.logoDataUrl||null;
  applyBranding();
  refresh();
}

function navTo(view){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  $(view).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  const titles={
    dashboard:["Dashboard","Visão geral do controle de EPIs."],
    movimentacoes:["Entregas e Devoluções","Registre entregas, devoluções e acompanhe assinaturas."],
    colaboradores:["Colaboradores","Cadastro e histórico dos colaboradores."],
    epis:["EPIs","Catálogo e quantidade disponível em estoque."],
    relatorios:["Relatórios","Relatórios com identificação da empresa e exportações."],
    usuarios:["Usuários","Perfis e permissões de acesso."],
    auditoria:["Auditoria","Rastreabilidade das ações realizadas."],
    configuracoes:["Configurações","Empresa, logo e cadastro das usinas."]
  };
  $("pageTitle").textContent=titles[view][0];
  $("pageSubtitle").textContent=titles[view][1];
}
document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>navTo(b.dataset.view));

function renderDashboard(){
  const now=new Date(),month=now.getMonth(),year=now.getFullYear();
  const monthMoves=db.movements.filter(m=>{
    const d=fmtRaw(m.date);
    return d && new Date(d).getMonth()===month && new Date(d).getFullYear()===year;
  });
  const entregas=monthMoves.filter(m=>m.type==="Entrega").reduce((a,b)=>a+(+b.qty||0),0);
  const devolucoes=monthMoves.filter(m=>m.type==="Devolução").reduce((a,b)=>a+(+b.qty||0),0);
  const totalStock=db.epis.reduce((a,p)=>a+stockQty(p),0);
  const pending=db.movements.filter(m=>movementSignature(m)!=="ASSINADO").length;

  $("kpis").innerHTML=[
    ["EPIs entregues no mês",entregas,"Quantidade entregue"],
    ["Devoluções no mês",devolucoes,"Quantidade devolvida"],
    ["Itens em estoque",totalStock,"Saldo atual do catálogo"],
    ["Assinaturas pendentes",pending,"Fichas físicas pendentes"]
  ].map(x=>`<div class="kpi"><span>${x[0]}</span><strong>${x[1]}</strong><small>${x[2]}</small></div>`).join("");

  const alerts=[];
  db.epis.filter(p=>stockQty(p)===0).forEach(p=>{
    alerts.push(`<div class="alert"><span class="pill danger">Sem estoque</span><div><strong>${escapeHtml(p.name)}</strong><span>Quantidade disponível: 0</span></div></div>`);
  });
  if(pending>0){
    alerts.push(`<div class="alert"><span class="pill warning">Assinaturas</span><div><strong>${pending} movimentação(ões) pendente(s)</strong><span>Atualize o status quando a ficha física for assinada.</span></div></div>`);
  }
  $("alerts").innerHTML=alerts.join("")||'<div class="empty-state">Sem alertas no momento.</div>';

  $("recentMoves").innerHTML=[...db.movements]
    .sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)))
    .slice(0,6)
    .map(m=>`<tr>
      <td>${fmtDate(m.date)}</td>
      <td>${escapeHtml(emp(m.employeeId)?.name||"-")}</td>
      <td>${escapeHtml(epi(m.epiId)?.name||"-")}</td>
      <td><span class="status ${m.type==="Entrega"?"info":"ok"}">${escapeHtml(m.type||"-")}</span></td>
      <td><span class="status ${signatureClass(movementSignature(m))}">${signatureLabel(movementSignature(m))}</span></td>
    </tr>`).join("") || '<tr><td colspan="5" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
}

function renderMovements(){
  const q=($("movSearch")?.value||"").toLowerCase();
  const type=$("movType")?.value||"";
  const signature=$("movSignature")?.value||"";
  const rows=[...db.movements]
    .sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)))
    .filter(m=>{
      const name=(emp(m.employeeId)?.name||"").toLowerCase();
      const epiName=(epi(m.epiId)?.name||"").toLowerCase();
      const sig=movementSignature(m);
      return (!type||m.type===type)&&(!signature||sig===signature)&&(name.includes(q)||epiName.includes(q));
    });

  $("movementsTable").innerHTML=rows.map(m=>`<tr>
    <td>${fmtDate(m.date)}</td>
    <td><span class="status ${m.type==="Entrega"?"info":"ok"}">${escapeHtml(m.type||"-")}</span></td>
    <td>${escapeHtml(emp(m.employeeId)?.name||"-")}</td>
    <td>${escapeHtml(plantName(m.plantId||emp(m.employeeId)?.plantId))}</td>
    <td>${escapeHtml(epi(m.epiId)?.name||"-")}</td>
    <td>${m.qty||0}</td>
    <td>${escapeHtml(m.size||"-")}</td>
    <td><span class="status ${signatureClass(movementSignature(m))}">${signatureLabel(movementSignature(m))}</span></td>
    <td class="obs-cell">${escapeHtml(m.obs||"-")}</td>
    <td><button class="table-action" onclick="openSignatureModal('${m.id}','${movementSignature(m)}')">Alterar assinatura</button></td>
  </tr>`).join("") || '<tr><td colspan="10" class="empty-state">Nenhuma movimentação registrada.</td></tr>';
}

function renderEmployees(){
  const q=($("empSearch")?.value||"").toLowerCase();
  $("employeesTable").innerHTML=db.employees
    .filter(e=>(e.name||"").toLowerCase().includes(q)||(e.reg||"").toLowerCase().includes(q))
    .map(e=>{
      const last=[...db.movements].filter(m=>m.employeeId===e.id&&m.type==="Entrega").sort((a,b)=>new Date(fmtRaw(b.date))-new Date(fmtRaw(a.date)))[0];
      return `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.reg||"-")}</td><td>${escapeHtml(e.role||"-")}</td><td>${escapeHtml(plantName(e.plantId))}</td><td><span class="status ok">${escapeHtml(e.status||"Ativo")}</span></td><td>${last?fmtDate(last.date):"Sem registro"}</td></tr>`;
    }).join("") || '<tr><td colspan="6" class="empty-state">Nenhum colaborador cadastrado.</td></tr>';
}

function renderEpis(){
  $("episTable").innerHTML=db.epis.map(p=>`<tr>
    <td>${escapeHtml(p.name||"-")}</td>
    <td>${escapeHtml(p.ca||"-")}</td>
    <td>${escapeHtml(p.unit||"-")}</td>
    <td>${escapeHtml((p.sizes||[]).join(", ")||"Único")}</td>
    <td><span class="stock-number ${stockQty(p)===0?"stock-zero":""}">${stockQty(p)}</span></td>
    <td>${isSSMA()?`<button class="table-action" onclick="openEpiModal('${p.id}')">Editar / Reabastecer</button>`:"-"}</td>
  </tr>`).join("") || '<tr><td colspan="6" class="empty-state">Nenhum EPI cadastrado.</td></tr>';
}

function renderPlants(){
  $("plantsGrid").innerHTML=db.plants.map(p=>`<div class="plant-card"><strong>${escapeHtml(p.name)}</strong></div>`).join("") || '<div class="empty-state">Nenhuma usina cadastrada.</div>';
}

function renderUsers(){
  $("usersTable").innerHTML=db.users.map(u=>`<tr><td>${escapeHtml(u.name||u.email||"-")}</td><td>${escapeHtml(u.email||"-")}</td><td><span class="status info">${escapeHtml(u.role||"-")}</span></td><td>${escapeHtml(u.plantId||u.plant||"-")}</td><td><span class="status ok">${escapeHtml(u.status||"-")}</span></td></tr>`).join("");
}
function renderAudit(){
  $("auditTable").innerHTML=[...db.audit].sort((a,b)=>new Date(fmtRaw(b.createdAt))-new Date(fmtRaw(a.createdAt))).map(a=>`<tr><td>${fmtDate(a.createdAt)}</td><td>${escapeHtml(a.userName||a.userEmail||"-")}</td><td><span class="status info">${escapeHtml(a.action||"-")}</span></td><td>${escapeHtml(a.record||"-")}</td></tr>`).join("");
}
function renderSettings(){
  $("companyName").value=db.settings.companyName||"";
  $("companyLogoPreview").src=db.settings.logoDataUrl||"./logo-symbol.png";
  renderPlants();
}
function refresh(){
  renderDashboard();
  renderMovements();
  renderEmployees();
  renderEpis();
  renderUsers();
  renderAudit();
  renderSettings();
  populateSelects();
}

function populateSelects(){
  const employees=db.employees.filter(e=>e.status==="Ativo");
  $("mEmployee").innerHTML=employees.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  $("mEpi").innerHTML=db.epis.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} — estoque ${stockQty(p)}</option>`).join("");
  $("ePlant").innerHTML=db.plants.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  $("reportEmployee").innerHTML='<option value="">Selecione...</option>'+db.employees.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join("");
  updateMovementPlant();
  updateMovementSizes();
}

function closeModal(id){$(id).classList.remove("open")}
window.closeModal=closeModal;

function openMovementModal(){
  if(!db.employees.length){alert("Cadastre um colaborador antes de registrar a movimentação.");return}
  if(!db.epis.length){alert("Cadastre um EPI antes de registrar a movimentação.");return}
  populateSelects();
  $("mDate").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
  $("mQty").value=1;
  $("mSignature").value="ASSINADO";
  $("mObs").value="";
  $("movementModal").classList.add("open");
}
window.openMovementModal=openMovementModal;

function openEmployeeModal(){
  if(!db.plants.length){alert("Cadastre uma usina em Configurações antes de cadastrar o colaborador.");return}
  populateSelects();
  $("employeeModal").classList.add("open");
}
window.openEmployeeModal=openEmployeeModal;

function openEpiModal(id=""){
  $("epiForm").reset();
  $("pId").value=id||"";
  if(id){
    const p=epi(id);
    if(!p)return;
    $("epiModalTitle").textContent="Editar EPI / Reabastecer estoque";
    $("epiSaveButton").textContent="Salvar alterações";
    $("pName").value=p.name||"";
    $("pCA").value=p.ca||"";
    $("pUnit").value=p.unit||"Unidade";
    $("pSizes").value=(p.sizes||[]).join(", ");
    $("pStock").value=stockQty(p);
  }else{
    $("epiModalTitle").textContent="Novo EPI";
    $("epiSaveButton").textContent="Cadastrar";
    $("pStock").value=0;
  }
  $("epiModal").classList.add("open");
}
window.openEpiModal=openEpiModal;

function openPlantModal(){$("plantModal").classList.add("open")}
window.openPlantModal=openPlantModal;

function openSignatureModal(id,current){
  $("signatureMovementId").value=id;
  $("signatureStatus").value=current==="ASSINADO"?"ASSINADO":"PENDENTE";
  $("signatureModal").classList.add("open");
}
window.openSignatureModal=openSignatureModal;

function updateMovementPlant(){
  const employee=emp($("mEmployee")?.value);
  if($("mPlant")) $("mPlant").value=employee?plantName(employee.plantId):"";
}
function updateMovementSizes(){
  const p=epi($("mEpi")?.value);
  if(!$("mSize"))return;
  const sizes=(p?.sizes||[]).filter(Boolean);
  $("mSize").innerHTML=(sizes.length?sizes:["Único"]).map(s=>`<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
}
$("mEmployee").addEventListener("change",updateMovementPlant);
$("mEpi").addEventListener("change",updateMovementSizes);

async function logAudit(action,record){
  await addDoc(collection(firestore,"auditLogs"),{
    action,record,userUid:auth.currentUser.uid,userEmail:auth.currentUser.email,
    userName:profile.name||auth.currentUser.email,createdAt:serverTimestamp()
  });
}

$("plantForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const name=$("uName").value.trim();
    await addDoc(collection(firestore,"plants"),{name,createdAt:serverTimestamp(),createdBy:auth.currentUser.uid});
    await logAudit("CADASTRO_USINA",name);
    e.target.reset();closeModal("plantModal");await loadAll();
  }catch(err){console.error(err);alert("Não foi possível cadastrar a usina.")}
};

$("employeeForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const data={name:$("eName").value.trim(),reg:$("eReg").value.trim(),role:$("eRole").value.trim(),plantId:$("ePlant").value,admission:$("eAdmission").value,status:"Ativo",createdAt:serverTimestamp(),createdBy:auth.currentUser.uid};
    await addDoc(collection(firestore,"employees"),data);
    await logAudit("CADASTRO_COLABORADOR",data.name);
    e.target.reset();closeModal("employeeModal");await loadAll();
  }catch(err){console.error(err);alert("Não foi possível cadastrar o colaborador.")}
};

$("epiForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const id=$("pId").value;
    const data={
      name:$("pName").value.trim(),
      ca:$("pCA").value.trim(),
      unit:$("pUnit").value,
      sizes:$("pSizes").value.split(",").map(x=>x.trim()).filter(Boolean),
      stockQty:Math.max(0,+$("pStock").value||0),
      updatedAt:serverTimestamp(),
      updatedBy:auth.currentUser.uid
    };
    if(id){
      await setDoc(doc(firestore,"epis",id),data,{merge:true});
      await logAudit("EDICAO_EPI",`${data.name} — estoque ${data.stockQty}`);
    }else{
      data.createdAt=serverTimestamp();data.createdBy=auth.currentUser.uid;
      await addDoc(collection(firestore,"epis"),data);
      await logAudit("CADASTRO_EPI",`${data.name} — estoque ${data.stockQty}`);
    }
    e.target.reset();closeModal("epiModal");await loadAll();
  }catch(err){console.error(err);alert("Não foi possível salvar o EPI.")}
};

$("movementForm").onsubmit=async e=>{
  e.preventDefault();
  const employee=emp($("mEmployee").value);
  const type=$("mType").value;
  const qty=Math.max(1,+$("mQty").value||1);
  const epiId=$("mEpi").value;
  const selectedEpi=epi(epiId);
  if(!employee||!selectedEpi){alert("Selecione colaborador e EPI.");return}

  const epiRef=doc(firestore,"epis",epiId);
  const moveRef=doc(collection(firestore,"movements"));
  try{
    await runTransaction(firestore,async tx=>{
      const epiSnap=await tx.get(epiRef);
      if(!epiSnap.exists())throw new Error("EPI_NAO_ENCONTRADO");
      const current=Math.max(0,Number(epiSnap.data().stockQty??0)||0);
      if(type==="Entrega"&&current<qty)throw new Error("ESTOQUE_INSUFICIENTE");
      const next=type==="Entrega"?current-qty:current+qty;
      tx.update(epiRef,{stockQty:next,updatedAt:serverTimestamp(),updatedBy:auth.currentUser.uid});
      tx.set(moveRef,{
        date:new Date($("mDate").value),
        type,
        employeeId:employee.id,
        plantId:employee.plantId,
        epiId,
        qty,
        size:$("mSize").value,
        signatureStatus:$("mSignature").value,
        obs:$("mObs").value.trim(),
        userUid:auth.currentUser.uid,
        userEmail:auth.currentUser.email,
        userName:profile.name||auth.currentUser.email,
        createdAt:serverTimestamp()
      });
    });
    await logAudit(type.toUpperCase(),`${selectedEpi.name} → ${employee.name}`);
    e.target.reset();closeModal("movementModal");await loadAll();alert("Movimentação registrada com sucesso.");
  }catch(err){
    console.error(err);
    alert(err.message==="ESTOQUE_INSUFICIENTE"?"Estoque insuficiente para esta entrega.":"Não foi possível registrar a movimentação.");
  }
};

$("signatureForm").onsubmit=async e=>{
  e.preventDefault();
  const id=$("signatureMovementId").value;
  try{
    await updateDoc(doc(firestore,"movements",id),{
      signatureStatus:$("signatureStatus").value,
      signatureUpdatedAt:serverTimestamp(),
      signatureUpdatedBy:auth.currentUser.uid
    });
    await logAudit("ASSINATURA_EPI",`Movimentação ${id}: ${$("signatureStatus").value}`);
    closeModal("signatureModal");await loadAll();
  }catch(err){console.error(err);alert("Não foi possível alterar o status da assinatura.")}
};

function resizeLogo(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=reject;
    reader.onload=()=>{
      const img=new Image();
      img.onerror=reject;
      img.onload=()=>{
        const max=320;
        const scale=Math.min(1,max/Math.max(img.width,img.height));
        const canvas=document.createElement("canvas");
        canvas.width=Math.max(1,Math.round(img.width*scale));
        canvas.height=Math.max(1,Math.round(img.height*scale));
        const ctx=canvas.getContext("2d");
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img,0,0,canvas.width,canvas.height);
        resolve(canvas.toDataURL("image/webp",0.86));
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$("companyLogoFile").addEventListener("change",async e=>{
  const file=e.target.files?.[0];
  if(!file)return;
  try{
    pendingLogoDataUrl=await resizeLogo(file);
    $("companyLogoPreview").src=pendingLogoDataUrl;
  }catch(err){console.error(err);alert("Não foi possível processar a imagem.")}
});
$("removeCompanyLogo").addEventListener("click",()=>{
  pendingLogoDataUrl="";
  $("companyLogoFile").value="";
  $("companyLogoPreview").src="./logo-symbol.png";
});
$("companyForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const data={
      companyName:$("companyName").value.trim(),
      logoDataUrl:pendingLogoDataUrl||"",
      updatedAt:serverTimestamp(),
      updatedBy:auth.currentUser.uid
    };
    await setDoc(doc(firestore,"settings","company"),data,{merge:true});
    await logAudit("CONFIGURACOES_EMPRESA",data.companyName||"Empresa");
    await loadAll();
    alert("Configurações salvas.");
  }catch(err){console.error(err);alert("Não foi possível salvar as configurações.")}
};

function reportHeader(){
  const logo=db.settings.logoDataUrl?`<img src="${db.settings.logoDataUrl}" alt="Logo">`:"";
  const company=escapeHtml(db.settings.companyName||"Empresa");
  return `<div class="r-head">${logo}<div><h1>${company}</h1><h2>Gestão de EPIs</h2></div></div>`;
}
function openPrintable(title,headers,rows,subtitle=""){
  const popup=window.open("","_blank");
  if(!popup){alert("O navegador bloqueou a janela do relatório. Permita pop-ups para este site.");return}
  const tableRows=rows.map(r=>`<tr>${r.map(v=>`<td>${escapeHtml(String(v??""))}</td>`).join("")}</tr>`).join("");
  popup.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>body{font-family:Arial,sans-serif;color:#111;padding:30px}.r-head{display:flex;align-items:center;gap:18px;border-bottom:2px solid #222;padding-bottom:14px;margin-bottom:18px}.r-head img{max-width:90px;max-height:70px}.r-head h1{font-size:20px;margin:0}.r-head h2{font-size:14px;margin:4px 0 0;font-weight:normal;color:#555}h3{margin:0 0 4px}.sub{color:#555;margin:0 0 18px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #bbb;padding:7px;text-align:left}th{background:#eee}.foot{margin-top:18px;color:#666;font-size:10px}@media print{button{display:none}}</style></head><body>
    ${reportHeader()}<h3>${escapeHtml(title)}</h3><p class="sub">${escapeHtml(subtitle)}</p>
    <table><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table>
    <p class="foot">Emitido em ${new Date().toLocaleString("pt-BR")}</p>
    <script>window.onload=()=>setTimeout(()=>window.print(),250)<\/script></body></html>`);
  popup.document.close();
}
function printReport(type){
  if(type==="monthly"){
    const now=new Date(),month=now.getMonth(),year=now.getFullYear();
    const moves=[...db.movements].filter(m=>{
      const d=new Date(fmtRaw(m.date));
      return d.getMonth()===month&&d.getFullYear()===year;
    }).sort((a,b)=>new Date(fmtRaw(a.date))-new Date(fmtRaw(b.date)));
    openPrintable("Relatório mensal de EPIs",
      ["Data","Tipo","Colaborador","Usina","EPI","Qtd.","Tamanho","Assinatura","Observações"],
      moves.map(m=>[fmtDate(m.date),m.type,emp(m.employeeId)?.name||"-",plantName(m.plantId),epi(m.epiId)?.name||"-",m.qty,m.size||"-",signatureLabel(movementSignature(m)),m.obs||"-"]),
      new Date().toLocaleDateString("pt-BR",{month:"long",year:"numeric"})
    );
  }else{
    const id=$("reportEmployee").value;
    if(!id){alert("Selecione um colaborador para gerar o relatório.");return}
    const employee=emp(id);
    const moves=[...db.movements].filter(m=>m.employeeId===id).sort((a,b)=>new Date(fmtRaw(a.date))-new Date(fmtRaw(b.date)));
    openPrintable(`Relatório de EPIs — ${employee?.name||"Colaborador"}`,
      ["Data","Tipo","Usina","EPI","Qtd.","Tamanho","Assinatura","Observações"],
      moves.map(m=>[fmtDate(m.date),m.type,plantName(m.plantId),epi(m.epiId)?.name||"-",m.qty,m.size||"-",signatureLabel(movementSignature(m)),m.obs||"-"]),
      `Matrícula: ${employee?.reg||"-"} | Função: ${employee?.role||"-"} | Usina: ${plantName(employee?.plantId)}`
    );
  }
}
window.printReport=printReport;

function downloadCSV(type){
  let rows=[],name=`relatorio-${type}.csv`;
  if(type==="movimentacoes"){
    rows=[["Data","Tipo","Colaborador","Usina","EPI","Quantidade","Tamanho","Assinatura","Observações"],...db.movements.map(m=>[fmtDate(m.date),m.type,emp(m.employeeId)?.name||"",plantName(m.plantId),epi(m.epiId)?.name||"",m.qty,m.size||"",signatureLabel(movementSignature(m)),m.obs||""])];
  }
  if(type==="epis"){
    rows=[["EPI","C.A.","Unidade","Tamanhos","Quantidade em estoque"],...db.epis.map(p=>[p.name,p.ca,p.unit,(p.sizes||[]).join(", "),stockQty(p)])];
  }
  const csv=rows.map(r=>r.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(";")).join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);
}
window.downloadCSV=downloadCSV;

function escapeHtml(v){
  return String(v??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function escapeAttr(v){return escapeHtml(v).replace(/`/g,"&#96;")}
