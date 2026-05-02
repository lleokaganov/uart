DESIGN={};

function getScrollH() { return window.pageYOffset; }
function getScrollW() { return window.pageXOffset; }
function getWinW() { return window.innerWidth; }
function getWinH() { return window.innerHeight; }
function getDocH() { return document.documentElement.scrollHeight; }
function getDocW() { return document.documentElement.scrollWidth; }

function f5_save(key, value, storage) {
    try { window[storage?'sessionStorage':'localStorage'].setItem(key, value); return true; }
    catch(er) { console.error(er); return false; }
}

function f5_read(key, def, storage) {
    try { const val = window[storage?'sessionStorage':'localStorage'].getItem(key); return (val === null ? def : val); }
    catch(er) { console.error(er); return false; }
}

function f5_del(key, storage) {
    try { window[storage?'sessionStorage':'localStorage'].removeItem(key); return true; }
    catch(er) { console.error(er); return false; }
}

function f5_all(storage) {
  const items = {}, st = storage?'sessionStorage':'localStorage';
  for(let i=0; i<window[st].length; i++) {
    const key = window[st].key(i);
    items[key] = window[st].getItem(key);
  }
  return items;
}

// ============================================================================

time=function(){ return new Date().getTime(); };

unixtime2str = function(x,s='Y-m-d H:i:s') { // convert unixtime to string
    var d = new Date(x * 1000); // Convert Unix time to milliseconds
    function dd(x) { return ("0"+x).slice(-2) }
    return s.replace('Y',d.getFullYear())
        .replace('m',dd(d.getMonth()+1) ) // Months are zero-based
        .replace('d',dd(d.getDate()) )
        .replace('H',dd(d.getHours()) )
        .replace('i',dd(d.getMinutes()) )
        .replace('s',dd(d.getSeconds()) );
};

//==========

function plays(url,silent){ // silent: 1 - только загрузить, 0 - петь, 2 - петь НЕПРЕМЕННО, невзирая на настройки
    var audio = new Audio(url);
    audio.muted = silent==1;
    audio.play();
}

h=function(s){
    return (''+s).replace(/\&/sg,'&'+'amp;').replace(/\</sg,'&'+'lt;').replace(/\>/sg,'&'+'gt;').replace(/\'/sg,'&'+'#039;').replace(/\"/sg,'&'+'#034;'); // '
}

/*********************** majax ***********************/
var ajaxgif = "<img src='img/ajax.gif'>";

//=======================================================
// скопировать
cpbuf=function(e,message){ if(typeof(e)=='object') e=e.innerHTML; // navigator.clipboard.writeText(e);
    var area = document.createElement('textarea');
    document.body.appendChild(area);
    area.value = e;
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    if(message===undefined) message=1000;
    if(message) salert(`<div style='font-size:12px'>Copied to clipboard</div>

<p><textarea style="max-width:300px; height:80px; font-size:10px;">${h(e)}</textarea>
`,1*message);
};

/*****************************/
lightgreen=function(s) { return "<font color='"+arguments.callee.name+"'>"+s+"</font>"; }
green=function(s) { return "<font color='"+arguments.callee.name+"'>"+s+"</font>"; }
red=function(s) { return "<font color='"+arguments.callee.name+"'>"+s+"</font>"; }
blue=function(s) { return "<font color='"+arguments.callee.name+"'>"+s+"</font>"; }

// новые функции DOM чтоб не стыдно было за быдлоимена

dom=(e,text)=>{
    if(e?.nodeName) return e;
    if(text!=undefined) dom.s(e,text);
    else return document[(''+e).startsWith('.')?'querySelector':'getElementById'](e);
};

dom.s=(e,text)=>{
    if(!(e?.nodeName)) {
        if(e.indexOf && e.indexOf('.')===0) return document.querySelectorAll(e).forEach(l=>l.innerHTML=text);
        e=dom(e);
    } if(!e) return '';
    if(text==undefined) return e.value!=undefined ? e.value : e.innerHTML;
    if(e.value!=undefined) e.value=text;
    else { if(e.innerHTML!=undefined) e.innerHTML=text; } // init_tip(e);
};
dom.add=(e,s,ara)=>{ newdiv(s,ara,dom(e),'last'); };
dom.add1=(e,s,ara)=>{ newdiv(s,ara,dom(e),'first'); };
dom.on=(e)=>{ if(e=dom(e)) e.style.display='block'; };
dom.off=(e)=>{ if(e=dom(e)) { e.style.display='none'; if(e.id!='tip') dom.off('tip'); } };
dom.toggle=(e)=>{ if(e=dom(e)) { e.style.display = e.style.display==='none' ? 'block' : 'none'; if(e.id!='tip') dom.off('tip'); } };
dom.class=(e,text)=>{ document.querySelectorAll( e.indexOf('.')===0?e:'.'+e ).forEach(l=>l.innerHTML=text) };

// mpers

mpersf=async function(file,ar){
    if(typeof("MPERS_TEMPLATES")!='object') MPERS_TEMPLATES={};
    if(!MPERS_TEMPLATES[file]) MPERS_TEMPLATES[file] = await loadFile(file);
    return mpers(MPERS_TEMPLATES[file],ar);
};

mpers=function(s,ar,del){ if(del==undefined) del=true;
    var stop=1000,s0=false,c;
    while(--stop && s0!=s && (c=mpers.find(s)) ) {
	s0=s;
	var c0=c.substring(1,c.length-1); // то, что в фигурных скобках
	x=mpers.do(ar, c0, del);
	if(x!==false) {
	    s=s.replace(c,x);
	} else {
	    var c1=mpers(c0,ar,del);
	    if(c1!=c0) s=s.replace(c0,c1);
	}
    }
    return s;
};

mpers.ar=function(ar,name){
 try {
    var v = ar;
    if(name=='') return ar;
    name.split('.').forEach(n => {
	if(typeof(v[n])==undefined) return undefined;
	v = v[n];
    });
    return v;
 } catch(er) { return undefined; }
},

mpers.do=function(ar,s,del) {

    var m,v,x='',X;

    // Простые переменные {name}, {#name}
    if(null !== (m=s.match(/^(\#|)([0-9a-zA-Z_\.]+)$/)) ) {
	var [,mod,name] = m;
	if((v=mpers.ar(ar,name))===undefined) return (del ? '' : '{'+s+'}');
	return (mod=='#' ? h(v) : v);
    }

    // Операторы {opt(name):value} if(), for(), case(), date()
    if(null !== (m = s.match(/^([a-z]+)\(([0-9a-zA-Z_\.]*)\)\:([\s\S]*)/m) ) ) {
	var [,opt,name,value] = m;
	v=mpers.ar(ar,name);

	const vif = (
	    v === undefined || v === null || v === 0 || v === false
	    || (typeof v === "string" && ["0","false","null","undefined"].includes(v))
	) ? 0 : 1;

	if(opt=='noif') return (vif ? '' : value);
	if(opt=='if') return (vif ? value : '');

	if(opt=='case') {
	    var st=100, c;
	    while(--st && (c=mpers.find(value)) ) {
		if(null !== (m=c.match(/^\{([^\:]*)\:([\s\S]*)\}$/m)) ) {
		    var [,id,val] = m;
		    if(id==v) return val;
		    if(id==(''+v)) return val;
		    if(id=='*'||id=='default') x=val;
		}
		value = value.replace(c,'');
	    }
	    return x;
	}

	if(v===undefined) return '';

	if(opt=='for') {
	    try { // [!!!]
		v.forEach((item,i)=> { x+=mpers( value ,{...ar, ...item, ...{i:i,i1:i+1,item:item} }); } );
	    } catch(e) {
	        console.error('mpers '+e+'\nfor('+name+'){\n'+value+'\n}');
	        console.error('v('+typeof(v)+')=');
	        console.error(v);
	        console.error('-------- ar:');
	        console.error(ar);
	    }
	    return x;
	}

	if(opt=='date') { // date(time)Y-m-d H:i:s
	    return unixtime2str(v,value);
	}

	return false; // не наш случай
    }

    // {oper:text}
    if(null !== (m=s.match(/^([0-9a-z\#\.]+)\:([\s\S]*)/m)) ) {
     var [,oper,text] = m;

     // операции с текстом
     if(oper=='no') return '';

     // операции с текстом или переменной
     v = mpers.ar(ar,text);

     // stringify массива
     if(oper=='stringify') return JSON.stringify(v);

     x = (v!==undefined ? v : text);
     if(oper=='#') return h_fs(x);
     if(oper=='nl2br') return x.replace(/\n/g,"<br/>");
     if(oper=='#nl2br') return h_fs(x).replace(/\n/g,"<br/>"); // \n в <br\> и еще экранировать HTML-сущности
     if(oper=='url'||oper=='urlencode') return encodeURIComponent(x);
     if(oper=='urldecode') return x=decodeURIComponent(x);

     // операции с переменной
     if(! /^[0-9a-z_\.]+$/.test(text) ) return false; // не имя переменной
     if(v===undefined) return ''; // нет переменной в массиве
     if(oper=='c') return v.replace(/^\s+/g,'').replace(/\s+$/g,'');
     if(oper=='length') return v.length; // число символов в тексте
     if(oper=='date') return unixtime2str(v,'Y-m-d H:i:s'); // число в дату
     if(oper=='dat') return unixtime2str(v,'Y-m-d H:i'); // число в дату без секунд
     if(oper=='day') return unixtime2str(v,'Y-m-d'); // число в дату дня
    //  if(oper=='.') return (1*v).toFixed(0); // {.00:}123.456 -> 123.4
    //  if(oper=='.0') return (1*v).toFixed(1); // {.00:}123.456 -> 123.4
    //  if(oper=='.00') return (1*v).toFixed(2); // 123.456 -> 123.45
    //  if(oper=='.0000') return (1*v).toFixed(4); // 123.456 -> 123.4560
        if (oper.includes('.')) {
            const [i,f=''] = oper.split('.');
            const [ii,ff=''] = (+v).toFixed(f.length).split('.');
            return ii.padStart(i.length,'0') + (f ? '.'+ff : '');
        }

     return false;
    }

    return false;
};

// Поиск содержимого между парными скобками
mpers.find = function(s){
    var k, start=0, i, a,b, stop=1000, len=s.length;
    while( --stop ) {
	    k=1, start=s.indexOf('{',start); // }
	    if(start<0) return false;

	    i=start+1;
	    while( --stop && k!=0 && i<len ) { // пока есть чо
		a = s.indexOf('{',i); if( a<0 ) a=len;
		b = s.indexOf('}',i); if( b<0 ) b=len;
		if(a==b) break;
		if(a<b) { k++; i=a+1; } else { k--; i=b+1; }
	    }
	    if(!stop) console.log(`mpers.fing stop1 > 1000`);
	    if(k==0) return s.substring(start,i);
	    start++;
    }
    console.log(`mpers.fing stop > 1000`);
    return false;
};



// ajaxon=ajaxoff=function(){};

// ajaxon=function(){ alert(1); };
// ajaxoff=function(){ alert(2); }

function sizer(x,p=2) { var i=0; for(;x>=1024;x/=1024,i++){} return Math.round(x,p)+['b','Kb','Mb','Gb','Tb','Pb'][i]; } // если отправка более 30кб - показывать прогресс

// progress.run(0, function(){ alert('Error: timeout'); });
// progress.stop(1);
progress = {
    total: 30000,
    now: 0,
    timeout: 100,
    id: 0,
    fn: function(){},
    run: function(x, fn) {

            if(x===0) { progress.now=0; progress.fn=function(){}; }
            if(fn) progress.fn=fn;

	    if(dom('progress_info')) dom('progress_info', 1*progress.now+' '+1*progress.timeout);

            if(x!=undefined && !progress.id) progress.id=setInterval(progress.run,progress.timeout);

            progress.now += progress.timeout;

            if(progress.now >= progress.total) {
                    clearInterval(progress.id); progress.id=false;
                    return progress.fn();
            }

	    progress.set( Math.floor(100*progress.now/progress.total) );
    },
    stop: function() {
        let q=dom('progress'); if(q) document.body.removeChild(q);
        if(progress.id) { clearInterval(progress.id); progress.id=false; }
    },
    set: function(prc){
        prc = Math.max(0, Math.min(100, prc|0));

        let p = document.getElementById('progress');
        if(!p){
            p = document.createElement('div');
            p.id = 'progress';
            p.innerHTML = `
            <div class="bar">
                <div class="fill"></div>
                <div class="label"></div>
            </div>`;
            document.body.appendChild(p);

            const st = document.createElement('style');
            st.textContent = `
#progress{position:fixed;left:0;bottom:0;width:100%;height:20px;z-index:99999}
#progress .bar{position:relative;height:100%;border:1px solid #666;background:#fff;overflow:hidden}
#progress .fill{height:100%;width:0%;
  background:linear-gradient(to right, #0a0, #ff0, #f00);
  background-repeat:no-repeat;
  background-position:left top;
  background-size:100% 100%;
}
#progress .label{position:absolute;left:0;top:0;width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;
  font:18px/20px sans-serif;color:#000;pointer-events:none;
}`;
            document.head.appendChild(st);
            // чтобы при ресайзе не “плыла карта цветов”
            window.addEventListener('resize', () => progress.set(prc));
        }

        const bar = p.querySelector('.bar');
        const fill = p.querySelector('.fill');
        const label = p.querySelector('.label');

        fill.style.width = prc + '%';
        // вот ключ: градиент “натянут” на ПОЛНУЮ ширину бара, а не на fill
        fill.style.backgroundSize = bar.clientWidth + 'px 100%';
        label.textContent = prc + '%';
    }

};







/* log console */

if(!window.dier) idie=dier=function(a,head){
    var s='';
    if(typeof(a) != 'object') s = h(a);
    else for(var i in a) s+=`<div>${h(i)}: ${h(a[i])}</div>`;
    dialog(s,head?head:'idie',{id:'idie'});
};

const www_design="./";

const mp3imgs={play:www_design+'img/play.png',pause:www_design+'img/play_pause.png',playing:www_design+'img/play_go.gif'};

stopmp3x=function(ee){ ee.src=mp3imgs.play; setTimeout("clean('audiosrcx_win')",50); };

changemp3x=function(url,name,ee,mode,viewurl,download_name) { //  // strt

    var ras = url.split('.').pop().toLowerCase();
    url = url.split('?')[0];

    var start=0,e;
    var s=name.replace(/^\s*([\d\:]+)\s.*$/gi,'$1'); if(s!=name&&-1!=s.indexOf(':')) { s=s.split(':'); for(var i=0;i<s.length;i++) start=60*start+1*s[i]; }

    var WWH="style='width:"+(Math.floor((getWinW()-50)*0.9))+"px;height:"+(Math.floor((getWinH()-50)*0.9))+"px;'";

    if(/(youtu\.be\/|youtube\.com\/)/.test(url) || (url.indexOf('.')<0 && /(^|\/)(watch\?v\=|)([^\s\?\/\&]+)($|\"|\'|\?.*|\&.*)/.test(url))) { // "

	var tt=url.split('?start=');
	if(tt[1]) { start=1*tt[1]; url=tt[0]; } // ?start=1232343 в секундах
	else {
	  var exp2=/[\?\&]t=([\dhms]+)$/gi; if(exp2.test(url)) { var tt=url.match(exp2)[0]; // ?t=7m40s -> 460 sec
	    if(/\d+s/.test(tt)) start+=1*tt.replace(/^.*?(\d+)s.*?$/gi,"$1");
	    if(/\d+m/.test(tt)) start+=60*tt.replace(/^.*?(\d+)m.*?$/gi,"$1");
	    if(/\d+h/.test(tt)) start+=3600*tt.replace(/^.*?(\d+)h.*?$/gi,"$1");
	  }
	}

	if(-1!=url.indexOf('://youtu') || -1!=url.indexOf('://www.youtu')) url=url.match(/(youtu\.be\/|youtube\.com\/)(embed\/|watch\?v\=|)([^\?\/]+)/)[3];

	return ohelpc('audiosrcx_win','YouTube '+h(name),"<div id=audiosrcx><center>\
<iframe "+WWH+" src=\"https://www.youtube.com/embed/"+h(url)+"?rel=0&autoplay=1"+(start?'&start='+start:'')+"\" frameborder='0' allowfullscreen></iframe>\
</center></div>");
    }

    else if(['mp4','avi','webm','mkv'].includes(ras)) s='<div>'+name+'</div><div><center><video controls autoplay id="audiidx" src="'+h(url)
	+'" width="640" height="480"><span style="border:1px dotted red">ВАШ БРАУЗЕР НЕ ПОДДЕРЖИВАЕТ MP4, МЕНЯЙТЕ ЕГО</span></video></center></div>';

    else if(['jpg','jpeg'].includes(ras)) { // panorama JPG
	s='<div>'+name+"</div><div id='panorama' "+WWH+"></div>";
	ohelpc('audiosrcx_win','<a class=r href="'+h(url)+'" title="download">'+h(url.replace(/^.*\//g,''))+'</a>','<div id=audiosrcx>'+s+'</div>');
	return LOADS(["//cdnjs.cloudflare.com/ajax/libs/three.js/r69/three.min.js",wwwhost+'extended/panorama.js'],function(){panorama_jpg('panorama',url)});
    }

    else s='<div><center><audio controls autoplay id="audiidx"><source src="'+h(url)
	+'" type="audio/mpeg; codecs=mp3"><span style="border:1px dotted red">ВАШ БРАУЗЕР НЕ ПОДДЕРЖИВАЕТ MP3, МЕНЯЙТЕ ЕГО</span></audio></center></div>';

    if(!viewurl) viewurl=url.replace(/^.*\//g,'');
    if(!download_name) download_name=url.replace(/^.*\//g,'');

    if(e=dom('audiidx')) {
        if(ee && ee.src && -1!=ee.src.indexOf('play_pause')){ ee.src=mp3imgs.playing; return e.play(); }
        if(ee && ee.src && -1!=ee.src.indexOf('play_go')){ ee.src=mp3imgs.pause; return e.pause(); }
        dom('audiosrcx',s);
        posdiv('audiosrcx_win',-1,-1);
        e=dom('audiidx');
        e.currentTime=start;
    } else {
        ohelpc('audiosrcx_win','<a class=r href="'+h(url)+'" title="Download: '+h(download_name)+'" download="'+h(download_name)+'">'+h(viewurl)+'</a>','<div id=audiosrcx>'+s+'</div>');
        e=dom('audiidx');
        e.currentTime=start;
    }

    if(ee) addEvent(e,'ended',function(){ stopmp3x(ee) });
    if(ee) addEvent(e,'pause',function(){ if(e.currentTime==e.duration) stopmp3x(ee); else ee.src=mp3imgs.pause; });
    if(ee) addEvent(e,'play',function(){ ee.src=mp3imgs.playing; });
}


async function INIT() {
//    init_tip = center = function(){};
//    ohelpc=function(id,header,s) { dialog(s,header,{id:id}); }
    clean=function(e){ if(typeof(e)==='string') e=dom(e); if(e) e.remove(); }

    salert = function(l,t) {
        var header,k=l.indexOf('<p>');
        if(k>=0) {
            header=l.substring(0,k);
            l=l.substring(k+3);
        } else {
            header='&nbsp;';
        }
        var id=dialog(l,header,{id:'salert'});
        if(t) setTimeout(()=>{dialog.close(id)},t);
        return false;
    };

    // Escape button
    document.addEventListener('keydown', function(event) {
        if(event.key === 'Escape') {
            var p = document.querySelectorAll('div.dialog');
            if(p.length > 0) setTimeout(()=>{ dialog.close(p[p.length-1]) }, 10); // Удаляем самый верхний открытый
	    return
        }
	// Ctrl+Enter
	if(event.ctrlKey && event.key === 'Enter') {
	    var p = document.querySelectorAll("[name='save']");
	    if(p && p[0]) p[0].click();
	}
    });

    // Get Design
    dom('template').querySelectorAll('.template').forEach(e=> DESIGN[e.getAttribute('name')]=e.innerHTML.replace(/<!-- *([^ ]+) *-->/g,'$1') );
    dom('template').remove();
}

dialog=function(s,header,set) {
    if(!set) set={};
    var id, e;
    if(set.id) {
	    id = set.id;
        e = dom(id);
        let el = e?.querySelector('.dialog-content');
	    if(el) { el.innerHTML = s; return id; }
        if(e) e.remove();
    } else {
        id = 'dialog_'+(++dialog.id);
    }
    e = document.createElement('div'); // dialog
    e.className='dialog';
    e.id = id;
    e.innerHTML = mpers(DESIGN.dialog,{
        body:s,
        id:id,
        set:set,
        header: header,
        color: set.color || 'light'
    }); // light dark
    document.body.appendChild(e);
    setTimeout(function(){ e.querySelector('.popup-overlay').classList.add('active'); },10);
    e.querySelector('.popup-close').addEventListener('click', function(event) {	dialog.close(id); });
    return id;
};
dialog.id=0;
dialog.close=function(e) {
    (typeof(e)=='object' ? [e] : document.querySelectorAll( e ? '#'+e : 'div.dialog') ).forEach(x=>{
        x.querySelector('.popup-overlay').classList.remove('active');
        setTimeout(() => { x.remove(); }, 300); // Таймаут для завершения анимации
    });
};

async function my_confirm(text, opt) {
    if(typeof(opt)!='object') opt={};
    if(!opt.yes) opt.yes='Yes';
    if(!opt.no) opt.no='No';
    var id='confirm_'+(''+Math.random()).replace('.','-');
    return new Promise((resolve) => {
        dialog(mpers(DESIGN.confirm,opt),mpers(DESIGN.confirm_header,{text:text}),{id:id});
        dom('my-confirm-yes').onclick = () => { dialog.close(id); resolve(true); };
        dom('my-confirm-no').onclick = () => { dialog.close(id); resolve(false); };
    });
}

async function my_prompt(text, opt) {
    if (typeof opt != 'object') opt = {};
    opt = {...{
            header: 'Enter parameter',
            default: '',
            placeholder: '',
            enter: 'Submit',
            id: 'prompt_' + ('' + Math.random()).replace('.', '-')
    },...opt};
    return new Promise((resolve) => {
        dialog(mpers(DESIGN.enter_dialog, { text: text, opt }), opt.header, { id: opt.id });
        dom(opt.id).querySelector('.my-prompt-input').focus();
        dom(opt.id).querySelector('.my-prompt-button').onclick = () => {
            const v = dom(opt.id).querySelector('.my-prompt-input').value;
            dialog.close(opt.id);
            resolve(v);
        };
    });
}

// ==============================================

err = function(s) {
    if(window.log?.err) log.err(`Fatal error: ${s}`);
    dialog(s,'Error',{id:'error_dialog',color:'dark'});
};

h_fs=function(s){
    s=h(s);
    return s.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
}

// ==============================================

const loaded = new Set();
async function load_jscss(url) {
    if (loaded.has(url)) return;
    loaded.add(url);

    return new Promise((res, rej) => {
        let el;
        if (url.indexOf('.css') >= 0) { // endsWith('.css')) {
            el = document.createElement('link');
            el.rel = 'stylesheet';
            el.href = url;
        } else {
            el = document.createElement('script');
            el.src = url;
            el.defer = true;
        }
        el.onload = res;
        el.onerror = rej;
        document.head.appendChild(el);
    });
}

async function LOADS(urls) {
    for (const url of (typeof urls === 'string' ? [urls] : urls)) {
        await load_jscss(url);
    }
}

window.addEventListener("load", INIT);
