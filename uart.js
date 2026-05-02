UART={
    uart_set: {},

    test_i: 0,

    mas: {},
    ref: {},

    init: ()=>{

	document.querySelectorAll('.set').forEach(e=>{
	    const l='opt_'+e.closest('label').textContent.trim();
	    UART[l] = e.checked = localStorage.getItem(l)=='yes';
	    if(UART.optrun[l]) UART.optrun[l](e.checked);
	    e.onchange = (ev) => {
		localStorage.setItem(l, (UART[l]=ev.target.checked) ? 'yes':'no');
		if(UART.optrun[l]) UART.optrun[l](ev.target.checked);
	    };
	});

	document.querySelectorAll('.uart_set').forEach(e => {
	    const name = e.getAttribute('name');
	    const isN = ["baudRate","dataBits","stopBits","demoTimeout"].includes(name);
	    const l = 'opt_uart_' + name;
	    let v = localStorage.getItem(l);
	    if (v === null) {
		e.querySelectorAll('option').forEach(ee=>{ if(ee.selected) v=ee.value; });
	    }
	    e.value = v;
	    UART.uart_set[name] = isN ? +v : v;
	    e.onchange = (ev) => {
		const v = ev.target.value;
		UART.uart_set[name] = isN ? +v : v;
		localStorage.setItem(l, v);
		if(UART.optrun[name]) UART.optrun[name](v);
	    };
	});

	document.querySelectorAll('TEXTAREA').forEach(e=>{
	    const l = `textarea_${e.id}`;
	    e.value=localStorage.getItem(l) || '';
	    e.onchange = (ev) => localStorage.setItem(l, ev.target.value);
	});

	let r = dom('answers').value; if(r.trim()=='') r=undefined;
        UART.load_answers(r);

	UART.connect();
    },

    optrun:{
	opt_bat: (x)=>{ dom[x?'on':'off']('battery'); },
	opt_station: (x)=>{ dom[x?'on':'off']('station'); },
	opt_answer: (x)=>{ dom[x?'on':'off']('answer'); },
	opt_diff: (x)=>{ dom[x?'on':'off']('diff'); },
    },

    isHex: (s) => {
        const parts = s.trim().split(/\s+/);
        let h = false;
        for (const p of parts) {
            if (/[A-Fa-f]/.test(p)) return true;   // встретили букву → HEX
    	    if (p.length !== 2) return false;     // не 2 символа → DEC
	}
	return true; // все группы по 2 цифры → считаем HEX, а если хочешь DEC, рисуй лишние 012
    },

    toHex: (s) => {
	s = s.trim();
	var header = '';
	if( /^[0-9A-Fa-f]{4}\-[0-9A-Fa-f]{2} /.test(s) ) {
	    var [header, ...s] = s.split(/\s+/);
	    s = s.join(' ');
	    header = `${header} `;
	}
	if(!UART.isHex(s)) s = s.split(/\s+/).map(n => UART.X(n)).join(" ");
	return header+s;
    },

    load_answers: async (r) => {
	if(r===undefined) {
	    const name = "answers.txt";
	    var r = await UART.loadfile(name);
	    if(!r) { alert('error file: '+name); return; }
	}
	let out={}, outs = [];
	r.split("\n").forEach(l=>{
	    l=l.trim();
	    if(l.indexOf('=>')<0 || l.startsWith('#')) return;
	    l=l.replace(/[\[\]]+/g,'').replace(/\s+/g,' ');
	    var [a,b] = l.split('=>');
	    a = UART.toHex(a);
	    b = UART.toHex(b);
	    out[a] = b;
	    outs.push(`${a} => ${b}`);
	});
	UART.answer = out;
	dom("answers").value=r;
	dom("answers2", outs.join("\n\n"));
	console.log(out);
    },

    loadfile: async (name) => {
	const response = await fetch(name);
	if(!response.ok) throw new Error('Ошибка загрузки');
	const text = await response.text();
	return text;
    },

    testing: async (name) => {
	const is_can = name.indexOf('can_')==0;

	if(!UART[name]) {
	    console.log('load: '+name);
	    var r = await UART.loadfile(name);
	    if(!r) { alert('error file: '+name); return; }
	    if(is_can) {
		r = r.trim().split('\n');
		UART[name] = r;
	    } else {
		r = r.replace('\n',' ');
		UART[name] = Uint8Array.from( r.trim().split(/\s+/).map(h => parseInt(h, 16)) );
	    }
	}

        if(UART.test_i >= UART[name].length) { UART.test_i=0; console.log(`File ${name} DONE`); return; }
	let value;

        console.log(' part: ',UART.test_i);

	if(is_can) {
	    value = '';
	    if(UART.uart_set.demoTimeout) value = UART[name][UART.test_i++]+'\n';
	    else {
		while (value.length < 4000 && UART[name][UART.test_i] !== undefined) value += UART[name][UART.test_i++]+'\n';
	    }
        } else {
	    let ln = 600; // Math.floor(Math.random()*10);
    	    value = new Uint8Array( UART[name].slice(UART.test_i,UART.test_i + ln) );
    	    UART.test_i += ln;
	}

	const opt = {name, cantxt: is_can};
	await UART.do(value,opt);

	// Ждем пока что-то передаст другое
	while (UART.send_busy) { await new Promise(r => setTimeout(r, 1)); }
	setTimeout(()=>{UART.testing(name)}, UART.uart_set.demoTimeout || 10);
    },

    pr: (s,name,color,raw)=>{
	name = name || 'log';
	// console.log(s);
	let log = document.getElementById(name);
	if(!log) {
	    let d = document.createElement("div");
	    d.className = 'log_d';
	    d.innerHTML = `
		<div class='log_header'>${name} (<span id='${name}_counter' class='log_counter'>1</span>)</div>
		<button class="btn_del" onclick='this.parentNode.remove()'>&#10005;</button>
		<pre id="${name}" class="log_console" EEEonclick='cpbuf(this.textContent)'></pre>
	    `;
	    document.body.appendChild(d);
	    if(name.indexOf('text ')==0) {
	        d.querySelector('.log_console').style.maxHeight='600px';
	    }

	    log = document.getElementById(name);
	}

	const atBottom = log?.scrollTop + log?.clientHeight >= log?.scrollHeight;

	let counter = document.getElementById(`${name}_counter`);
        if(s=="clear") {
	    counter.textContent = 0;
	    log.textContent = "";
	} else {
	    counter.textContent = 1*counter.textContent + 1;
	    // log.textContent += s;
	    // if(raw) raw=`document.getElementById('ta').value='${UART.P(raw)}'`;
	    if(color) s=`<font color='${color}' onclick="${raw}">${s}</font>`;
	    log.innerHTML += s;
	    // ограничиваем лог
	    let cx = 1000;
	    let lines = log.innerHTML.split('\n');
	    if (lines.length > cx) log.innerHTML = lines.slice(-cx).join('\n');
	}

	if(atBottom) log.scrollTop = log.scrollHeight - log.clientHeight;
    },

    decoder: new TextDecoder("utf-8"),
    buffer: new Uint8Array(0),

    connect: async ()=>{
	if(!navigator?.serial) {
	    dom('uart_state','Serial not supported, use Chrome Desktop');
	    dom('uart_state').style.color='red';
	    dom.on('uart_state');
	    return;
	}

      try {
        const ports = await navigator.serial.getPorts();
        if (ports.length > 0) {
	    const port = ports[0];
	    UART.connect_(port);
        }
     } catch(e) { console.warn(`Error port: `+e); }

    },

    connect_manual: async ()=>{

	if(!navigator?.serial) {
	    return salert('Serial not supported, use Chrome Desktop',1000);
	}

        const port = await navigator.serial.requestPort();
	UART.connect_(port);
    },

    connect_: async (port)=>{

	dom.off('uart_state');

	if (UART.reader) {
    	    try { await UART.reader.cancel(); } catch(e) {}
    	    UART.reader.releaseLock();
    	    UART.reader = null;
	}

	if (port?.readable || port?.writable) {
	    try { await port.close(); } catch(e) {}
	}

        console.warn(`Port connected: `,UART.uart_set);
	await port.open(UART.uart_set);

        UART.port = port;
	UART.reader = port.readable.getReader();
	dom.on('uart_state');

	try {
            while(true) {
		const { value, done } = await UART.reader.read();
    		if (done) break;
		if (!value) continue;
		UART.do(value,{real:1});
	    }
	} finally {
            console.warn("Port closed");
	    dom.off('uart_state');
	}

    },


    close_all: async ()=>{
        console.log(`Close all ports`);
	const ports = await navigator.serial.getPorts();
	for (const i in ports) {
	    const port = ports[i];
	    try {
		if (port.readable || port.writable) {
		    console.log(`Port ${i} closing`);
		    await port.close();
		    if(port.forget) {
			console.log(`Port ${i} forget`);
			await port.forget();
		    }
		}
	    } catch (e) {
		console.log('close error', e);
	    }
	}
    },

    test_rts_dtr: ()=>{
	if(!UART.port) return;
	if(UART.opt_rtsdtr) {
	    clearInterval(UART.opt_rtsdtr);
	    UART.opt_rtsdtr=null;
	} else {
	    UART.opt_rtsdtr=setInterval(async ()=>{
		await UART.port.setSignals({
		    dataTerminalReady: true,   // DTR
		    requestToSend: true        // RTS
		});
		await new Promise(r=>setTimeout(r,100));
		await UART.port.setSignals({
		    dataTerminalReady: false,   // DTR
		    requestToSend: false        // RTS
		});
	    },200);
	}
    },

    concat: (a, b)=>{
	const c = new Uint8Array(a.length + b.length);
        c.set(a);
        c.set(b, a.length);
        return c;
    },

    X: (b)=>{
	return (1*b).toString(16).toUpperCase().padStart(2,"0");
    },

    XX: (b)=>{
	return UART.X(b & 0xFF)+UART.X((b >> 8) & 0xFF);
    },

    P: (p)=>{
	return [...p].map(b => UART.X(b)).join(" ");
    },

    P10: (p)=>{
	return [...p].map(b => UART.PAD(b,3)).join(" ");
    },

    P_DH: (p)=>{
	return UART.opt_dec ? UART.P10(p) : UART.P(p);
    },

    D5: (l)=>{
	return UART.PAD(l,5);
    },

    PAD: (l,n=5)=>{
	return String(l).padStart(n,' ');
    },

    print: (name) => {
	let s='';
	for(var x in UART.mas) {
	    let cod = parseInt(x.split(' ')[0].split('-')[1],16)
	    var color = cod >= 0x80 ? 'green' : 'black';
	    s+=`<div style='color:${color}'>${UART.D5(UART.mas[x])}: ${x}</div>`;
	}
	dom(name,s);
    },

    printNew: ()=>{
        let add='';
        let del='';
	if(! Object.keys(UART.ref).length ) return dom("conmain_diff",'');

	let addm = {};
	for(let x in UART.mas) { if(!UART.ref[x]) addm[x]=UART.mas[x]; }
	addm = Object.fromEntries( Object.entries(addm).sort(([a],[b]) => a.localeCompare(b)) );
	for(let x in addm) {
	    let cod = parseInt(x.split(' ')[0].split('-')[1],16)
	    let color = cod >= 0x80 ? 'green' : 'black';
	    add += `<div style='color:${color}'>${UART.D5(addm[x])}: ${x}</div>`;
	}

	let delm = {};
	for(let x in UART.ref) { if(!UART.mas[x]) delm[x]=UART.ref[x]; }
	delm = Object.fromEntries( Object.entries(delm).sort(([a],[b]) => a.localeCompare(b)) );
	for(let x in delm) {
	    let cod = parseInt(x.split(' ')[0].split('-')[1],16)
	    let color = cod >= 0x80 ? 'green' : 'black';
	    del += `<div style='color:${color}'>${UART.D5(delm[x])}: ${x}</div>`;
	}

	dom("condiff",add+'<hr>'+del);
    },

    stick: ()=>{
	dom("conmas",'');
	UART.print("conref");
	dom("condiff",'');
	// for (let dev in UART.mas) UART.ref[dev] = (UART.ref[dev] || 0) + UART.mas[dev];
	Object.assign(UART.ref, UART.mas);
	Object.keys(UART.mas).forEach(k => delete UART.mas[k]);
    },

    text_copy: "",

    do: async (value, opt)=>{

//	if(opt?.real) {
//	    alert('ВОТ РАДОСТИ!!!');
//	    return;
//	}

	if(!opt?.notext && UART.opt_text) {

	    let text = opt.cantxt ? value : UART.decoder.decode(value, { stream: true });

	    if(UART.opt_can) {

		if(!UART.can) await UART.canFile_parse("can/can.txt");

		UART.text_copy += text;
		if(UART.text_copy.length > 4096) {
		    console.error('Can buffer OVERLOADED');
		    UART.text_copy='';
		}
		if(UART.text_copy.indexOf("\n")>=0) {
		    let ta = UART.text_copy.split("\n"); // взяли всё
		    if(ta[ta.length-1]!='') { // если последняя неоконченная, оставить ее в буффере
			console.warn("Unended: "+ta[ta.length-1]);
			UART.text_copy=ta[ta.length-1]; delete(ta[ta.length-1]);
		    } else {
			UART.text_copy='';
		    }
		    ta.forEach(l=>{
			// can_print(l);
			UART.can_print(l);
		    });
		    // UART.load_bus = 0
		}
	    } else {
		UART.pr(text,'text console');
	    }
	    return;
	}

	if(!opt?.nodata && UART.opt_data) {
    	    UART.pr(UART.P(value)+' ','data console');
	}

	UART.buffer = UART.concat(UART.buffer, value);

	while(true) {

	    // console.log('find: ',UART.buffer.length);

            const r = UART.findFrame(UART.buffer);
            if(!r) break;

	    if(r.start !==0) {
		const buf_do = UART.buffer.slice(0, r.start);
		UART.pr(`${UART.P(buf_do)}\n`,'log','red');
	    }

	    r.d = UART.opt_033 ? r.data : r.encoded;
	    r.dev = UART.XX(r.addr);

	    let pid = `${r.dev}-${UART.X(r.control)}`;
	    let win = UART.opt_onewin ? 'log' : `device_${r.dev}`;

	    if(!r.sum) {
		UART.pr(`\nSUM: ${r.dev}-${UART.X(r.code)} [ ${UART.P(r.d)} ]\nSUMAD: ${r.sumad}\nRAW: ${UART.P(r.raw)}\n\n`,'log','red');
	    } else {
		if(UART.opt_diff) {
		    // DIFF
		    let ds = pid+' '+UART.P(r.d);
		    if(!UART.mas[ds]) UART.mas[ds]=1;
		    else UART.mas[ds]++;

		    UART.print("conmas");
		    UART.printNew();
		} else {
		    // PLAIN
		    UART.pr(
			`\n${r.dev}-${UART.X(r.code)} [ ${UART.P_DH(r.d)} ]${r.s_start}${r.s_end}\n`,
			win,
			r.answer ? 'green' : 'white',
			r.raw
		    );
		    if(UART.opt_raw) {
			UART.pr(`raw: ${UART.P(r.raw)}\n`,win,'yellow',r.raw);
			// UART.pr(`r10: ${UART.P10(r.raw)}\n`,win,'yellow',r.raw);
		    }
		}

		// Посылать ли в батарею
		if(UART.opt_sendto) {
		    let dsend = pid+' '+UART.P(r.d);
		    UART.pr(`\nSENDTO: [${dsend}]\n`,'sendto','red');
		    await UART.send(dsend);
		}

	    }
	    UART.buffer=UART.buffer.slice(r.end);

	    // Наши расшифровки
	    if(UART.opt_bat) {
		if(pid=='31CE-82') {
		    let w = dom('battery');

		    console.log(r.d.length);

		    if(r.d.length == 0x2B) { // info
			w.querySelector("[name='otherbatt']").innerHTML = UART.P(r.d);
			const bat_serial = new TextDecoder().decode(new Uint8Array(r.d.slice(7, 23)));
			w.querySelector("[name='serial']").innerHTML = bat_serial;
		    } else { // batt
    			w.querySelector("[name='otherinfo']").innerHTML = UART.P(r.d);
			w.querySelector("[name='volt']").innerHTML = ( (r.d[0] << 8) | r.d[1] ) / 10;
			w.querySelector("[name='amper']").innerHTML = ( (r.d[2] << 24) | (r.d[3] << 16) | (r.d[4] << 8) | r.d[5] ) / 10;
			w.querySelector("[name='SOC']").innerHTML = r.d[6];
			w.querySelector("[name='flags']").innerHTML = `${UART.X(r.d[7])} ${UART.X(r.d[8])} ${UART.X(r.d[9])}`;
			let temps=''; for(let i=10;i<=14;i++) temps+=r.d[i]+'&deg; ';
			w.querySelector("[name='temp']").innerHTML = temps;
			for(let i=0;i<20;i+=1) {
			    const wx = w.querySelector(`[name='bat${i+1}']`);
			    const x = (r.d[i*2+15] << 8) | r.d[i*2+15+1];
			    wx.innerHTML = x;
			}
		    }
		}

/*
25 55 32 45 30 31 59 31 31 55 32 45 30 31 50 31 30 4D 55 54 33 36 43 31 42 37 31 32 31 30 30 33 30 11 30 23 3C 01 00 28 00 00 00 00 08 00 00 02 00 00 00


# Универсальный ответ батареи на запрос 20DF-02 [ 01 10 ]:
# 20DF-02 [ 01 10 ]  => 25 55 32 45 30 31 59 31 31 55 32 45 30 31 50 31 30 4D 55 54 33 36 43 31 42 37 31 32 31 30 30 33 30 11 30 23 3C 01 00 28 00 00 00 00 08 00 00 02 00 00 00

# Ответ батареи на запрос 31CE-02 [ 02 2B ]:

#56%
31CE-02 [ 02 2B ] => 24 11 55 55 55 55 01 42 4D 42 48 42 55 32 4A 38 31 34 30 30 30 32 33 2A 29 1D 21 26 1F 30 BA 46 3C 37 32 EC F1 01 30 75 94 00 0B
#100%
#31CE-02 [ 02 2B ] => 24 11 55 55 55 55 01 42 4D 42 48 42 55 32 4A 38 31 34 30 30 30 30 35 2A 29 1D 21 26 1F 30 BA 46 3C 37 32 EC F1 01 30 69 14 00 12

# Ответ батареи на запрос 31CE-02 [ 2D 37 ]:

#56%
31CE-02 [ 2D 37 ] => 01 E1 00 00 00 00 38 00 00 07 15 15 15 15 16 0E 75 0E 77 0E 79 0E 7A 0E 6D 0E 78 0E 79 0E 7A 0E 78 0E 7D 0E 7D 0E 7C 0E 7C 00 00 00 00 00 00 00 00 00 00 00 00 00 00
#100%
#31CE-02 [ 2D 37 ] => 02 17 00 00 00 00 64 00 00 00 15 15 15 15 15 10 13 10 15 10 14 10 14 10 14 10 14 10 14 10 15 10 14 10 15 10 16 10 17 10 17 00 00 00 00 00 00 00 00 00 00 00 00 00 00

<div>Serial: <span name='serial'></span></div>
<div>Percent: <span name='percent'></span>%</div>
<div>Other_info: <pre name='other'></pre></div>
<div>Other_info: <pre name='other'></pre></div>
<div class='bat'><div class='batn'> 1</div><div class='batx'  name='bat1'>1370</div><div class='batg'>&#128267;</div></d

*/
	    }



	    // Наши ответы
	    if(UART.opt_answer && UART.answer) {
		let message = `${pid} ${UART.P(r.d)}`;
		if(UART.answer[message]) {
		    let araw = UART.makeFrame(r.dev, UART.X(r.code | 0x80), UART.answer[message]);
		    UART.pr(`answer: ${r.dev}-${UART.X(r.code | 0x80)} ${UART.answer[message]}\n`,win,'#FFB347');
		    UART.pr(`answer_raw: ${UART.P(araw)}\n`,win,'#FFA500');
		    setTimeout(()=>{UART.send(araw);},20);
		}
	    }

	    // Как текст в консоль
	    if(UART.opt_txt) {
    		const txt = UART.decoder.decode(r.d);
    		UART.pr(txt+"\n",'txt console');
	    }


	}
        // console.log('find_end: ',UART.buffer.length);
    },

    makeFrame: function(addr, code, data) {
	data = data.trim();
	data = data ? data.split(/\s+/).map(b => (parseInt(b,16) + 0x33) & 0xFF) : [];
	const frame = [
	    0x68,
	    parseInt(addr.slice(0, 2), 16),
	    parseInt(addr.slice(2, 4), 16),
	    0x68,
	    parseInt(code, 16),
	    data.length,
	    ...data
	];
        let sum = 0; for (const b of frame) sum = (sum + b) & 0xFF;
	if(UART.opt_answerFE) return [ 0xFE, 0xFE, 0xFE, 0xFE, ...frame, sum, 0x16 ];
	else return [ ...frame, sum, 0x16 ];
    },

    findFrame: (buffer) => {
        for (let i = 0; i <= buffer.length-6; i++) {
            // в начале могут быть несколько FE
    	    let j = i; while (j < buffer.length && buffer[j] === 0xFE) j++;
            const prefixLen = j - i;
    	    // проверяем, хватает ли заголовка
    	    if (buffer.length <= j+5) break;
            // после FE должен быть 68 XX XX 68
	    if (buffer[j] !== 0x68 || buffer[j+3] !== 0x68) continue;
    	    const len = buffer[j+5];
    	    let frameLength = prefixLen + 6 + len + 1; // без учета +0x16
    	    if (buffer.length < i + frameLength) break; // ждём ещё байты
    	    let end = i + frameLength; // c кс
            // считаем checksum
	    let suma=`[${UART.X(buffer[end-1])}] `;
	    let sm = 0; for (let k = j; k < end-1; k++) {
		suma+=UART.X(buffer[k])+' ';
		sm = (sm + buffer[k]) & 0xFF;
	    }
	    let sum = sm === buffer[end-1];

            // 6 проверяем 0x16
	    let is_end = 0;
	    if (buffer[end] === 0x16) {
		end++;
		is_end=1;
	    }

	    const control = buffer[j + 4];
	    const dataStart = j + 6;
	    const encoded = buffer.slice(dataStart, dataStart + len);
	    const data = encoded.map(b => (b - 0x33) & 0xFF);
	    const raw = buffer.slice(i, end);
	    return {
    	        start: i,
        	end: end,
		addr: (buffer[j + 2] << 8) | buffer[j + 1], // >
            	len: len,
		code: control & 0x7F,
		control,
		answer: !!(control & 0x80),
            	sum: sum,
		sumad: `sum=${UART.X(sm)} [${suma}] | ${UART.X(buffer[end-1])} #${is_end}`,
            	raw,
            	encoded,
		data,
		is_start: prefixLen,
		is_end: is_end,
		s_start: '@'.repeat(prefixLen),
		s_end: '#'.repeat(is_end),
    	    };
	}
        return false;
    },


    www_send: async (s) => {
	s=s.trim();
	let t = 20;
	s.split('\n').forEach((data,i) => {
	    data = data.trim();
	    if(data) setTimeout(()=>{
		console.log(`Sending: ${data}`);
		UART.send(data);
	    },t);
	    t += 100;
	});
    },

    send: async (data) => {

        if (typeof data === 'string') {
    	    data = data.trim();
	    console.log('data',data);

	    if (/^[0-9A-F]{4}\-[0-9A-F]{2}( [0-9A-F]{2})*$/.test(data)) {
		// Надо кодировать!
		const [head, ...other] = data.split(' ');
		const [addr, code] = head.split('-');
		data = other.join(' ');
		data = UART.makeFrame(addr, code, data);
		data = UART.P(data);
	    }

    	    if (/^[0-9A-Fa-f]{2}( [0-9A-Fa-f]{2})*$/.test(data)) {
        	const bytes = data.split(/\s+/).map(h => parseInt(h, 16));
        	data = new Uint8Array(bytes);
    	    } else {
        	data = new TextEncoder().encode(data);
    	    }
	} else if (!(data instanceof Uint8Array)) data = new Uint8Array(data);

	UART.pr(UART.P(Array.from(data))+"\n\n",`send`,'#FFA500');

        if (!UART.port?.writable) {
	    console.warn('port not ready for write');
	    return;
	}

	// Ждем пока что-то передаст другое
	while (UART.send_busy) { await new Promise(r => setTimeout(r, 1)); }
	UART.send_busy = true;

	const writer = UART.port.writable.getWriter();

        if(UART.opt_dtr) {
	    try {
		const bits = (data.length || 1) * 10; // старт+8+стоп
    		const ms = bits * 1000 / UART.uart_set.baudRate;

	    //setTimeout(async ()=> {
		await UART.port.setSignals({
		    // dataTerminalReady: false,   // DTR
		    requestToSend: false        // RTS
		});
	    //},1);

    		// await new Promise(r => setTimeout(r, 10));
		// await new Promise(r => setTimeout(r, 10));

		await writer.write(data);
		// дождаться физической передачи
    		await new Promise(r => setTimeout(r, ms+1));
	    } finally {
		await UART.port.setSignals({
		    // dataTerminalReady: true,   // DTR
		    requestToSend: true        // RTS
		});
    		writer.releaseLock();
	    }
	} else {
    	    try {
		await writer.write(data);
    	    } finally {
		writer.releaseLock();
	    }
	}

	UART.send_busy = false;

    },


    can: false,
    candata: {},

    canFile_parse: async (file) => {
        let s = await UART.loadfile(file);
        if(!s) { alert('error file: '+file); return; }
	const r=[];
	let id='';
	let action='';
	let last='';
	s.split("\n").forEach(l=>{
	    l = l.replace(/\s*\#.*$/,'');
            if(l=='') return; // пустая строка
            let m; // = l.match(/^\s*\#/);          if(m) return; // комментарий

	    // 01A0: BMS
	    m = l.match(/^([0-9A-F]{4,})\:\s*(.+?)\s*$/);
	    if (m) {
		id=m[1];
		if(!r[id]) r[id]={act:{}};
		r[id].name = m[2];
		last='';
		return;
	    }

	    // bits 0:
	    // x/10 2,1: AKB={x}A
	    // x 3: Tmin={x}°C
	    // x 7,6: V?={x}
	    m = l.match(/^\s+([^\:]*)\:\s*(.*?)\s*$/);
	    if(m) {
		last=m[1];
		//     :Sync
		if(m[1]=='') { r[id].act[last]={mode:'text',text:m[2].trim()}; return; }
		//     x/10 2,1: AKB={x}A
		if(m[1].indexOf(' ')<0) return alert(`error: id=${id} - ${l}`);
		let [a,c] = m[1].split(' ');
		let bytes=[]; c.split(',').forEach(i=>bytes.push(1*i));
		r[id].act[last]={mode:a,bytes:bytes,text:m[2].trim()};
		return;
	    }

            // 0 Открыта АКБ
            // 1 ЗУ | Подключено ЗУ
            if(!r[id].act[last]) return; // не биты
	    l=l.trim();
	    let i = l.indexOf(' ');
	    if(i<0) return;
	    let bit = l.slice(0, i);
	    let txt = l.slice(i+1).trim().split(' | ');

	    if(!r[id].act[last].bits) r[id].act[last].bits={};
	    r[id].act[last].bits[bit]=txt;
	});
        UART.can = r;
    },

    can_print: (l)=>{
        l=l.trim();
        if(l=='') return;
        let id = l.split(' ')[0].trim();

	if(!UART.can[id]) return;

	let name = UART.can[id].name+' '+id;
	let bytes=[]; l.split(' ').slice(1).forEach(i=>bytes.push(parseInt(i,16)));
        let cd=[];

	for(let d in UART.can[id].act) { let p = UART.can[id].act[d];

	    if(p.mode == 'text') {
		cd.push(p.text);
		continue;
	    }

	    if(p.mode == 'str') {
                let b=[]; p.bytes.forEach(ib=>b.push(bytes[ib]==0x00?0x5F:bytes[ib])); // собрали байты в байтрницу
                const str = new TextDecoder().decode(new Uint8Array(b)); // сделали текст
		cd.push(p.text.replace(/\{x\}/g,str));
		continue;
	    }

	    // numeric
	    let x = 0x00000000;
	    let nx = 0;
	    if(p.bytes) {
		p.bytes.forEach(ib => { x = (x<<8) + bytes[ib]; nx++; }); // собрали байты в число
	    }

	    if(p.mode == 'bits') {
		let x2 = x;
		for(let c in p.bits) {
		    const text = p.bits[c]; // краткая версия 0
		    const pin = 1 << (1*(c.replace(/\!/,'')));
		    if(c.indexOf('!')<0) {
			if(x & pin) cd.push(text);
		    } else {
			if(!(x & pin)) cd.push(text);
		    }
		    x2 &= ~pin;
		}
		if(x2) cd.push(`BITS:${x2.toString(2)}`);
		continue;
	    }

	    if(p.mode == 'x') {}
	    else if(p.mode == 'i') {
		    if(nx==1 && (x & 0x80)) x-=0x100;
		    if(nx==2 && (x & 0x8000)) x-=0x10000;
		    if(nx==4 && (x & 0x80000000)) x-=0x100000000;
		    if(x>=0) x='+'+x;
	    }
	    else if(p.mode == 'x/10') { x=(x/10).toFixed(1); }
	    else if(p.mode == 'x*50') { x=x*50; }
	    else if(p.mode == 'i/10') {
		if(nx==1 && (x & 0x80)) x-=0x100;
		if(nx==2 && (x & 0x8000)) x-=0x10000;
		if(nx==4 && (x & 0x80000000)) x-=0x100000000;
		x = x < 0 ? (x/10).toFixed(1) : '+'+(x/10).toFixed(1);
	    }
	    else if(p.mode == 'x-5000/10') { x=((x-5000)/10).toFixed(1); }
	    else {
		console.error(`unknown mode: ${p.mode}`,l,p);
		return alert(`unknown mode: ${p.mode}\nl=[$l]`);
	    }
	    cd.push(p.text.replace(/\{x\}/g,x));
	}

	// ---

	if(cd.length) {


	    if(UART.opt_station && id) {
		if(id=='0080') {
		    let e=dom('station').querySelector("[name='sync']");
		    e.textContent="Sync";
		    setTimeout(()=>{e.textContent=''},500)
		} else if(['0500','0501','01A0','02A0','03A0'].includes(id)) {
			UART.candata[id]={flag:[]}; // обнулили
			cd.forEach(i=>{
			    let [a,b]=(''+i).split(':');
			    if(b!=undefined) UART.candata[id][a]=b;
			    else UART.candata[id]['flag'].push(a);
			});

		    /// BMS
		    if(id=='01A0') {
			const e=dom('station').querySelector("[name='bms']");
			e.querySelector("[name='SOC']").textContent=UART.candata[id]["SOC"];
			e.querySelector("[name='A']").textContent=UART.candata[id]["A"];
			e.querySelector("[name='V']").textContent=UART.candata[id]["V"];
			e.querySelector("[name='Tmin']").textContent=UART.candata[id]["Tmin"];
			e.querySelector("[name='Tmax']").textContent=UART.candata[id]["Tmax"];
			e.querySelector("[name='flag1']").textContent=UART.candata[id].flag.join("\n");
		    } else if(id=='02A0') {
			dom('station').querySelector("[name='bms']").querySelector("[name='flag2']").textContent=UART.candata[id].flag.join("\n");
		    } else if(id=='03A0') {
			dom('station').querySelector("[name='bms']").querySelector("[name='flag3']").textContent=UART.candata[id].flag.join("\n");
		    }

		    /// Station
		    else if(id=='0500') {
			const e=dom('station').querySelector("[name='station']");
			e.querySelector("[name='Areq']").textContent=UART.candata[id]["Req"];
			e.querySelector("[name='Vtar']").textContent=UART.candata[id]["Tar"];
			e.querySelector("[name='Vlim']").textContent=UART.candata[id]["Lim"];
			e.querySelector("[name='flag1']").textContent=UART.candata[id].flag.join("\n");
		    }
		    else if(id=='0501') {
			const e=dom('station').querySelector("[name='station']");
			e.querySelector("[name='SOC']").textContent=UART.candata[id]["SOC"];
			e.querySelector("[name='ver']").textContent=UART.candata[id]["v"];
			e.querySelector("[name='Tmax']").textContent=UART.candata[id]["TimeMax"];
			e.querySelector("[name='Test']").textContent=UART.candata[id]["TimeEst"];
			e.querySelector("[name='flag2']").textContent=UART.candata[id].flag.join("\n");
		    }
		}
	    }


            if(cd.join(' ').length > 50) cd.forEach(s=>l+=`\n   ${s}`);
            else l+=" "+cd.join(', ');
        }
        // return text;
        let win = UART.opt_onewin ? 'console' : name;
        l=l.replace(/\s*\[EXT\]/g,'');
        UART.pr(l+"\n",win)
    },
};

// window.addEventListener("load", UART.init);
UART.init();
