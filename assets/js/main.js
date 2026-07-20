/* PRTS Boot Sequence */
(function(){
  var loader=document.getElementById("loader");
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
    document.getElementById("mainWrap").classList.add("show");
  },6000);
})();

/* Nav scroll */
(function(){
  var links=document.querySelectorAll(".nav-links a"),ids=["news","profile","links","about"];
  window.onscroll=function(){
    var c="";ids.forEach(function(id){var el=document.getElementById(id);if(el&&el.getBoundingClientRect().top<=200)c=id});
    links.forEach(function(l){l.classList.toggle("on",l.getAttribute("href")==="#"+c)});
  };
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
  var els=document.querySelectorAll(".sec-hd,.news-featured,.prof-card,.lnk,.about-card,.news-item");
  els.forEach(function(e){e.classList.add("rv")});
  var obs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)e.target.classList.add("vis")})},{threshold:.1});
  els.forEach(function(e){obs.observe(e)});
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
