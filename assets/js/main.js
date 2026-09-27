/* PRTS Boot Sequence (homepage only, once per 5 min) */
function getCookie(n){var m=document.cookie.match("(?:^|; )"+n+"=([^;]*)");
  return m?decodeURIComponent(m[1]):null;}
function setCookie(n,v,h){
  var d=new Date();d.setTime(d.getTime()+h*3600000);
  document.cookie=n+"="+encodeURIComponent(v)+"; expires="+d.toUTCString()+"; path=/";
}
(function(){
  var loader=document.getElementById("loader");
  if(!loader)return;
  var mainWrap=document.getElementById("mainWrap");
  var COOLDOWN=5*60*1000;
  /* <head> 的 gate 已判定命中冷却，CSS 也已让正文直接可见 —— 收尾即可 */
  if(document.documentElement.classList.contains("prts-skip")){
    loader.classList.add("hide");
    if(mainWrap)mainWrap.classList.add("show");
    return;
  }
  var last=getCookie("prts_played");
  /* age<0 表示系统时钟回拨 —— 与 <head> 的 gate 保持同一判定，否则会永久跳过动画 */
  var age=last?(Date.now()-parseInt(last,10)):NaN;
  if(isFinite(age)&&age>=0&&age<COOLDOWN){
    loader.classList.add("hide");
    if(mainWrap)mainWrap.classList.add("show");
    return;
  }
  /* 动画一开始就落 cookie：用户中途离开也不会导致下次重播 */
  setCookie("prts_played",String(Date.now()),24*365);
  var fill=document.getElementById("pFill");
  var ptxt=document.getElementById("pTxt");
  var lines=[
    {id:"l1",text:"> P.R.T.S. NATIVE RHODES ISLAND TERMINAL SERVICE",delay:0},
    {id:"l2",text:"> 罗德岛终端服务",delay:300},
    {id:"l3",text:"> -------------------------------------------",delay:500},
    {id:"l4",text:"> 正在连接至罗德岛主服务器...",delay:700,cls:"dim"},
    {id:"l5",text:"> [  OK  ] 网络连接已建立",delay:1200},
    {id:"l6",text:"> [  OK  ] 加载用户身份认证模块",delay:1500},
    {id:"l7",text:"> [  OK  ] 加密通道已开启 (TLS 1.3)",delay:1800},
    {id:"l8",text:"> [  OK  ] 加载终端界面资源",delay:2100},
    {id:"l9",text:"> [  OK  ] 检索个人档案数据库",delay:2400},
    {id:"l10",text:"> [  OK  ] 同步站点配置",delay:2700},
    {id:"l11",text:"> [  OK  ] 加载完成",delay:3000,cls:"gold"},
    {id:"l12",text:"> ",delay:3200},
    {id:"l13",text:"> 欢迎回来，博士",delay:3400,cls:"gold"},
    {id:"l14",text:"> K-BLACK TERMINAL 已就绪",delay:3600},
    {id:"l15",text:"> ACCESS GRANTED",delay:3800},
    {id:"l16",text:"> [????] Dr.预言家，不准忘記我",delay:4200,cls:"red"},
    {id:"l17",text:"> [PRTS] 我是普瑞賽斯 Priestess",delay:5200,cls:"red"},
  ];
  var total=5800;
  lines.forEach(function(l){
    setTimeout(function(){
      var el=document.getElementById(l.id);
      if(!el)return;
      el.textContent=l.text;
      if(l.cls)el.classList.add(l.cls);
      el.classList.add("show");
      var pct=Math.min(Math.floor((l.delay/total)*100),100);
      fill.style.width=pct+"%";
      ptxt.textContent=pct+"%";
    },l.delay);
  });
  setTimeout(function(){
    fill.style.width="100%";
    ptxt.textContent="100%";
  },5200);
  setTimeout(function(){
    loader.classList.add("hide");
    if(mainWrap)mainWrap.classList.add("show");
  },6000);
})();

/* Nav scroll (homepage only) */
(function(){
  if(location.pathname!=="/"&&location.pathname!=="")return;
  var links=document.querySelectorAll(".nav-links a");
  var mobLinks=document.querySelectorAll(".mob a");
  var ids=["news","profile","links","about"];
  var map={news:"/",profile:"/#profile",links:"/#links",about:"/#about"};
  var spy=function(){
    var c="";
    for(var i=0;i<ids.length;i++){
      var el=document.getElementById(ids[i]);
      if(!el)continue;
      var r=el.getBoundingClientRect();
      if(r.top<=150&&r.bottom>0)c=ids[i];
    }
    if(c==="about"){
      var ab=document.getElementById("about");
      if(ab&&ab.getBoundingClientRect().bottom<window.innerHeight*0.6)c="";
    }
    if(c==="profile"&&window.scrollY<100)c="news";
    links.forEach(function(l){l.classList.toggle("on",l.getAttribute("href")===map[c])});
    mobLinks.forEach(function(l){l.classList.toggle("on",l.getAttribute("href")===map[c])});
  };
  window.addEventListener("scroll",spy,{passive:true});
  window.addEventListener("resize",spy);
  spy();
})();

/* In-page nav (homepage only): scroll instead of full reload */
(function(){
  if(location.pathname!=="/"&&location.pathname!=="")return;
  var all=document.querySelectorAll(".nav-links a,.mob a");
  all.forEach(function(a){
    a.addEventListener("click",function(e){
      var href=a.getAttribute("href")||"";
      if(href==="/"){e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});return;}
      if(href.indexOf("/#")===0){
        e.preventDefault();
        var t=document.getElementById(href.slice(2));
        if(t){t.scrollIntoView({behavior:"smooth"});}
      }
    });
  });
})();

/* Burger */
(function(){
  var b=document.getElementById("burger"),m=document.getElementById("mob");
  if(!b||!m)return;
  b.onclick=function(){b.classList.toggle("open");m.classList.toggle("open");document.body.style.overflow=m.classList.contains("open")?"hidden":""};
  m.querySelectorAll("a").forEach(function(a){a.onclick=function(){b.classList.remove("open");m.classList.remove("open");document.body.style.overflow=""}});
})();

/* Tabs */
(function(){
  var tabs=document.querySelectorAll(".tab"),items=document.querySelectorAll(".news-item");
  tabs.forEach(function(t){t.onclick=function(){
    tabs.forEach(function(x){x.classList.remove("on")});t.classList.add("on");
    var c=t.dataset.t;
    items.forEach(function(i){i.classList.toggle("hide",c!=="all"&&i.dataset.c!==c)});
  }});
})();

/* Reveal */
(function(){
  var els=document.querySelectorAll(".sec-hd,.news-featured,.prof-card,.lnk,.about-card,.news-item,.stack-card");
  els.forEach(function(e){e.classList.add("rv")});
  var obs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)e.target.classList.add("vis")})},{threshold:.1});
  els.forEach(function(e){obs.observe(e)});
})();

/* Code block copy button */
(function(){
  var pres=document.querySelectorAll(".post-content pre");
  pres.forEach(function(pre){
    var wrap=document.createElement("div");
    wrap.className="code-wrap";
    pre.parentNode.insertBefore(wrap,pre);
    wrap.appendChild(pre);
    var btn=document.createElement("button");
    btn.className="copy-btn";
    btn.innerHTML='<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> 复制';
    btn.onclick=function(){
      var code=pre.querySelector("code");
      var text=code?code.textContent:pre.textContent;
      navigator.clipboard.writeText(text).then(function(){
        btn.innerHTML='<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> 已复制';
        btn.classList.add("copied");
        setTimeout(function(){
          btn.innerHTML='<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> 复制';
          btn.classList.remove("copied");
        },2000);
      });
    };
    wrap.appendChild(btn);
  });
})();

/* Hero date */
(function(){
  var el=document.getElementById("heroDate");
  if(!el)return;
  var d=new Date();
  el.textContent=d.getFullYear()+" // "+("0"+(d.getMonth()+1)).slice(-2)+" / "+("0"+d.getDate()).slice(-2);
})();

/* Particles */
(function(){
  var c=document.getElementById("particles");
  if(!c)return;
  for(var i=0;i<20;i++){
    var p=document.createElement("div");
    p.className="particle";
    p.style.left=Math.random()*100+"%";
    p.style.animationDuration=(8+Math.random()*12)+"s";
    p.style.animationDelay=(-Math.random()*20)+"s";
    p.style.width=p.style.height=(1+Math.random()*2)+"px";
    c.appendChild(p);
  }
})();
