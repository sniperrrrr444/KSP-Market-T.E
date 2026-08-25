/* KSP Market T/E — authentication controller. Single capture handler prevents duplicate auth flows. */
(function(){
  const boot=()=>{
    const form=document.getElementById('authForm');
    const email=document.getElementById('email');
    const password=document.getElementById('password');
    const username=document.getElementById('username');
    const submit=document.getElementById('authSubmit');
    const modal=document.getElementById('authModal');
    const toggle=document.getElementById('toggleAuth');
    const title=document.getElementById('authTitle');
    const wrap=document.getElementById('usernameWrap');
    if(!form||!email||!password||!submit||!modal||!toggle||!title||!wrap)return;

    let mode='signup';
    let busy=false;

    const getClient=()=>{
      if(window.supabaseClient)return window.supabaseClient;
      const cfg=window.KSP_SUPABASE||{};
      if(!window.supabase||!cfg.url||!cfg.anonKey)return null;
      window.supabaseClient=window.supabase.createClient(cfg.url,cfg.anonKey);
      return window.supabaseClient;
    };
    const toast=(message)=>{
      const t=document.getElementById('toast');
      if(!t)return;
      t.textContent=message;
      t.classList.add('show');
      clearTimeout(window.__kspAuthToast);
      window.__kspAuthToast=setTimeout(()=>t.classList.remove('show'),4000);
    };
    const setMode=(login)=>{
      mode=login?'login':'signup';
      title.textContent=login?'Iniciar sesión':'Crear cuenta';
      submit.textContent=login?'Entrar':'Crear cuenta';
      wrap.style.display=login?'none':'block';
      toggle.textContent=login?'Crear una cuenta →':'Ya tengo cuenta → Iniciar sesión';
      submit.disabled=false;
    };
    const open=(login)=>{
      setMode(!!login);
      modal.classList.remove('hidden');
      setTimeout(()=>email.focus(),60);
    };
    window.openAuth=open;
    window.setAuthMode=setMode;

    toggle.addEventListener('click',(event)=>{
      event.preventDefault();
      event.stopPropagation();
      if(!busy)setMode(mode!=='login');
    });

    /* Capture at document level: this runs BEFORE app.js's old submit handler. */
    document.addEventListener('submit',async(event)=>{
      if(event.target!==form)return;
      event.preventDefault();
      event.stopPropagation();
      if(event.stopImmediatePropagation)event.stopImmediatePropagation();
      if(busy)return;

      const em=email.value.trim().toLowerCase();
      const pw=password.value;
      if(!em||!pw){toast('Introduce email y contraseña.');return;}
      if(pw.length<6){toast('La contraseña debe tener al menos 6 caracteres.');return;}

      const client=getClient();
      if(!client){toast('El backend online todavía no está disponible.');return;}

      busy=true;
      submit.disabled=true;
      submit.textContent=mode==='login'?'Entrando…':'Creando…';

      try{
        if(mode==='login'){
          const result=await Promise.race([
            client.auth.signInWithPassword({email:em,password:pw}),
            new Promise((_,reject)=>setTimeout(()=>reject(new Error('La conexión con Supabase tardó demasiado.')),12000))
          ]);
          if(result.error)throw result.error;
          const newSession=result.data?.session;
          if(!newSession)throw new Error('Supabase no devolvió una sesión. Comprueba que el correo y la contraseña sean correctos.');

          window.session=newSession;
          window.online=true;
          window.profileName=newSession.user?.user_metadata?.username||newSession.user?.user_metadata?.display_name||em.split('@')[0];
          if(typeof setAccountUI==='function')setAccountUI();
          if(typeof update==='function')update();
          modal.classList.add('hidden');
          toast('Sesión iniciada como '+window.profileName);

          /* Profile loading is deliberately secondary: it can never block login. */
          if(typeof loadProfile==='function'){
            Promise.race([
              loadProfile(),
              new Promise((_,reject)=>setTimeout(()=>reject(new Error('perfil lento')),6000))
            ]).catch(err=>console.warn('KSP: perfil tras login:',err));
          }
          return;
        }

        const name=(username?.value||em.split('@')[0]).trim();
        if(name.length<3){toast('El nombre de usuario debe tener al menos 3 caracteres.');return;}
        if(name.length>20){toast('El nombre de usuario no puede superar 20 caracteres.');return;}

        const result=await client.auth.signUp({email:em,password:pw});
        if(result.error)throw result.error;
        if(!result.data?.user)throw new Error('Supabase no creó el usuario.');

        const {error:profileError}=await client.from('profiles').upsert({
          id:result.data.user.id,
          username:name,
          display_name:name
        },{onConflict:'id'});
        if(profileError)throw new Error('Cuenta creada, pero no se pudo crear el perfil: '+profileError.message);

        if(result.data.session){
          window.session=result.data.session;
          window.online=true;
          window.profileName=name;
          if(typeof setAccountUI==='function')setAccountUI();
          if(typeof update==='function')update();
          modal.classList.add('hidden');
          toast('Cuenta creada como '+name);
        }else{
          modal.classList.add('hidden');
          toast('Cuenta creada. Revisa tu email para confirmar la cuenta.');
        }
      }catch(error){
        console.error('KSP authentication error:',error);
        toast(error?.message||'No se pudo completar el inicio de sesión.');
      }finally{
        busy=false;
        submit.disabled=false;
        submit.textContent=mode==='login'?'Entrar':'Crear cuenta';
      }
    },true);

    setMode(false);
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,300));
  else setTimeout(boot,300);
})();