/* KSP Market T/E — launch hardening
   One small layer loaded last. It fixes the mobile auth CTA, renders every listed
   company from market-data.json, supports JSA trading, and avoids duplicate
   submissions after network timeouts.
*/
(() => {
  'use strict';

  const money = n => new Intl.NumberFormat('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0)+' ₡';
  const pct = n => `${Number(n)>=0?'+':''}${Number(n||0).toFixed(2)}%`;
  const esc = s => String(s ?? '').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
  const toast = msg => {
    const el=document.getElementById('toast');
    if(!el)return;
    el.textContent=msg;el.classList.add('show');
    clearTimeout(window.__kspLaunchToast);
    window.__kspLaunchToast=setTimeout(()=>el.classList.remove('show'),4500);
  };
  const timeout = (promise,ms,message) => Promise.race([
    promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(message)),ms))
  ]);

  let companies=[];
  let started=false;

  function client(){
    if(window.supabaseClient)return window.supabaseClient;
    const cfg=window.KSP_SUPABASE||{};
    if(!window.supabase||!cfg.url||!cfg.anonKey)return null;
    window.supabaseClient=window.supabase.createClient(cfg.url,cfg.anonKey);
    return window.supabaseClient;
  }

  async function load(){
    const r=await fetch('./market-data.json?launch='+Date.now(),{cache:'no-store'});
    if(!r.ok)throw new Error('market-data.json no disponible');
    const d=await r.json();
    companies=Array.isArray(d.companies)?d.companies:[];
    const count=document.getElementById('companyCount');
    if(count)count.textContent=String(companies.length);
    render();
  }

  function render(){
    let board=document.getElementById('companyBoard');
    if(!board){
      board=document.createElement('div');
      board.id='companyBoard';
      board.className='company-board';
      const grid=document.querySelector('.market-grid');
      if(grid)grid.parentNode.insertBefore(board,grid);
      else return;
    }
    const listed=companies.filter(c=>c && c.ticker!=='KD');
    board.innerHTML=listed.length?listed.map(c=>{
      const change=Number(c.dailyChange??c.lastChange??0);
      const members=[...(c.relatedMembers||[]),...(c.people||[])].filter(Boolean);
      return `<article class="company-card" data-launch-ticker="${esc(c.ticker)}">
        <div class="company-head">
          <span class="ticker">${esc(c.ticker)}</span>
          <div><h3>${esc(c.name)}</h3><small>${esc(c.sector||'Empresa cotizada')}</small></div>
        </div>
        <div class="company-price">${money(c.price)}</div>
        <div class="company-change ${change>0?'up':change<0?'down':''}">${pct(change)} · ${esc(c.signal||'NEUTRAL')}</div>
        <div class="company-meta"><span>Persona vinculada: <b>${esc(members.join(', ')||'—')}</b></span></div>
        <div class="company-actions">
          <button class="company-buy" data-launch-buy="${esc(c.ticker)}">Comprar</button>
          <button class="company-sell" data-launch-sell="${esc(c.ticker)}">Vender</button>
        </div>
      </article>`;
    }).join(''):'';

    board.querySelectorAll('[data-launch-buy]').forEach(b=>b.onclick=()=>tradeModal(b.dataset.launchBuy,'buy'));
    board.querySelectorAll('[data-launch-sell]').forEach(b=>b.onclick=()=>tradeModal(b.dataset.launchSell,'sell'));
  }

  function tradeModal(ticker,side){
    const c=companies.find(x=>x.ticker===ticker);
    if(!c)return;
    document.getElementById('launchTradeModal')?.remove();
    const modal=document.createElement('div');
    modal.id='launchTradeModal';
    modal.className='company-trade-modal';
    modal.innerHTML=`<div class="company-trade-box" role="dialog" aria-modal="true" aria-labelledby="launchTradeTitle">
      <button id="launchTradeClose" style="float:right;background:none;border:0;color:#9aa4b2;font-size:28px;cursor:pointer">×</button>
      <span class="eyebrow">ORDEN DE ${side==='buy'?'COMPRA':'VENTA'}</span>
      <h2 id="launchTradeTitle">${side==='buy'?'Comprar':'Vender'} ${esc(c.ticker)}</h2>
      <p>${esc(c.name)} · <b>${money(c.price)}</b></p>
      <label>Cantidad<input id="launchTradeQty" type="number" min="1" max="100000" step="1" inputmode="numeric" value="1"></label>
      <p>Total estimado: <b id="launchTradeTotal">${money(c.price)}</b></p>
      <div class="company-trade-actions">
        <button class="company-trade-cancel" id="launchTradeCancel">Cancelar</button>
        <button class="company-trade-confirm" id="launchTradeConfirm">Confirmar ${side==='buy'?'compra':'venta'}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const qty=document.getElementById('launchTradeQty');
    const total=document.getElementById('launchTradeTotal');
    const refresh=()=>total.textContent=money((Number(qty.value)||0)*Number(c.price));
    qty.oninput=refresh;
    const close=()=>modal.remove();
    document.getElementById('launchTradeClose').onclick=close;
    document.getElementById('launchTradeCancel').onclick=close;
    document.getElementById('launchTradeConfirm').onclick=async()=>{
      const q=Math.floor(Number(qty.value));
      if(!Number.isSafeInteger(q)||q<1)return toast('La cantidad debe ser un entero mayor que 0.');
      const sb=client();
      if(!sb)return toast('Backend online no configurado.');
      const {data:s}=await sb.auth.getSession();
      if(!s?.session)return toast('Inicia sesión para operar.');
      const btn=document.getElementById('launchTradeConfirm');
      btn.disabled=true;btn.textContent='Procesando…';
      const startedAt=Date.now();
      try{
        const result=await timeout(
          sb.rpc('place_market_order_by_ticker',{p_ticker:ticker,p_side:side,p_quantity:q}),
          45000,
          'La conexión tardó demasiado. Comprobando si la orden llegó al mercado…'
        );
        if(result.error)throw result.error;
        const row=Array.isArray(result.data)?result.data[0]:result.data;
        if(!row?.price)throw new Error('El mercado no devolvió una ejecución válida.');
        close();
        toast((side==='buy'?'Compra':'Venta')+` ejecutada · ${q} ${ticker} · ${money(row.price)}`);
        await load();
      }catch(err){
        const msg=String(err?.message||err);
        if(/tardó demasiado|timeout|timed out/i.test(msg)){
          try{
            const cid=(await sb.from('companies').select('id').eq('ticker',ticker).maybeSingle()).data?.id;
            if(cid){
              const found=(await timeout(
                sb.from('orders').select('side,quantity,price,created_at')
                  .eq('user_id',s.session.user.id).eq('company_id',cid)
                  .eq('side',side).eq('quantity',q)
                  .gte('created_at',new Date(startedAt-5000).toISOString())
                  .order('created_at',{ascending:false}).limit(1).maybeSingle(),
                10000,'recovery timeout'
              )).data;
              if(found){
                close();
                toast((side==='buy'?'Compra':'Venta')+` confirmada · ${q} ${ticker} · ${money(found.price)}`);
                await load();
                return;
              }
            }
          }catch(recovery){console.warn('KSP order recovery',recovery);}
          toast('No se pudo confirmar la orden. No la repitas todavía; revisa Operaciones.');
        }else{
          toast('No se pudo ejecutar la orden: '+msg);
        }
      }finally{
        const b=document.getElementById('launchTradeConfirm');
        if(b){b.disabled=false;b.textContent='Confirmar '+(side==='buy'?'compra':'venta');}
      }
    };
  }

  function hardenAuth(){
    const b=document.getElementById('accountBtn');
    if(!b)return;
    b.classList.add('launch-auth-button');
    b.onclick=()=>{
      const s=window.session;
      if(s && window.supabaseClient) window.supabaseClient.auth.signOut();
      else if(typeof window.openAuth==='function') window.openAuth(true);
      else document.getElementById('authModal')?.classList.remove('hidden');
    };
    if(window.session){
      b.textContent='Log out';
    }else{
      b.textContent='Iniciar sesión';
    }
  }

  function start(){
    if(started)return;
    started=true;
    hardenAuth();
    load().catch(e=>console.warn('KSP market data:',e));
    setInterval(()=>load().catch(e=>console.warn('KSP market refresh:',e)),15000);
    setInterval(hardenAuth,1000);
    const sb=client();
    if(sb){
      sb.channel('ksp-launch-live')
        .on('postgres_changes',{event:'*',schema:'public',table:'companies'},()=>load().catch(()=>{}))
        .subscribe();
      sb.auth.onAuthStateChange((_event,s)=>{
        window.session=s||null;
        hardenAuth();
      });
    }
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);
  else start();
})();