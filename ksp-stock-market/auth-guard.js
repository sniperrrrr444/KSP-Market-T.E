/* KSP Market T/E — final auth guard. The visible modal state is the single source of truth. */
(function(){
  function boot(){
    const form=document.getElementById('authForm'), modal=document.getElementById('authModal'), title=document.getElementById('authTitle'), submit=document.getElementById('authSubmit'), email=document.getElementById('email'), password=document.getElementById('password'), username=document.getElementById('username'), wrap=document.getElementById('usernameWrap'), toggle=document.getElementById('toggleAuth');
    if(!form||!modal||!title||!submit||!email||!password||!wrap||!toggle)return;
    let busy=false;
    const toast=(m)=>{const t=document.getElementById('toast');if(!t)return;t.textContent=m;t.classList.add('show');clearTimeout(window.__kspFinalToast);window.__kspFinalToast=setTimeout(()=>t.classList.remove('show'),4500)};
    const setMode=(login)=>{title.textContent=login?'Iniciar sesión':'Crear cuenta';submit.textContent=login?'Entrar':'Crear cuenta';wrap.style.display=login?'none':'block';toggle.textContent=login?'Crear una cuenta →':'Ya tengo cuenta → Iniciar sesión';submit.disabled=false;form.dataset.mode=login?'login':'signup'};
    const open=(login)=>{setMode(!!login);modal.classList.remove('hidden');setTimeout(()=>email.focus(),50)};
    window.openAuth=open;window.setAuthMode=setMode;
    toggle.onclick=(e)=>{e.preventDefault();e.stopImmediatePropagation();if(!busy)setMode(title.textContent!=='Iniciar sesión')};
    document.addEventListener('submit',async e=>{
      if(e.target!==form)return;
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      if(busy)return;
      const mode=title.textContent==='Iniciar sesión'?'login':'signup';
      const em=email.value.trim().toLowerCase(),pw=password.value;
      if(!em||!pw)return toast('Introduce email y contraseña.');
      if(pw.length<6)return toast('La contraseña debe tener al menos 6 caracteres.');
      const client=window.supabaseClient||(window.supabase&&window.KSP_SUPABASE?.url?window.supabase.createClient(window.KSP_SUPABASE.url,window.KSP_SUPABASE.anonKey):null);
      if(!client)return toast('El backend online todavía no está disponible.');
      window.supabaseClient=client;busy=true;submit.disabled=true;submit.textContent=mode==='login'?'Entrando…':'Creando…';
      try{
        if(mode==='login'){
          const r=await Promise.race([client.auth.signInWithPassword({email:em,password:pw}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('Supabase no respondió a tiempo.')),12000))]);
          if(r.error)throw r.error;if(!r.data?.session)throw new Error('No se recibió una sesión.');
          window.session=r.data.session;window.online=true;window.profileName=r.data.session.user?.user_metadata?.username||r.data.session.user?.user_metadata?.display_name||em.split('@')[0];
          if(typeof setAccountUI==='function')setAccountUI();if(typeof update==='function')update();modal.classList.add('hidden');toast('Sesión iniciada como '+window.profileName);
          if(typeof loadProfile==='function')Promise.race([loadProfile(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('perfil lento')),6000))]).catch(console.warn);
        }else{
          const name=(username?.value||em.split('@')[0]).trim();if(name.length<3||name.length>20)return toast('El nombre de usuario debe tener entre 3 y 20 caracteres.');
          const r=await client.auth.signUp({email:em,password:pw});if(r.error)throw r.error;if(!r.data?.user)throw new Error('Supabase no creó el usuario.');
          const p=await client.from('profiles').upsert({id:r.data.user.id,username:name,display_name:name},{onConflict:'id'});if(p.error)throw new Error('Cuenta creada, pero el perfil falló: '+p.error.message);
          if(r.data.session){window.session=r.data.session;window.online=true;window.profileName=name;if(typeof setAccountUI==='function')setAccountUI();if(typeof update==='function')update();}
          modal.classList.add('hidden');toast(r.data.session?'Cuenta creada como '+name:'Cuenta creada. Revisa tu email para confirmar.');
        }
      }catch(err){console.error('KSP auth:',err);toast(err?.message||'No se pudo iniciar sesión.');}
      finally{busy=false;submit.disabled=false;submit.textContent=title.textContent==='Iniciar sesión'?'Entrar':'Crear cuenta';}
    },true);
    setMode(false);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();