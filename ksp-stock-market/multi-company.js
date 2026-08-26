/* KSP Market T/E — multi-company layer.
   Keeps the existing KD experience intact while adding dynamically listed companies. */
(() => {
  const money = n => new Intl.NumberFormat('es-ES',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(n)||0) + ' ₡';
  const pct = n => `${Number(n)>=0?'+':''}${Number(n||0).toFixed(2)}%`;
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));
  let companies = [];
  let client = null;

  function toastSafe(text) {
    if (typeof window.toast === 'function') return window.toast(text);
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text; el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }

  function getClient() {
    if (client) return client;
    const cfg = window.KSP_SUPABASE || {};
    if (!cfg.url || !cfg.anonKey || !window.supabase) return null;
    client = window.supabase.createClient(cfg.url, cfg.anonKey);
    return client;
  }

  function ensureStyles() {
    if (document.getElementById('multiCompanyStyles')) return;
    const style = document.createElement('style');
    style.id = 'multiCompanyStyles';
    style.textContent = `
      .company-board{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin:0 0 24px}
      .company-card{border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px;background:linear-gradient(145deg,rgba(15,27,39,.96),rgba(7,14,22,.96));box-shadow:0 10px 30px rgba(0,0,0,.18)}
      .company-card .company-head{display:flex;align-items:center;gap:12px}.company-card .ticker{display:grid;place-items:center;width:46px;height:46px;border-radius:14px;background:rgba(88,224,162,.12);color:#58e0a2;font-weight:800}
      .company-card h3{margin:0;font-size:20px}.company-card small{color:#9aa4b2}.company-card .company-price{font-size:32px;font-weight:800;margin:20px 0 2px}.company-card .company-change{font-weight:700}.company-card .up{color:#58e0a2}.company-card .down{color:#ff6b7a}.company-card .company-meta{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0;color:#9aa4b2;font-size:13px}.company-card .company-actions{display:flex;gap:10px}.company-card button{flex:1;min-height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.1);font-weight:700;cursor:pointer}.company-card .company-buy{background:#58e0a2;color:#06110d;border:0}.company-card .company-sell{background:rgba(255,107,122,.1);color:#ff8792}.company-trade-modal{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.72);display:grid;place-items:center;padding:18px}.company-trade-box{width:min(520px,100%);background:#091522;border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:24px;box-shadow:0 30px 80px rgba(0,0,0,.45)}.company-trade-box h2{margin:6px 0}.company-trade-box input{width:100%;box-sizing:border-box;margin:8px 0 18px;padding:14px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:#eef4ff;color:#111;font-size:18px}.company-trade-actions{display:flex;gap:10px}.company-trade-actions button{flex:1;padding:14px;border-radius:12px;border:0;font-weight:800}.company-trade-cancel{background:#182635;color:#fff}.company-trade-confirm{background:#58e0a2;color:#06110d}
      @media(max-width:600px){.company-board{grid-template-columns:1fr}.company-card{padding:16px}.company-card .company-price{font-size:28px}.company-trade-box{padding:20px}.company-trade-actions{flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function renderBoard() {
    let board = document.getElementById('companyBoard');
    if (!board) {
      board = document.createElement('div');
      board.id = 'companyBoard';
      board.className = 'company-board';
      const marketGrid = document.querySelector('.market-grid');
      marketGrid?.parentNode.insertBefore(board, marketGrid);
    }
    const extra = companies.filter(c => c.ticker !== 'KD');
    board.innerHTML = extra.length ? extra.map(company => {
      const change = Number(company.dailyChange || company.lastChange || 0);
      const signal = company.signal || (change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'NEUTRAL');
      return `<article class="company-card" data-ticker="${esc(company.ticker)}">
        <div class="company-head"><span class="ticker">${esc(company.ticker)}</span><div><h3>${esc(company.name)}</h3><small>${esc(company.sector || 'Empresa cotizada')}</small></div></div>
        <div class="company-price">${money(company.price)}</div>
        <div class="company-change ${signal==='UP'?'up':signal==='DOWN'?'down':''}">${pct(change)} · ${signal}</div>
        <div class="company-meta"><span>Persona vinculada: <b>${esc((company.people||[]).join(', ') || '—')}</b></span></div>
        <div class="company-actions"><button class="company-buy" data-company-buy="${esc(company.ticker)}">Comprar</button><button class="company-sell" data-company-sell="${esc(company.ticker)}">Vender</button></div>
      </article>`;
    }).join('') : '';

    board.querySelectorAll('[data-company-buy]').forEach(b => b.addEventListener('click', () => openTrade(b.dataset.companyBuy,'buy')));
    board.querySelectorAll('[data-company-sell]').forEach(b => b.addEventListener('click', () => openTrade(b.dataset.companySell,'sell')));
  }

  function openTrade(ticker, side) {
    const company = companies.find(c => c.ticker === ticker);
    if (!company) return;
    document.getElementById('companyTradeModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'companyTradeModal';
    modal.className = 'company-trade-modal';
    modal.innerHTML = `<div class="company-trade-box" role="dialog" aria-modal="true">
      <button id="companyTradeClose" style="float:right;background:none;border:0;color:#9aa4b2;font-size:28px;cursor:pointer">×</button>
      <span class="eyebrow">ORDEN DE ${side==='buy'?'COMPRA':'VENTA'}</span>
      <h2>${side==='buy'?'Comprar':'Vender'} ${esc(company.ticker)}</h2>
      <p>${esc(company.name)} · <b id="companyTradePrice">${money(company.price)}</b></p>
      <label>Cantidad<input id="companyTradeQty" type="number" min="1" max="100000" step="1" inputmode="numeric" value="1"></label>
      <p>Total estimado: <b id="companyTradeTotal">${money(company.price)}</b></p>
      <div class="company-trade-actions"><button class="company-trade-cancel" id="companyTradeCancel">Cancelar</button><button class="company-trade-confirm" id="companyTradeConfirm">Confirmar ${side==='buy'?'compra':'venta'}</button></div>
    </div>`;
    document.body.appendChild(modal);
    const qty = document.getElementById('companyTradeQty');
    const total = document.getElementById('companyTradeTotal');
    const refreshTotal = () => total.textContent = money((Number(qty.value)||0) * Number(company.price));
    qty.addEventListener('input', refreshTotal);
    const close = () => modal.remove();
    document.getElementById('companyTradeClose').onclick = close;
    document.getElementById('companyTradeCancel').onclick = close;
    document.getElementById('companyTradeConfirm').onclick = async () => {
      const q = Number(qty.value);
      if (!Number.isInteger(q) || q < 1) return toastSafe('La cantidad debe ser un número entero mayor que 0.');
      const sb = getClient();
      if (!sb) return toastSafe('El backend online no está configurado.');
      const {data: sessionData} = await sb.auth.getSession();
      if (!sessionData?.session) return toastSafe('Inicia sesión para operar online.');
      const btn = document.getElementById('companyTradeConfirm');
      btn.disabled = true; btn.textContent = 'Ejecutando…';
      try {
        const {data, error} = await sb.rpc('place_market_order_by_ticker',{p_ticker:ticker,p_side:side,p_quantity:q});
        if (error) throw error;
        close();
        toastSafe(`${side==='buy'?'Compra':'Venta'} de ${q} ${ticker} ejecutada a ${money(data?.price ?? company.price)}.`);
        await refreshMarket();
      } catch (err) {
        btn.disabled = false; btn.textContent = `Confirmar ${side==='buy'?'compra':'venta'}`;
        toastSafe(`No se pudo ejecutar la orden: ${err?.message || 'error desconocido'}`);
      }
    };
  }

  async function refreshMarket() {
    try {
      const r = await fetch('./market-data.json?' + Date.now(), {cache:'no-store'});
      const d = await r.json();
      companies = Array.isArray(d.companies) ? d.companies : [];
      renderBoard();
    } catch (e) { console.warn('KSP multi-company refresh failed', e); }
  }

  function subscribeRealtime() {
    const sb = getClient();
    if (!sb) return;
    sb.channel('multi-company-live').on('postgres_changes',{event:'*',schema:'public',table:'companies'},payload => {
      const ticker = payload.new?.ticker;
      if (!ticker) return;
      const c = companies.find(x => x.ticker === ticker);
      if (c) { Object.assign(c,{price:Number(payload.new.price),previousPrice:Number(payload.new.previous_close)}); renderBoard(); }
    }).subscribe();
  }

  function start() {
    ensureStyles();
    refreshMarket();
    setInterval(refreshMarket, 30000);
    subscribeRealtime();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
