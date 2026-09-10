let TOKEN = localStorage.getItem('ledger_token') || null;
let ME = JSON.parse(localStorage.getItem('ledger_me') || 'null');
let currentType = 'expense';
let companies = [];
let users = [];

function fmt(n){ return "₹" + Number(n||0).toLocaleString('en-IN', {maximumFractionDigits:2}); }

async function api(path, options={}) {
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || 'ભૂલ થઈ');
  return data;
}

// ---------- LOGIN ----------
document.getElementById('loginBtn').addEventListener('click', doLogin);
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogin(){
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errBox = document.getElementById('loginError');
  errBox.textContent = '';
  try{
    const data = await api('/login', { method:'POST', body:{ username, password } });
    TOKEN = data.token; ME = data.user;
    localStorage.setItem('ledger_token', TOKEN);
    localStorage.setItem('ledger_me', JSON.stringify(ME));
    enterApp();
  }catch(e){
    errBox.textContent = e.message;
  }
}

document.getElementById('logoutBtn').addEventListener('click', ()=>{
  TOKEN = null; ME = null;
  localStorage.removeItem('ledger_token'); localStorage.removeItem('ledger_me');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
});

async function enterApp(){
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  document.getElementById('whoAmI').textContent = `${ME.display_name} (${ME.role === 'admin' ? 'CEO / Admin' : 'ભાગીદાર'})`;
  document.getElementById('adminUsersCard').style.display = ME.role === 'admin' ? 'block' : 'none';
  document.getElementById('fUserLabel').textContent = ME.role === 'admin' ? 'કોના તરફથી' : 'કોણે';
  await loadAll();
}

// ---------- LOAD DATA ----------
async function loadAll(){
  try{
    [companies, users] = await Promise.all([ api('/companies'), api('/users').catch(()=>[]) ]);
  }catch(e){ companies = await api('/companies'); users = []; }
  populateSelects();
  await Promise.all([ renderEntries(), renderBalance() ]);
  renderSetup();
}

function populateSelects(){
  const compSel = document.getElementById('fCompany');
  compSel.innerHTML = companies.map(c=>`<option value="${c.id}">${c.name}</option>`).join('') || '<option value="">કંપની ઉમેરો</option>';
  const userSel = document.getElementById('fUser');
  if (ME.role === 'admin') {
    const partners = users.filter(u=>u.role==='partner');
    userSel.innerHTML = [{id:ME.id, display_name: ME.display_name}, ...partners]
      .map(u=>`<option value="${u.id}">${u.display_name}</option>`).join('');
  } else {
    userSel.innerHTML = `<option value="${ME.id}">${ME.display_name}</option>`;
  }
  document.getElementById('fDate').valueAsDate = new Date();
}

// ---------- ENTRIES ----------
document.getElementById('typeSeg').addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-type]');
  if(!btn) return;
  currentType = btn.dataset.type;
  document.querySelectorAll('#typeSeg button').forEach(b=>b.classList.toggle('on', b===btn));
});

document.getElementById('saveBtn').addEventListener('click', async ()=>{
  const company_id = Number(document.getElementById('fCompany').value);
  const user_id = Number(document.getElementById('fUser').value);
  const amount = parseFloat(document.getElementById('fAmount').value);
  const entry_date = document.getElementById('fDate').value;
  const note = document.getElementById('fNote').value.trim();
  if(!company_id){ alert('પહેલા સેટઅપમાં કંપની ઉમેરો'); return; }
  if(!amount || amount <= 0){ alert('સાચી રકમ નાખો'); return; }
  if(!entry_date){ alert('તારીખ પસંદ કરો'); return; }
  try{
    await api('/entries', { method:'POST', body:{ type: currentType, company_id, user_id, amount, entry_date, note } });
    document.getElementById('fAmount').value = '';
    document.getElementById('fNote').value = '';
    await renderEntries(); await renderBalance();
  }catch(e){ alert(e.message); }
});

async function renderEntries(){
  const rows = await api('/entries');
  const list = document.getElementById('entriesList');
  if(rows.length === 0){
    list.innerHTML = `<div class="empty">હજુ કોઈ નોંધ નથી. ઉપર પહેલી નોંધ ઉમેરો.</div>`;
    return;
  }
  list.innerHTML = rows.map(e=>{
    const label = e.type === 'expense' ? 'ખર્ચ' : 'રસીવ';
    const cls = e.type === 'expense' ? 'amt-exp' : 'amt-rcv';
    const sign = e.type === 'expense' ? '−' : '+';
    const canDelete = ME.role === 'admin' || e.user_id === ME.id;
    return `<div class="entry">
      <div class="entry-main">
        <div class="entry-title">${e.company_name} · ${label} · ${e.user_name}</div>
        <div class="entry-meta">${e.entry_date}${e.note ? ' · ' + e.note : ''}</div>
      </div>
      <div class="entry-amt ${cls}">${sign}${fmt(e.amount)}</div>
      ${canDelete ? `<button class="del-btn" data-del="${e.id}" title="ડિલીટ કરો">✕</button>` : ''}
    </div>`;
  }).join('');
}

document.getElementById('entriesList').addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-del]');
  if(!btn) return;
  if(!confirm('ભૂલથી થયેલી આ નોંધ ડિલીટ કરવી છે? આ પાછું નહીં થાય.')) return;
  try{
    await api('/entries/' + btn.dataset.del, { method:'DELETE' });
    await renderEntries(); await renderBalance();
  }catch(e){ alert(e.message); }
});

// ---------- BALANCE ----------
async function renderBalance(){
  const rows = await api('/entries');
  const byCompany = {}; companies.forEach(c=> byCompany[c.name] = {expense:0, received:0});
  const byUser = {};
  rows.forEach(e=>{
    if(!byCompany[e.company_name]) byCompany[e.company_name] = {expense:0, received:0};
    byCompany[e.company_name][e.type] += Number(e.amount);
    if(!byUser[e.user_id]) byUser[e.user_id] = { name: e.user_name, expense:0, received:0 };
    byUser[e.user_id][e.type] += Number(e.amount);
  });

  const userList = Object.values(byUser);
  const hero = document.getElementById('balanceHero');
  if(userList.length < 2){
    hero.innerHTML = `<div class="who">ઓછામાં ઓછા બે વ્યક્તિની નોંધ થાય પછી હિસાબ દેખાશે</div>`;
  } else {
    // simple two-way settle using first two active contributors (partners)
    const [a, b] = userList.sort((x,y)=> (y.expense+y.received) - (x.expense+x.received));
    const netA = a.expense - a.received;
    const netB = b.expense - b.received;
    const diff = netA - netB;
    const settle = Math.abs(diff) / 2;
    if(Math.round(settle*100) === 0){
      hero.innerHTML = `<div class="who">હિસાબ સરભર છે</div><div class="amt settled">✓ ${fmt(0)}</div>`;
    } else if(diff > 0){
      hero.innerHTML = `<div class="who">સરભર કરવા માટે</div><div class="amt">${fmt(settle)}</div><div class="who"><b>${b.name}</b> એ <b>${a.name}</b> ને ચૂકવવાના છે</div>`;
    } else {
      hero.innerHTML = `<div class="who">સરભર કરવા માટે</div><div class="amt">${fmt(settle)}</div><div class="who"><b>${a.name}</b> એ <b>${b.name}</b> ને ચૂકવવાના છે</div>`;
    }
  }

  const compTable = document.getElementById('companyTable');
  const compNames = Object.keys(byCompany);
  compTable.innerHTML = compNames.length ? compNames.map(name=>{
    const t = byCompany[name]; const net = t.received - t.expense;
    return `<tr><td>${name}</td><td class="num">${fmt(t.expense)}</td><td class="num">${fmt(t.received)}</td><td class="num">${fmt(net)}</td></tr>`;
  }).join('') : `<tr><td colspan="4" class="empty">કંપની ઉમેરો</td></tr>`;

  const partTable = document.getElementById('partnerTable');
  partTable.innerHTML = Object.values(byUser).map(u=>
    `<tr><td>${u.name}</td><td class="num">${fmt(u.expense)}</td><td class="num">${fmt(u.received)}</td></tr>`
  ).join('') || `<tr><td colspan="3" class="empty">હજુ કોઈ નોંધ નથી</td></tr>`;
}

// ---------- SETUP: password ----------
document.getElementById('changePassBtn').addEventListener('click', async ()=>{
  const newPassword = document.getElementById('newPass').value;
  const statusBox = document.getElementById('passStatus');
  try{
    await api('/change-password', { method:'POST', body:{ newPassword } });
    document.getElementById('newPass').value = '';
    statusBox.textContent = '✓ પાસવર્ડ બદલાઈ ગયો';
  }catch(e){ statusBox.textContent = '⚠ ' + e.message; }
});

// ---------- SETUP: companies ----------
function renderSetup(){
  const chips = document.getElementById('companyChips');
  chips.innerHTML = companies.map(c=>
    `<span class="chip">${c.name} <button data-rmcompany="${c.id}">✕</button></span>`
  ).join('') || `<span class="status">હજુ કોઈ કંપની ઉમેરી નથી</span>`;

  if(ME.role === 'admin'){
    const usersList = document.getElementById('usersList');
    const partners = users.filter(u=>u.role==='partner');
    usersList.innerHTML = partners.map(u=>
      `<div class="users-row"><span>${u.display_name} <span class="status">(${u.username})</span></span><button class="del-btn" data-rmuser="${u.id}">✕</button></div>`
    ).join('') || `<div class="status">હજુ કોઈ ભાગીદાર ઉમેર્યા નથી</div>`;
  }
}

document.getElementById('addCompanyBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('newCompany');
  const name = input.value.trim();
  if(!name) return;
  try{
    await api('/companies', { method:'POST', body:{ name } });
    input.value = '';
    companies = await api('/companies');
    populateSelects(); renderSetup(); await renderBalance();
  }catch(e){ alert(e.message); }
});

document.getElementById('companyChips').addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-rmcompany]');
  if(!btn) return;
  if(!confirm('આ કંપની કાઢી નાખવી છે?')) return;
  await api('/companies/' + btn.dataset.rmcompany, { method:'DELETE' });
  companies = await api('/companies');
  populateSelects(); renderSetup(); await renderBalance();
});

// ---------- SETUP: admin user management ----------
document.getElementById('addPartnerBtn')?.addEventListener('click', async ()=>{
  const input = document.getElementById('newPartnerName');
  const display_name = input.value.trim();
  if(!display_name) return;
  try{
    const creds = await api('/users', { method:'POST', body:{ display_name } });
    input.value = '';
    users = await api('/users');
    renderSetup(); populateSelects();
    const box = document.getElementById('newCredsBox');
    box.style.display = 'block';
    box.innerHTML = `<b>${creds.display_name}</b> માટે લોગિન બન્યું — આ વિગત હમણાં જ કોપી કરી લો, ફરી નહીં દેખાય:<br>
      username: <b>${creds.username}</b><br>
      password: <b>${creds.password}</b>`;
  }catch(e){ alert(e.message); }
});

document.getElementById('usersList')?.addEventListener('click', async (e)=>{
  const btn = e.target.closest('button[data-rmuser]');
  if(!btn) return;
  if(!confirm('આ ભાગીદારનું એકાઉન્ટ કાઢી નાખવું છે? એની જૂની નોંધો રહેશે, પણ એ હવે લોગિન નહીં કરી શકે.')) return;
  await api('/users/' + btn.dataset.rmuser, { method:'DELETE' });
  users = await api('/users');
  renderSetup(); populateSelects();
});

// ---------- TABS ----------
document.querySelectorAll('nav.tabs button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('nav.tabs button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
  });
});

// ---------- BOOT ----------
if (TOKEN && ME) { enterApp().catch(()=>{ localStorage.clear(); location.reload(); }); }
