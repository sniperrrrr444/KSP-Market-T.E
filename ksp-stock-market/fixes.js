(function(){
const $=id=>document.getElementById(id);let busy=false,pending=false;
const show=m=>{const e=$('toast');if(!e)return;e.textContent=m;e.classList.add('show');clearTimeout(window.__kspToast);window.__kspToast=setTimeout(()=>e.classList.remove('show'),4200)};
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const withTimeout=(promise,ms,message)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error(message)),ms))]);
async function refresh(){try{if(!supabaseClient)return;const {data,error}=await withTimeout(supabaseClient.from('companies').select('price,previous_close').eq('ticker','KD').maybeSingle(),8000,'No se pudo actualizar la cotización.');if(error||!data)return;state.prev=Number(data.previous_close||state.price);state.price=Number(data.price);update()}catch(e){console.warn('KSP market refresh:',e.message)}}
async function syncAfterOrder(){try{await withTimeout(loadProfile(),8000,'perfil')}catch(e){console.warn('KSP profile sync:',e.message)}try{await withTimeout(loadHistory(),8000,'historial')}catch(e){console.warn('KSP history sync:',e.message)}try{update()}catch(e){console.warn('KSP UI sync:',e.message)}}

// If the network times out after PostgreSQL has already committed the transaction,
// never blindly submit the same order again. Look for the resulting order first.
async function recoverTimedOutOrder(executedSide,q,startedAt){
  if(!supabaseClient||!session)return false;
  for(let i=0;i<8;i++){
    try{
      const {data,error}=await withTimeout(
        supabaseClient.from('orders').select('side,quantity,price,created_at')
          .eq('user_id',session.user.id).eq('company_id',await companyId())
          .eq('side',executedSide).eq('quantity',q)
          .gte('created_at',new Date(startedAt-3000).toISOString())
          .order('created_at',{ascending:false}).limit(1).maybeSingle(),7000,'recovery'
      );
      if(!error&&data){
        await syncAfterOrder();
        const p=Number(data.price);
        $('tradeModal').classList.add('hidden');
        show((executedSide==='buy'?'Compra':'Venta')+' confirmada · '+q+' KD · '+money(p));
        return true;
      }
    }catch(e){console.warn('KSP order recovery:',e.message)}
    await wait(1500);
  }
  return false;
}

async function safeTrade(){
  if(busy||pending)return;
  if(!session||!supabaseClient)return show('Inicia sesión para operar online');
  const q=Math.floor(Number($('quantity').value));
  if(!Number.isSafeInteger(q)||q<1)return show('Cantidad no válida');
  const executedSide=side;
  const startedAt=Date.now();
  busy=true;pending=true;
  const b=$('confirmTrade'),old=b.textContent;
  b.disabled=true;b.textContent='Procesando orden…';
  try{
    const result=await withTimeout(
      supabaseClient.rpc('place_market_order_by_ticker',{p_ticker:'KD',p_side:executedSide,p_quantity:q}),30000,
      'La conexión tardó demasiado. Estoy comprobando si la orden llegó al mercado…'
    );
    const {data,error}=result;
    if(error)throw Error(error.message||'Error de Supabase');
    const r=Array.isArray(data)?data[0]:data;
    if(!r||r.new_price==null||r.price==null)throw Error('Supabase no devolvió una orden válida.');
    state.prev=Number(state.price);state.price=Number(r.new_price);
    if(executedSide==='buy'){state.shares+=q;state.cash=Math.max(0,state.cash-Number(r.price)*q)}
    else{state.shares=Math.max(0,state.shares-q);state.cash+=Number(r.price)*q}
    state.orders.unshift({side:executedSide,quantity:q,price:Number(r.price),date:new Date().toISOString()});
    state.history.push(state.price);state.history=state.history.slice(-100);
    priceSeries.push({price:state.price,volume:q,time:Date.now()});save();
    $('tradeModal').classList.add('hidden');update();
    show((executedSide==='buy'?'Compra':'Venta')+' ejecutada · '+q+' KD · '+money(r.price));
    void syncAfterOrder();
  }catch(e){
    console.error('KSP order error',e);
    const msg=String(e?.message||e);
    if(msg.includes('tardó demasiado')||msg.toLowerCase().includes('timeout')||msg.toLowerCase().includes('timed out')){
      const recovered=await recoverTimedOutOrder(executedSide,q,startedAt);
      if(!recovered)show('No se pudo confirmar la orden. No la repitas todavía; revisa Operaciones y tu saldo.');
    }else{
      show('No se pudo ejecutar la orden: '+msg);
    }
  }finally{
    busy=false;pending=false;b.disabled=false;b.textContent=old;update();
  }
}

async function forceSyncAuth(){if(!window.supabase||!window.KSP_SUPABASE)return;try{if(!supabaseClient)supabaseClient=window.supabase.createClient(window.KSP_SUPABASE.url,window.KSP_SUPABASE.anonKey);const {data,error}=await withTimeout(supabaseClient.auth.getSession(),8000,'No se pudo comprobar la sesión.');if(error)throw error;session=data.session||null;online=!!session;if(session){try{await withTimeout(loadProfile(),8000,'perfil')}catch(e){console.warn('KSP auth profile:',e.message);profileName=session.user.user_metadata?.username||session.user.email?.split('@')[0]||'Usuario'}setAccountUI();update()}else{profileName=null;setAccountUI();update()}}catch(e){console.warn('KSP auth sync:',e.message)}}
function install(){
  const b=$('confirmTrade');if(b)b.onclick=safeTrade;
  void refresh();void forceSyncAuth();
  if(supabaseClient){
    supabaseClient.auth.onAuthStateChange((event,s)=>{session=s||null;online=!!session;if(session){profileName=session.user.user_metadata?.username||session.user.email?.split('@')[0]||'Usuario';setAccountUI();update();setTimeout(()=>void forceSyncAuth(),0)}else{profileName=null;setAccountUI();update()}});
    supabaseClient.channel('ksp-defensive-live-v5').on('postgres_changes',{event:'UPDATE',schema:'public',table:'companies',filter:'ticker=eq.KD'},p=>{if(p.new&&!busy){state.prev=state.price;state.price=Number(p.new.price);update()}}).subscribe();
  }
}
setTimeout(install,1000);
})();
