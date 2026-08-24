/* KSP Market T/E — independent auth fallback. */
(function(){
  function boot(){
    const form=document.getElementById('authForm'),email=document.getElementById('email'),password=document.getElementById('password'),username=document.getElementById('username'),submit=document.getElementById('authSubmit'),modal=document.getElementById('authModal'),toggle=document.getElementById('toggleAuth'),title=document.getElementById('authTitle');
    if(!form||!window.supabase||!window.KSP_SUPABASE)return;
    const client=window.supabase.createClient(window.KSP_SUPABASE.url,window.KSP_SUPABASE.anonKey);let mode='signup';
    const toast=m=>{const t=document.getElementById('toast');if(t){t.textContent=m;t.classList.add('show');clearTimeout(window.__authToast);window.__authToast=setTimeout(()=>t.classList.remove('show'),3500)}};
    function setMode(login){mode=login?'login':'signup';title.textContent=login?'Iniciar sesión':'Crear cuenta';submit.textContent=login?'Entrar':'Crear cuenta';document.getElementById('usernameWrap').style.display=login?'none':'block';toggle.textContent=login?'Crear una cuenta →':'Ya tengo cuenta → Iniciar sesión';}
    toggle.addEventListener('click',e=>{e.preventDefault();setMode(mode!=='login');});
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(submit.disabled)return;const em=email.value.trim(),pw=password.value;if(!em||!pw)return toast('Introduce email y contraseña.');
      submit.disabled=true;submit.textContent=mode==='login'?'Entrando…':'Creando…';
      try{
        if(mode==='login'){
          const {data,error}=await Promise.race([client.auth.signInWithPassword({email:em,password:pw}),new Promise((_,rej)=>setTimeout(()=>rej(new Error('La conexión con el servidor tardó demasiado.')),10000))]);
          if(error)throw error;if(!data.session)throw new Error('Supabase no devolvió una sesión.');toast('Sesión iniciada. Cargando cuenta…');setTimeout(()=>location.reload(),250);return;
        }
        const name=(username.value||em.split('@')[0]).trim();const {data,error}=await client.auth.signUp({email:em,password:pw});if(error)throw error;if(!data.user)throw new Error('Supabase no creó el usuario.');
        const {error:pe}=await client.from('profiles').upsert({id:data.user.id,username:name,display_name:name},{onConflict:'id'});if(pe)throw pe;
        if(data.session){toast('Cuenta creada. Cargando…');setTimeout(()=>location.reload(),250);}else{modal.classList.add('hidden');toast('Cuenta creada. Revisa tu email para confirmar la cuenta.');}
      }catch(err){toast(err?.message||'No se pudo completar la operación.');submit.disabled=false;submit.textContent=mode==='login'?'Entrar':'Crear cuenta';}
    },true);
    setMode(false);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,1200));else setTimeout(boot,1200);
})();
