(function(){
  const y=document.getElementById('year'); if(y) y.textContent = new Date().getFullYear();
  const b=document.getElementById('themeToggle'); const r=document.documentElement;
  const s=localStorage.getItem('theme'); if(s) r.setAttribute('data-theme', s);
  b?.addEventListener('click',()=>{ const c=r.getAttribute('data-theme')||'system';
    const n=c==='light'?'system':c==='system'?'dark':'light';
    r.setAttribute('data-theme',n); localStorage.setItem('theme',n);
  });
})();