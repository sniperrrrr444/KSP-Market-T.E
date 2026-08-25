/* KSP Market T/E — final auth controller.
   Replaces the old form node so previous submit listeners cannot fire twice.
*/
(function(){
  function boot(){
    const oldForm=document.getElementById('authForm');
    const oldToggle=document.getElementById('toggleAuth');
    const modal=document.getElementById('authModal');
    const title=document.getElementById('authTitle');
    const submit0=document.getElementById('authSubmit');
    const wrap=document.getElementById('usernameWrap');
    if(!oldForm||!modal||!title||!submit0||!wrap)return;

    const form=oldForm.cloneNode(true);
    oldForm.replaceWith(form);
    const toggle=oldToggle?oldToggle.cloneNode(true):null;
    if(oldToggle&&toggle)oldToggle.replaceWith(toggle);

    const email=form.querySelector('#email');
    const password=form.querySelector('#password');
    const username=form.querySelector('#username');
    const submit=form.querySelector('#authSubmit');
    let mode='signup',busy=false;

    function toast(msg){
      const t=document.getElementById('toast');
      if(!t)return;
      t.textContent=msg;t.classList.add('show');
      clearTimeout(window.__kspFinalToast);
      window.__kspFinalToast=setTimeout(()=>t.classList.remove('show'),4500);
    }
    function setMode(login){
      mode=login?'login':'signup';
      title.textContent=login?'Iniciar sesión':'Crear cuenta';
      submit.textContent=login?'Entrar':'Crear cuenta';
      wrap.style.display=login?'none':'block';
      if(toggle)toggle.textContent=login?'Crear una cuenta →':'Ya tengo cuenta → Iniciar sesión';
      submit.disabled=false;
    }
    function open(login){
      setMode(!!login);
      modal.classList.remove('hidden');
      setTimeout(()=>email?.focus(),80);
    }
    window.openAuth=open;
    window.setAuthMode=setMode;

    if(toggle)toggle.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(!busy)setMode(mode!=='login');
    });

    form.addEventListener('submit',async e=>{
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(busy)return;
      const em=(email.value||'').trim().toLowerCase(),pw=password.value||'';
      if(!em||!pw)return toast('Introduce email y contraseña.');
      if(pw.length<6)return toast('La contraseña debe tener al menos 6 caracteres.');
      const cfg=window.KSP_SUPABASE||{};
      let client=window.supabaseClient;
      if(!client&&window.supabase&&cfg.url&&cfg.anonKey){
        client=window.supabase.createClient(cfg.url,cfg.anonKey);
        window.supabaseClient=client;
      }
      if(!client)return toast('El backend online todavía no está disponible.');
      busy=true;submit.disabled=true;submit.textContent=mode==='login'?'Entrando…':'Creando…';
      try{
        if(mode==='login'){
          const result=await Promise.race([
            client.auth.signInWithPassword({email:em,password:pw}),
            new Promise((_,rej)=>setTimeout(()=>rej(new Error('Tiempo agotado conectando con Supabase.')),12000))
          ]);
          if(result.error)throw result.error;
          if(!result.data?.session)throw new Error('Supabase no devolvió una sesión.');
          window.session=result.data.session;
          window.online=true;
          window.profileName=result.data.session.user?.user_metadata?.username||result.data.session.user?.user_metadata?.display_name||em.split('@')[0];
          document.getElementById('accountBtn')?.replaceChildren(document.createTextNode('Log out'));
          const cash=document.getElementById('userCash');if(cash)cash.textContent=window.profileName;
          modal.classList.add('hidden');
          toast('Sesión iniciada como '+window.profileName);
          if(typeof loadProfile==='function')Promise.resolve(loadProfile()).catch(()=>{});
        }else{
          const name=(username?.value||em.split('@')[0]).trim();
          if(name.length<3)return toast('El nombre de usuario debe tener al menos 3 caracteres.');
          const result=await client.auth.signUp({email:em,password:pw});
          if(result.error)throw result.error;
          if(!result.data?.user)throw new Error('No se pudo crear la cuenta.');
          const {error:pe}=await client.from('profiles').upsert({id:result.data.user.id,username:name,display_name:name},{onConflict:'id'});
          if(pe)throw new Error('Cuenta creada, pero no se pudo crear el perfil: '+pe.message);
          if(result.data.session){
            window.session=result.data.session;window.online=true;window.profileName=name;
            modal.classList.add('hidden');toast('Cuenta creada como '+name);
          }else{modal.classList.add('hidden');toast('Cuenta creada. Revisa tu email para confirmarla.');}
        }
      }catch(err){console.error(err);toast(err?.message||'No se pudo completar la operación.');}
      finally{busy=false;submit.disabled=false;submit.textContent=mode==='login'?'Entrar':'Crear cuenta';}
    });

    setMode(false);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,50));
  else setTimeout(boot,50);
})();