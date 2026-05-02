// https://docs.movicomelectric.com/bin/view/Battery%20management%20systems/BMS%20Mini%20S/6.%20Communication%20protocols/6.1%20CANopen%20PDO%20protocol/

function canbat_err(x) {
    let cd=[];
    let bits = {
        0: 'Сбой платы',
        1: 'Перегрев',
        2: 'Перегрев MOS',
        3: 'Перепад больше 0.3V',
        4: 'Перезаряд/КЗ',
        5: 'Параллельность',
    };
    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }
    cd = cd.join(' | ');
    if(cd!='') cd=`[ERROR: ${cd}]`;
    return cd;
}

function can_print(text) {

	text=text.trim();

	if(text=='') return;

	let can_id = text.split(' ')[0].trim();
	let name=can_id;

	let m = text.split(' ').slice(1);
	let x;
	let cd=[];
	let bits;

	// BMS

	if(can_id=='0080') {
	    name=`BMS-sync `+can_id;
	    cd.push("Sync");
	}

	else if(can_id=='01A0') {
	    name=`BMS `+can_id;
	    x = parseInt(m[0], 16);
            bits = {
                0: 'Открыта АКБ',
                1: 'ЗУ', // 'Подключено ЗУ',
                2: 'Запрос на отключение питания',
                3: 'Запрет заряда',
                4: 'Запрет разряда',
                5: 'Обратная связь контактора заряда',
                6: 'Обратная связь контактора разряда',
                7: 'Статус контроля изоляции',
            };

	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }

	    x = parseInt(m.slice(1,3).reverse().join(''),16);
	    cd.push(`AKB=${x/10}A`); // 1-2	РўРѕРє С‡РµСЂРµР· РђРљР‘	S16	0,1Рђ/Р±РёС‚
	    let x1 = parseInt(m[3], 16);
	    // cd.push(``); // 3	РњРёРЅРёРјР°Р»СЊРЅР°СЏ С‚РµРјРїРµСЂР°С‚СѓСЂР° СЏС‡РµР№РєРё	S8	1ВєC/Р±РёС‚
	    x = parseInt(m[4], 16); // if (x & 0x80) x -= 0x100;
	    cd.push(`Tmin/max=${x1}-${x}°C`); // 4	РњР°РєСЃРёРјР°Р»СЊРЅР°СЏ С‚РµРјРїРµСЂР°С‚СѓСЂР° СЏС‡РµР№РєРё	S8	1ВєC/Р±РёС‚
	    x = parseInt(m[5], 16); // if (x & 0x80) x -= 0x100;
	    cd.push(`SOC=${x}%`); // 5	РЎС‚РµРїРµРЅСЊ Р·Р°СЂСЏРґР° РђРљР‘ (SOC)	U8	1%/Р±РёС‚
	    x = parseInt(m.slice(6,8).reverse().join(''));
	    cd.push(`V?=${x}`); //  6-7	РќР°РїСЂСЏР¶РµРЅРёРµ РђРљР‘	U16	0,1Р’/Р±РёС‚
	    x = parseInt(m.slice(6,8).join(''));
	    cd.push(`V?=${x}`); //  6-7	РќР°РїСЂСЏР¶РµРЅРёРµ РђРљР‘	U16	0,1Р’/Р±РёС‚


	}


	else if(can_id=='02A0') {
	    name=`BMS `+can_id;
	    x = parseInt(m.slice(0,4).reverse().join(''),16);
            bits = {
                0: "SOC ниже заданного уровня",
                1: "Ток заряда выше заданного уровня",
                2: "контактора заряда замкнут",
                3: "Разрешение ЗУ",
                4: "Идет заряд АКБ",
                5: "контактора разряда замкнут",
                6: "Идет разряд АКБ",
                7: "Повышенное напряжение (EV)",
                8: "Нагрев АКБ",
                9: "Охлаждение АКБ",
                10: "отключение контактора разряда от погрузчика HYG",
                11: "инициализация платы: калибруется ток, сканируется BMS Logic",
                12: "контактор предзаряда",
                13: "отключение контактора разряда от погрузчика Combilift",
                14: "процесс анализа ячеек (Cell analysis)",
                17: "дополнительный (AUX) контактор разряда замкнут",
                18: "подтверждение отключения питания",
                19: "сигнал EWS от погрузчика Crown",
                20: "главный контактор замкнут",
                21: "служебный сброс системы",
                22: "комбинированный контактор заряда/разряда замкнуто",
                23: "Готов заряжаться",
                24: "Готов разряжаться",
                25: "Power up",
                26: "External 1",
            };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }

	    x = parseInt(m.slice(4,8).reverse().join(''),16);
            bits = {
                0: "Превышение тока",
                1: "Низкое напряжение",
                2: "Высокое напряжение",
                3: "Низкая температура (разряд)",
                4: "Высокая температура (разряд)",
                5: "Открыта крышка АКБ",
                6: "Повышенная влажность",
                7: "Вода",
                9: "Cell monitor offline",
                10: "критическая ошибка",
                11: "ошибка Crown",
                12: "Несоответствие кол-ва ячеек",
                13: "Потеря связи с HYG",
                14: "надо квитировать записи в журнале ошибок",
                15: "Потеря связи с Combilift",
                16: "Короткое замыкание",
                17: "Перегрев контактора",
                19: "ошибка АЦП",
                20: "обрыв/кз датчика тока",
                21: "задрочили контактор заряда",
                22: "задрочили контактор разряда",
                23: "Потеря связи с BMS Current Sensor",
                24: "внутренняя ошибка BMS Current Sensor",
                26: "перезапуск платы WDT",
                27: "Нет датчиков температуры",
                28: "КЗ датчика температуры",
                29: "Потеря связи со Spirit",
            };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }
	}

	else if(can_id=='03A0') {
	    name=`BMS `+can_id;
	    x = parseInt(m.slice(0,4).reverse().join(''),16);
            bits = {
                0: "Низкая температура (заряд)",
                1: "Высокая температура (заряд)",
                2: "ошибка монтирования SD-карты",
                3: "ошибка записи/чтения SD-карты",
                4: "Недопустимый заряд (контактор разряда)",
                5: "Залипание контактора",
                8: "Нарушение изоляции",
                13: "General error",
                17: "ошибка предзаряда",
                19: "Current limit error",
            };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }

	    x = parseInt(m.slice(4,6).reverse().join(''),16);
            bits = {
                0: "Запрос на заряд",
                1: "Запрос на предзаряд",
                2: "Запрос на разряд",
                6: "Interlock",
                7: "Fuse 1",
                8: "Fuse 2",
                9: "Fuse 3",
                10: "Circuit breaker status",
                11: "Balancing request",
                12: "Close Main contactor",
                13: "Close External 1",
                14: "Close External 2",
            };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }
	}






























	// Battery OCLA 72V40A

	// ID: 7F2020 (EXT)
	// DATA: 00 00 1D 03 4A 02 02 00

	// БАТАРЕЯ СТАТУС
	else if(can_id=='180850F4'||can_id=='180850F5') { // ПО ДОКУМЕНТАЦИИ
	    if(can_id=='180850F4') name=`БАТАРЕЯ СТАТУС OCLA BMS-A `+can_id;
	    else name=`БАТАРЕЯ СТАТУС OCLA BMS-B `+can_id;

	    // 180850F4 47 03 E8 03 92 13 03 00 [83.9V 100.0% 14.6A, 3, 0]
	    // 180850F4 48 03 E8 03 92 13 03 00 [84.0V 100.0% 14.6A, 3, 0]
	    // 180850F4 48 03 E8 03 88 13 03 00 [84.0V 100.0% 13.6A, 3, 0]
	    // 180850F5 36 03 98 03 88 13 01 00 [82.2V, 92.0%, 0.0A, Relay_Dis]
	    // 180850F5 36 03 98 03 88 13 01 00 [82.2V, 92.0%, 0.0A, Relay_Dis]
	    // 180850F5 36 03 98 03 88 13 01 00 [82.2V, 92.0%, 0.0A, Relay_Dis]
	    // 180850F5 36 03 98 03 88 13 01 00 [82.2V, 92.0%, 0.0A, Relay_Dis]
	    // 180850F5 34 03 98 03 6A 13 03 00 [82.0V, 92.0%, -3.0A, Relay_Dis, Relay_Cha]
	    // 180850F5 34 03 98 03 6A 13 03 00 [82.0V, 92.0%, -3.0A, Relay_Dis, Relay_Cha]
	    // 180850F5 34 03 98 03 6A 13 03 00 [82.0V, 92.0%, -3.0A, Relay_Dis, Relay_Cha]
	    // 180850F5 34 03 98 03 74 13 03 00 [82.0V, 92.0%, -2.0A, Relay_Dis, Relay_Cha]

	    x = parseInt(m.slice(0,2).reverse().join(''),16); // 0,1
	    cd.push(`${(x/10).toFixed(1)}V`); // V по документации

	    x = parseInt(m.slice(2,4).reverse().join(''),16); // 2,3
	    cd.push(`${(x/10).toFixed(1)}%`); // SOC по документации

	    x = parseInt(m.slice(4,6).reverse().join(''),16); // 4,5 .reverse()
	    x = x-5000;
	    cd.push(`${(x/10).toFixed(1)}A`); // A по документации

	    x = parseInt(m[6], 16);
	    bits = {
	        0: 'Relay_Dis', // 1
	        1: 'Relay_Cha', // 2
	    };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }

	    x = parseInt(m[7], 16); if(x) cd.push(canbat_err(x)); // 7 Ошибки по таблице
	}


	// БАТАРЕЯ ХОТЕЛКИ
	else if(can_id=='1806E5F4'||can_id=='1806E5F5') { // ПО ДОКУМЕНТАЦИИ (это батарея)

	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]
	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]
	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]
	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]
	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]
	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]
	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]
	    // 1806E5F5 03 48 00 C8 01 00 00 00 [Vmax: 84.0V, Amax: 20.0A, Charge OFF]

	    if(can_id=='1806E5F4') name=`БАТАРЕЯ ХОТЕЛКИ OCLA BMS-A OUT CTRL `+can_id;
	    else name=`БАТАРЕЯ ХОТЕЛКИ OCLA BMS-B OUT CTRL  `+can_id;

	    x = parseInt(m.slice(0,2).join(''),16); // 0,1
	    cd.push(`Vmax: ${(x/10).toFixed(1)}V`); // V по документации

	    x = parseInt(m.slice(2,4).join(''),16); // 2,3
	    cd.push(`Amax: ${(x/10).toFixed(1)}A`); // Amax alolowed по документации

	    x = parseInt(m[4], 16); cd.push(x == 0 ? 'Charging' : 'Charge OFF'); // 6
	}



	else if(can_id=='18FF50E5') { // Charger по документации
	    // 18FF50E5 03 46 00 10 20 4D 00 02 [BAT, (1:70), (2:0), 1.6A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 10 20 4D 00 02 [BAT, (1:71), (2:0), 1.6A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 0F 20 4D 00 02 [BAT, (1:71), (2:0), 1.5A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 0F 20 4D 00 02 [BAT, (1:70), (2:0), 1.5A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 0F 20 4D 00 02 [BAT, (1:71), (2:0), 1.5A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 0E 20 4D 00 02 [BAT, (1:70), (2:0), 1.4A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 0E 20 4D 00 02 [BAT, (1:70), (2:0), 1.4A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 0E 20 4D 00 02 [BAT, (1:70), (2:0), 1.4A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 0E 20 4C 00 02 [BAT, (1:70), (2:0), 1.4A, (4:32), (5:76), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 0D 20 4C 00 02 [BAT, (1:70), (2:0), 1.3A, (4:32), (5:76), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 0D 20 4C 00 02 [BAT, (1:70), (2:0), 1.3A, (4:32), (5:76), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 0C 20 4C 00 02 [BAT, (1:71), (2:0), 1.2A, (4:32), (5:76), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 0B 20 4C 00 02 [BAT, (1:71), (2:0), 1.1A, (4:32), (5:76), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 0A 20 4C 00 02 [BAT, (1:71), (2:0), 1.0A, (4:32), (5:76), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 0A 20 4C 00 02 [BAT, (1:71), (2:0), 1.0A, (4:32), (5:76), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 09 20 4B 00 02 [BAT, (1:71), (2:0), 0.9A, (4:32), (5:75), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 09 20 4B 00 02 [BAT, (1:70), (2:0), 0.9A, (4:32), (5:75), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 07 20 4B 00 02 [BAT, (1:70), (2:0), 0.7A, (4:32), (5:75), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 06 20 4B 00 02 [BAT, (1:70), (2:0), 0.6A, (4:32), (5:75), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 06 20 4A 00 02 [BAT, (1:71), (2:0), 0.6A, (4:32), (5:74), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 06 20 4A 00 02 [BAT, (1:70), (2:0), 0.6A, (4:32), (5:74), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 05 20 4A 00 02 [BAT, (1:71), (2:0), 0.5A, (4:32), (5:74), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 06 20 4B 00 02 [BAT, (1:71), (2:0), 0.6A, (4:32), (5:75), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 07 20 4B 00 02 [BAT, (1:70), (2:0), 0.7A, (4:32), (5:75), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 08 20 4B 00 02 [BAT, (1:71), (2:0), 0.8A, (4:32), (5:75), (6:0), (7:2)]
	    // 18FF50E5 03 47 00 09 20 4D 00 02 [BAT, (1:71), (2:0), 0.9A, (4:32), (5:77), (6:0), (7:2)]
	    // 18FF50E5 03 46 00 00 08 4D FF 33 [BAT, (1:70), (2:0), 0.0A, (4:8), (5:77), (6:255), (7:51)]
	    // 18FF50E5 03 47 00 00 08 4D FF 33 [BAT, (1:71), (2:0), 0.0A, (4:8), (5:77), (6:255), (7:51)]
	    // 18FF50E5 03 46 00 00 08 4D FF 33 [BAT, (1:70), (2:0), 0.0A, (4:8), (5:77), (6:255), (7:51)]

	    name=`C-H-A-R-G-E-R OCLA OUT STATUS `+can_id;
	    // БЕЗ РЕВЕРСА У ЗАРЯДНИКА ПОЧЕМУ-ТО!!!
	    x = parseInt(m.slice(0,2).join(''),16); // 0,1
	    cd.push(`Vout: ${(x/10).toFixed(1)}V`); // V по документации

	    x = parseInt(m.slice(2,4).join(''),16); // 2,3
	    cd.push(`Aout: ${(x/10).toFixed(1)}A`); // Amax alolowed по документации

	    x = parseInt(m[4], 16); cd.push(`Flag: ${x}`); // 4

	    bits = {
	        0: 'HW fail', // 1
	        1: 'Charger Over Temperature', // 2
	        2: 'Wrong inpul voltage', // 4
	        3: 'No Battery', // 8
	        4: 'Comm to', // 16
	        5: 'xz32', // 16
	    };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }

	    // lleo выЯснил

//	    x = parseInt(m[0], 16); cd.push(x ? `BAT` : `NO_BAT`); // флаг что есть батарея
//	    x = parseInt(m[1], 16); cd.push(`V:${(x/10).toFixed(1)}V`);
//	    x = parseInt(m[3], 16); cd.push(`A:${(x/10).toFixed(1)}A`);
//	    x = parseInt(m[3], 16); cd.push(`${(x/10).toFixed(1)}A`);
//	    x = parseInt(m[1], 16); cd.push(`(1:${x})`); // непонятный флаг
//	    x = parseInt(m[2], 16); cd.push(`(2:${x})`);
//	    x = parseInt(m[4], 16); cd.push(`(4:${x})`); // флаг, меняется при полной зарядке с 0x20 на 0x08
//	    x = parseInt(m[5], 16); cd.push(`(5:${x})`);
///	    x = parseInt(m[6], 16); cd.push(`${x?'STOP':'RUN'}`); // флаг, меняется при полной зарядке с 0x00 на 0xFF
//	    x = parseInt(m[7], 16); cd.push(`(7:${x})`);

	}



	// и еще чота


	else if(can_id=='7F2020'||can_id=='6F2020') {
	    x = parseInt(m.slice(0,2).reverse().join(''),16); // 0,1
	    if (x & 0x8000) x -= 0x10000;
	    cd.push(`${x<0?'':'+'}${(x/10).toFixed(1)}A`);

	    x = parseInt(m.slice(2,4).reverse().join(''),16); // 2,3
	    cd.push(`${(x/10).toFixed(1)}V`);

	    x = parseInt(m[4], 16); cd.push(`${x}%`);

	    x = parseInt(m[5], 16); cd.push(`(5:${x})`);
	    x = parseInt(m[6], 16); cd.push(`(6:${x})`);
	    x = parseInt(m[7], 16); cd.push(`(7:${x})`);
	}


	else if(can_id=='180950F5' || can_id=='180950F4') { // ЭТО БАТАРЕЯ!
	    name = `БАТАРЕЯ КОГДА БЕЗ ЗАРЯДНИКА `+can_id;
	    // без бп
	    // 180950F5 52 03 94 02 10 00 64 00
	    // 180950F5 52 03 94 02 10 00 64 00
	    cd.push(`@BAT@`);

	    x = parseInt(m.slice(0,2).reverse().join(''),16); // 0,1
	    cd.push(`${(x/10).toFixed(1)}`);

	    x = parseInt(m.slice(2,4).reverse().join(''),16); // 0,1
	    cd.push(`${(x/10).toFixed(1)}`);


	    x = parseInt(m[0], 16); cd.push(`${x}`);
	    x = parseInt(m[2], 16); cd.push(`${x}`);
	}


	// ============= S T A T I O N =================










	else if(can_id=='0500') {
	    name=`STATION `+can_id;
	    // 500 0
	    x = parseInt(m[0], 16);
            bits = {
		0: "Energy transfer system error",
		1: "Battery overvoltage",
		2: "Battery undervoltage",
		3: "Battery current deviation error",
		4: "High battery temperature",
		5: "Battery voltage deviation error",
		6: "-UNKNOWN_6-",
		7: "-UNKNOWN_7-",
            };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }

	    // 500 1
	    x = parseInt(m[1], 16);
            bits = {
		0: "EV charging enabled",
		1: "EV contactor status",
		2: "EV charging position",
		3: "EV charging stop control",
		4: "Wait request to delay energy transfer",
		5: "Digital communication toggle",
		6: "-UNKNOWN_6-",
		7: "-UNKNOWN_7-",
	    };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }

	    x = parseInt(m.slice(2,4).reverse().join(''),16); // 2,3
	    cd.push(`Req:${(x/10).toFixed(1)}A`);
	    // 500 2 requested DC OUTPUT CUR lo
	    // 500 3 requested DC OUTPUT CUR hi

	    x = parseInt(m.slice(4,6).reverse().join(''),16); // 4,5
	    cd.push(`Tar:${(x/10).toFixed(1)}V`);
	    // 500 4 DC output voltage target lo
	    // 500 5 DC output voltage target hi

	    x = parseInt(m.slice(6,8).reverse().join(''),16); // 4,5
	    cd.push(`Lim:${(x/10).toFixed(1)}V`);
	    // 500 6 DC output voltage limit lo
	    // 500 7 DC output voltage limit hi
	}

	else if(can_id=='0501') {

	    // 501 0 SoftWare Ver
	    name=`STATION `+can_id;
	    x = parseInt(m[0], 16);
	    cd.push(`ver:${x}`);

	    // 501 1 Charging rate of battery %
	    x = parseInt(m[1], 16);
	    cd.push(`SOC:${x}%`);

	    // 501 2 Maximum charging time (lower 8 bits)
	    // 501 3 Maximum charging time (higher 8 bits)
	    x = parseInt(m.slice(2,4).reverse().join(''),16); // 2,4
	    cd.push(`TimeMax:${x}`);

	    // 501 4 Estimated charging time (lower 8 bits)
	    // 501 5 Estimated charging time (higher 8 bits)
	    x = parseInt(m.slice(4,6).reverse().join(''),16); // 2,4
	    cd.push(`TimeEstimeted:${x}`);

	    // 501 6,7 - reserved
	}

	else if(can_id=='0502') {
	    // 502 0
	    name=`STATION `+can_id;
	    x = parseInt(m[0], 16);
            bits = {
		0: "Voltage control enabled",
	    };
	    for(let i in bits) { if(x & (1<<i)) cd.push(bits[i]); }
	}

	else if(can_id=='0580') {
	    // 580 0-7 - EV identification low byte
	    name=`STATION `+can_id;
	    cd.push(`ID_lo`);
	}

	else if(can_id=='0581') {
	    // 581 0-7 - EV identification high byte
	    name=`STATION `+can_id;
	    cd.push(`ID_hi`);
	}

	else if(can_id=='0582') {
	    // 582 0-7 - Protocol identifier low byte
	    name=`STATION `+can_id;
	    cd.push(`Protocol_lo`);
	}

	else if(can_id=='0583') {
	    // 583 0-7 - Protocol identifier high byte
	    name=`STATION `+can_id;
	    cd.push(`Protocol_hi`);
	}



	// ======================================================================

	if(cd.length) {
	    if(cd.join(' ').length > 50) cd.forEach(l=>text+=`\n   ${l}`);
	    else text+=" ["+cd.join(', ')+"]";
	}

	// return text;
	let win = 'can ' + (UART.opt_onewin ? 'console' : `${name}`);

	text=text.replace(/\s*\[EXT\]/g,'');
	UART.pr(text+"\n",win);
    }

