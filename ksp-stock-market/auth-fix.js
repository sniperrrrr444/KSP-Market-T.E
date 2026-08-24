/* KSP Market T/E — robust authentication bridge. */
(function(){
  function boot(){
    const form=document.getElementById('authForm'),email=document.getElementById('email'),password=document.getElementById('password'),username=document.getElementById('username'),submit=document.getElementById('authSubmit'),modal=document.getElementById('authModal'),toggle=document.getElementById('toggleAuth'),title=document.getElementById('authTitle'),wrap=document.getElementById('usernameWrap');
    if(!form||!window.supabase||!window.KSP_SUPABASE)return;
    const client=window.supabase.createClient(window.KSP_SUPABASE.url,window.KSP_SUPABASE.anonKey);
    let mode='signup',handling=false;
    const toast=m=>{const t=document.getElementById('toast');if(t){t.textContent=m;t.classList.add('show');clearTimeout(window.__authToast);window.__authToast=setTimeout(()=>t.classList.remove('show'),3500)}};
    const setMode=login=>{mode=login?'login':'signup';title.textContent=login?'Iniciar sesión':'Crear cuenta';submit.textContent=login?'Entrar':'Crear cuenta';wrap.style.display=login?'none':'block';toggle.textContent=login?'Crear una cuenta →':'Ya tengo cuenta → Iniciar sesión';};
    toggle.addEventListener('click',e=>{e.preventDefault();if(!handling)setMode(mode!=='login');});
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(handling)return;
      const em=email.value.trim(),pw=password.value;if(!em||!pw)return toast('Introduce email y contraseña.');
      handling=true;submit.disabled=true;submit.textContent=mode==='login'?'Entrando…':'Creando…';
      try{
        if(mode==='login'){
          const result=await Promise.race([client.auth.signInWithPassword({email:em,password:pw}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('La conexión con el servidor tardó demasiado.')),10000))]);
          if(result.error)throw result.error;if(!result.data?.session)throw new Error('Supabase no devolvió una sesión.');
          window.supabaseClient=client;window.session=result.data.session;window.online=true;window.profileName=result.data.user?.user_metadata?.username||em.split('@')[0];
          try{if(typeof loadProfile==='function')await Promise.race([loadProfile(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('perfil lento')),6000))]);}catch(err){console.warn('Perfil tras login:',err);}
          if(typeof setAccountUI==='function')setAccountUI();if(typeof update==='function')update();modal.classList.add('hidden');toast('Sesión iniciada como '+(window.profileName||'Usuario'));handling=false;submit.disabled=false;submit.textContent='Entrar';return;
        }
        const name=(username.value||em.split('@')[0]).trim();
        const result=await client.auth.signUp({email:em,password:pw});if(result.error)throw result.error;if(!result.data?.user)throw new Error('Supabase no creó el usuario.');
        const {error:pe}=await client.from('profiles').upsert({id:result.data.user.id,username:name,display_name:name},{onConflict:'id'});if(pe)throw pe;
        if(result.data.session){window.supabaseClient=client;window.session=result.data.session;window.online=true;window.profileName=name;try{if(typeof loadProfile==='function')await Promise.race([loadProfile(),new Promise((_,rej)=>setTimeout(()=>rej(new Error('perfil lento')),6000))]);}catch(err){console.warn('Perfil tras registro:',err);}if(typeof setAccountUI==='function')setAccountUI();if(typeof update==='function')update();modal.classList.add('hidden');toast('Cuenta creada como '+name);}else{modal.classList.add('hidden');toast('Cuenta creada. Revisa tu email para confirmar la cuenta.');}
      }catch(err){console.error('KSP auth error',err);toast(err?.message||'No se pudo completar la operación.');}
      finally{handling=false;submit.disabled=false;submit.textContent=mode==='login'?'Entrar':'Crear cuenta';}
    },true);
    setMode(false);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1200));else setTimeout(boot,1200);
})();