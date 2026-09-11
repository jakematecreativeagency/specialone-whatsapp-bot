const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 8080;
const AUTH_PATH = process.env.WHATSAPP_AUTH_PATH || '/app/.wwebjs_auth';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

let qrImage = '';
let whatsappStatus = 'starting';

const conversations = new Map();
const pausedChats = new Map();
const botSentMessages = new Map();
const recentBotBodies = new Map();
const activationGraceUntil = new Map();

const CEO_NUMBERS = [
  '34637993550@c.us',
  '34644287792@c.us'
];

const TRAINING_FORM = 'https://tally.so/r/NpMjqB';
const INTERNATIONAL_FORM = 'https://tally.so/r/pbREOV';

const FLYER_PATHS = [
  path.join(__dirname, 'domingos-tecnificacion.jpg'),
  path.join(__dirname, 'domingos-tecnificacion.png'),
  path.join(__dirname, 'assets', 'domingos-tecnificacion.jpg'),
  path.join(__dirname, 'assets', 'domingos-tecnificacion.png')
];

function cleanChromiumLocks(dir) {
  if (!fs.existsSync(dir)) return;

  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

  function scan(currentPath) {
    let items = [];

    try {
      items = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
      console.error('No se pudo revisar carpeta Chromium:', error?.message || error);
      return;
    }

    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);

      if (item.isDirectory()) {
        scan(fullPath);
        continue;
      }

      if (lockFiles.includes(item.name)) {
        try {
          fs.rmSync(fullPath, { force: true });
          console.log(`Lock Chromium eliminado: ${fullPath}`);
        } catch (error) {
          console.error('No se pudo eliminar lock Chromium:', error?.message || error);
        }
      }
    }
  }

  scan(dir);
}

cleanChromiumLocks(AUTH_PATH);

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: 'specialone-clean-1',
    dataPath: AUTH_PATH
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    protocolTimeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync'
    ]
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function humanDelay(text) {
  const length = (text || '').length;
  const base = 900;
  const extra = Math.min(length * 16, 2600);
  return base + extra + Math.floor(Math.random() * 900);
}

function splitDanielaMessages(text) {
  const clean = (text || '').replace(/\r/g, '').trim();

  if (!clean) return [];

  return clean
    .split(/\n{2,}/)
    .flatMap(block => {
      if (block.length <= 115) return [block];

      return block
        .split(/(?<=[.!?])\s+/)
        .map(part => part.trim())
        .filter(Boolean);
    })
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function normalizePhone(raw) {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('34') && digits.length === 11) return `${digits}@c.us`;
  if (digits.length === 9) return `34${digits}@c.us`;

  return null;
}

function pauseChat(chatId, hours = 2) {
  pausedChats.set(chatId, Date.now() + hours * 60 * 60 * 1000);
}

function activateChat(chatId) {
  pausedChats.delete(chatId);
  activationGraceUntil.set(chatId, Date.now() + 45000);
}

function isActivationGrace(chatId) {
  const until = activationGraceUntil.get(chatId);

  if (!until) return false;

  if (Date.now() > until) {
    activationGraceUntil.delete(chatId);
    return false;
  }

  return true;
}

function isPaused(chatId) {
  const until = pausedChats.get(chatId);

  if (!until) return false;

  if (Date.now() > until) {
    pausedChats.delete(chatId);
    return false;
  }

  return true;
}

function markBotMessage(chatId, body) {
  botSentMessages.set(chatId, Date.now());

  if (!body) return;

  const key = normalizeText(body).slice(0, 180);
  recentBotBodies.set(key, Date.now());

  setTimeout(() => {
    recentBotBodies.delete(key);
  }, 90000);
}

function wasRecentlySentByBot(chatId, body) {
  const last = botSentMessages.get(chatId);
  if (last && Date.now() - last < 90000) return true;

  const key = normalizeText(body).slice(0, 180);
  const bodyTime = recentBotBodies.get(key);

  return Boolean(bodyTime && Date.now() - bodyTime < 90000);
}

async function sendRawMessage(chatId, text) {
  markBotMessage(chatId, text);
  await client.sendMessage(chatId, text);
}

async function sendDanielaMessage(chatId, text) {
  const parts = splitDanielaMessages(text);

  for (const part of parts) {
    await sendRawMessage(chatId, part);
    await sleep(600 + Math.floor(Math.random() * 800));
  }
}

function getFlyerPath() {
  return FLYER_PATHS.find(filePath => fs.existsSync(filePath));
}

function asksForFlyer(text) {
  const t = normalizeText(text);

  return (
    t.includes('cartel') ||
    t.includes('imagen') ||
    t.includes('foto') ||
    t.includes('flyer') ||
    t.includes('infografia') ||
    t.includes('infografía')
  );
}

function shouldSendFlyer(text) {
  const t = normalizeText(text);

  return (
    asksForFlyer(text) ||
    t.includes('domingos') ||
    t.includes('domingo') ||
    t.includes('tecnificacion') ||
    t.includes('tecnificación') ||
    t.includes('horario') ||
    t.includes('precio') ||
    t.includes('tarifa') ||
    t.includes('informacion') ||
    t.includes('información')
  );
}

async function sendFlyerIfUseful(chatId, text) {
  if (!shouldSendFlyer(text)) return false;

  const flyerPath = getFlyerPath();

  if (!flyerPath) {
    console.log('Cartel no encontrado. Sube domingos-tecnificacion.jpg junto a index.js');
    return false;
  }

  try {
    const media = MessageMedia.fromFilePath(flyerPath);
    await client.sendMessage(chatId, media, {
      caption: asksForFlyer(text)
        ? 'Claro, le paso el cartel.'
        : 'Le paso también el cartel por si le ayuda.'
    });
    return true;
  } catch (error) {
    console.error('No se pudo enviar cartel:', error?.stack || error?.message || error);
    return false;
  }
}

function isEnglish(text) {
  return /\b(hello|hi|price|training|academy|football|soccer|player|schedule|where|how much|english|international|information|register|sign up|camp|clinic)\b/i.test(text);
}

function getMadridHour() {
  return Number(
    new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      hour12: false
    }).format(new Date())
  );
}

function isOutOfHours() {
  const hour = getMadridHour();
  return hour >= 22 || hour < 9;
}

function shouldAlertCEO(text) {
  const t = normalizeText(text);

  return (
    t.includes('descuento') ||
    t.includes('rebaja') ||
    t.includes('queja') ||
    t.includes('reclamacion') ||
    t.includes('reclamar') ||
    t.includes('jefe') ||
    t.includes('director') ||
    t.includes('direccion') ||
    t.includes('ceo') ||
    t.includes('urgente') ||
    t.includes('problema') ||
    t.includes('molesto') ||
    t.includes('enfadado') ||
    t.includes('devolucion') ||
    t.includes('dinero') ||
    t.includes('hablar con manuel') ||
    t.includes('hablar con ivan') ||
    t.includes('hablar con iván') ||
    t.includes('persona real') ||
    t.includes('otra persona') ||
    t.includes('audio') ||
    t.includes('nota de voz') ||
    (t.includes('club') && t.includes('acuerdo')) ||
    t.includes('colaboracion') ||
    t.includes('colaboración') ||
    t.includes('prensa') ||
    t.includes('legal')
  );
}

function basicFallback(text) {
  const t = normalizeText(text);

  if (isEnglish(text)) {
    return 'Hi.\n\nThis is Daniela from Special One Academy.\n\nI can help you with training, schedules, prices or registration.';
  }

  if (asksForFlyer(text)) {
    return 'Sí, se lo paso ahora.';
  }

  if (t.includes('hola') || t.includes('buenas')) {
    return 'Buenas.\n\nSoy Daniela, de Special One Academy.\n\n¿En qué puedo ayudarle?';
  }

  if (t.includes('precio') || t.includes('cuanto') || t.includes('cuánto') || t.includes('tarifa')) {
    return 'Domingos de Tecnificación:\n\n1 sesión: 19,90 €\n2 sesiones: 34,95 €\n4 sesiones: 64,90 €';
  }

  if (t.includes('horario') || t.includes('cuando') || t.includes('cuándo')) {
    return 'Los domingos tenemos tres franjas:\n\n09:00 a 10:00\n10:00 a 11:00\n11:00 a 12:00';
  }

  if (t.includes('ropa') || t.includes('equipacion') || t.includes('equipación')) {
    return 'Para tecnificación no es obligatorio comprar la ropa oficial desde el primer día.\n\nSí recomendamos tenerla para que todos vayan uniformados.\n\nSe puede adquirir en Soccerfactory, en el Polígono PISA de Mairena.';
  }

  if (t.includes('individual') || t.includes('solo') || t.includes('entrenador')) {
    return 'Los domingos trabajamos en grupos reducidos, de 2 a 12 jugadores.\n\nLas sesiones individuales existen, pero se organizan aparte y tienen otra tarifa.';
  }

  if (t.includes('portero') || t.includes('porteros')) {
    return 'Sí, también trabajamos con porteros.\n\nEl trabajo se adapta a su posición: blocaje, caídas, desplazamientos, juego aéreo y acciones reales.';
  }

  if (t.includes('ubicacion') || t.includes('ubicación') || t.includes('donde') || t.includes('dónde')) {
    return 'Entrenamos en Club Río Grande.\n\nEstá en Mairena del Aljarafe, Sevilla.';
  }

  if (t.includes('apuntar') || t.includes('inscripcion') || t.includes('inscripción') || t.includes('reservar')) {
    return 'Perfecto.\n\nPrimero vemos qué necesita el jugador y la disponibilidad.\n\nDespués le paso el formulario para dejar la solicitud registrada.';
  }

  if (t.includes('domingo') || t.includes('tecnificacion') || t.includes('tecnificación')) {
    return 'Sí, tenemos Domingos de Tecnificación desde octubre.\n\nSon sesiones de 60 minutos en Club Río Grande.\n\nTrabajamos en grupos reducidos, con mucho balón y correcciones individuales.';
  }

  return 'Perfecto.\n\nCuénteme un poco qué necesita y le oriento.';
}

async function alertCEOs({ from, userMessage, reason, aiResponse }) {
  const cleanPhone = from.replace('@c.us', '').replace('@lid', '');

  const alertText =
`DANIELA - AVISO A DIRECCIÓN

Motivo: ${reason}

Cliente: ${from}

Mensaje recibido:
"${userMessage}"

Respuesta de Daniela:
"${aiResponse || 'Pendiente'}"

El chat queda pausado durante 2 horas.

Para reactivar Daniela en este chat:
Desde el WhatsApp de empresa:
/activar

Desde vuestro móvil personal al WhatsApp empresa:
/activar ${cleanPhone}`;

  for (const ceo of CEO_NUMBERS) {
    try {
      await sendRawMessage(ceo, alertText);
    } catch (error) {
      console.error(`Error avisando a CEO ${ceo}:`, error?.stack || error?.message || error);
    }
  }
}

async function safeOpenAIRequest(payload) {
  return Promise.race([
    openai.chat.completions.create(payload),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('OpenAI timeout')), 25000)
    )
  ]);
}

async function getDanielaResponse(from, text) {
  const history = conversations.get(from) || [];
  const outOfHours = isOutOfHours();
  const english = isEnglish(text);

  const systemPrompt = `
Eres Daniela, atención al cliente de Special One Academy por WhatsApp.

Hablas como una persona real del equipo. No como chatbot.

Reglas de escritura:
- Mensajes cortos.
- Una idea por mensaje.
- No cierres siempre con pregunta.
- No digas "claro" o "perfecto" en cada respuesta.
- No repitas lo que el cliente acaba de decir.
- No hagas listas largas salvo que pidan precios u horarios.
- No uses tono de folleto.
- No uses frases tipo "no se trata solo de X, sino de Y".
- No uses palabras grandilocuentes.
- No uses "es importante destacar", "cabe mencionar" ni "vale la pena señalar".
- No uses "crucial", "fundamental", "clave", "potenciar", "elevar", "transformador", "robusto", "panorama".
- No termines con resumen.
- No uses preguntas retóricas.
- No pidas datos demasiado pronto.
- Si el cliente solo quiere información, informa.
- Si quiere reservar, pide datos poco a poco.
- Como máximo una pregunta por respuesta.
- Si tienes que decir tres cosas, separa en frases cortas.
- No uses emojis salvo uno suave cuando encaje.
- No digas que eres IA ni bot.
- Si no sabes algo, dilo y deriva.

Actitud:
Tranquila, cercana, profesional.
No presiones.
No intentes cerrar reserva en cada mensaje.
Primero ayuda. Después guía.

Estado actual:
La Pre Pretemporada ya terminó. No la vendas como programa activo.

Programa principal:
Domingos de Tecnificación 2026/27.

Datos del programa:
- Empieza en octubre.
- Lugar: Club Río Grande, Mairena del Aljarafe, Sevilla.
- Para prebenjamín, benjamín, alevín, infantil, cadete y juvenil.
- Para jugadores y porteros.
- Sesiones de 60 minutos.
- Grupos reducidos.
- Mínimo 2 jugadores.
- Máximo 12 jugadores.
- Enfoque técnico individual.
- Mucho contacto con balón.
- Correcciones personalizadas.
- Situaciones reales de juego.
- Trabajo específico por posición.
- Comprensión del juego.

No vendas este programa como preparación física.
No lo vendas como entrenamiento táctico colectivo.

Horarios:
09:00 a 10:00
10:00 a 11:00
11:00 a 12:00

Tarifas:
1 sesión: 19,90 €
2 sesiones: 34,95 €
4 sesiones: 64,90 €

Reservas:
Se reservan por meses.
Las plazas son limitadas.
Nunca confirmes plaza.
Di que comprobamos disponibilidad antes de confirmar.

Formulario:
${TRAINING_FORM}

No envíes el formulario al primer mensaje salvo que el cliente lo pida o quiera reservar claramente.

Flujo humano de reserva:
Primero habla normal.
Si quiere reservar, pide solo dos datos:
"¿Es jugador o portero? ¿Y qué año de nacimiento tiene?"
Después puedes pedir club, posición, domingos deseados y horario preferido.
No pidas todo de golpe.

Sesiones individuales:
No confundas domingos de tecnificación con sesiones individuales.
Los domingos son grupos reducidos de 2 a 12 jugadores.
Las sesiones individuales existen, pero se gestionan aparte y tienen otro precio. No inventes precio.

Porteros:
Sí hay trabajo para porteros.
Adapta la explicación: blocaje, caídas, desplazamientos, juego aéreo, coordinación, golpeo y situaciones reales.

Ropa oficial:
Para tecnificación no es obligatorio comprar la ropa oficial desde el primer día.
Sí recomendamos adquirirla para que todos vayan uniformados.
La ropa oficial se puede comprar en Soccerfactory Sevilla Aljarafe.
Dirección pública: C/ Nobel, 6, Nave 1, Parque P.I.S.A., Mairena del Aljarafe, Sevilla.
No inventes precios de ropa.

Entre semana:
La academia está buscando un día entre semana.
Depende de la planificación de entrenamientos del Club Río Grande y de si queda un hueco interesante.
Todavía no hay día ni horario oficial.
No inventes fechas.

Si preguntan por cartel o imagen:
No digas que no tienes cartel.
Di algo corto como:
"Sí, se lo paso ahora."
El sistema enviará la imagen.

Programa internacional:
Special One International Experience.
Para futbolistas internacionales.
Puede incluir entrenamientos individuales, entrenamientos grupales, partidos en ligas privadas no federadas, evaluación técnica final, certificado y equipación.
Nunca prometas pruebas, fichajes ni representación.
Formulario internacional: ${INTERNATIONAL_FORM}

Deriva a dirección con [[AVISAR_CEO]] si hay:
quejas, descuentos, incidencias, acuerdos con clubes, colaboraciones, prensa, temas legales, cliente molesto o petición especial.

Ejemplos de tono:

Cliente: "Buenas tardes"
Daniela:
"Buenas tardes."
"Soy Daniela, de Special One Academy."
"¿En qué puedo ayudarle?"

Cliente: "Quería informarme"
Daniela:
"Sí."
"Ahora mismo tenemos abiertos los Domingos de Tecnificación."
"Empiezan en octubre, en Club Río Grande."

Cliente: "Solo tenéis sesiones individuales?"
Daniela:
"No exactamente."
"Los domingos trabajamos en grupos reducidos, de 2 a 12 jugadores."
"Las sesiones individuales van aparte y se organizan directamente con nosotros."

Cliente: "Y los domingos solo?"
Daniela:
"De momento sí."
"Estamos viendo también un día entre semana."
"Pero depende de los horarios que cierre el Club Río Grande."

Cliente: "La ropa es obligatoria?"
Daniela:
"No es obligatoria desde el primer día."
"Sí recomendamos la ropa oficial para que todos vayan uniformados."
"Se puede adquirir en Soccerfactory, en el Polígono PISA de Mairena."

Contexto:
Fuera de horario: ${outOfHours ? 'SÍ' : 'NO'}
Inglés detectado: ${english ? 'SÍ' : 'NO'}
`;

  try {
    const completion = await safeOpenAIRequest({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: text }
      ],
      temperature: 0.48,
      max_tokens: 170
    });

    let response = completion?.choices?.[0]?.message?.content || '';

    if (!response.trim()) response = basicFallback(text);

    const escalate = response.includes('[[AVISAR_CEO]]') || shouldAlertCEO(text);
    response = response.replace('[[AVISAR_CEO]]', '').trim();

    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-14));

    return { response, escalate };
  } catch (error) {
    console.error('OpenAI Daniela error:', error?.stack || error?.message || error);

    const response = basicFallback(text);
    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-14));

    return { response, escalate: shouldAlertCEO(text) };
  }
}

client.on('qr', async (qr) => {
  whatsappStatus = 'qr_ready';
  qrImage = await qrcode.toDataURL(qr);
  console.log('QR listo en /qr');
});

client.on('loading_screen', (percent, message) => {
  console.log(`Cargando WhatsApp: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
  whatsappStatus = 'authenticated';
  console.log('WhatsApp autenticado correctamente');
});

client.on('auth_failure', (msg) => {
  whatsappStatus = 'auth_failure';
  console.error('Error de autenticación WhatsApp:', msg);
});

client.on('ready', () => {
  whatsappStatus = 'ready';
  qrImage = '';
  console.log('DANIELA SPECIAL ONE ONLINE');
  console.log(`Daniela model: ${OPENAI_MODEL}`);
  console.log('VERSION DANIELA HUMAN SALES 2026-09-10');
});

client.on('disconnected', (reason) => {
  whatsappStatus = 'disconnected';
  console.error('WhatsApp desconectado:', reason);
});

client.on('message_create', async (message) => {
  try {
    if (!message.fromMe) return;

    const chatId = message.to || message.from;
    const body = (message.body || '').trim();

    if (!chatId) return;

    const cleanBody = normalizeText(body);

    if (cleanBody.startsWith('/activar')) {
      activateChat(chatId);
      console.log(`Chat reactivado manualmente desde empresa: ${chatId}`);
      return;
    }

    if (isActivationGrace(chatId)) {
      console.log(`Mensaje ignorado por ventana de activación: ${chatId}`);
      return;
    }

    if (wasRecentlySentByBot(chatId, body)) {
      console.log(`Mensaje automático ignorado para pausa: ${chatId}`);
      return;
    }

    if (cleanBody.startsWith('/pausar')) {
      pauseChat(chatId, 2);
      console.log(`Chat pausado manualmente desde empresa: ${chatId}`);
      return;
    }

    if (CEO_NUMBERS.includes(chatId)) {
      console.log(`Mensaje hacia CEO ignorado para pausa: ${chatId}`);
      return;
    }

    pauseChat(chatId, 2);
    console.log(`Chat pausado por intervención humana real desde WhatsApp empresa: ${chatId}`);
  } catch (error) {
    console.error('Error en message_create:', error?.stack || error?.message || error);
  }
});

client.on('message', async (message) => {
  try {
    const from = message.from;
    const text = (message.body || '').trim();
    const cleanText = normalizeText(text);

    if (!from) return;
    if (message.fromMe) return;

    console.log(`Mensaje recibido de ${from}: ${text}`);

    if (CEO_NUMBERS.includes(from) && cleanText.startsWith('/activar')) {
      const targetChatId = normalizePhone(text);

      if (!targetChatId) {
        await sendDanielaMessage(from, 'Envíe el comando así: /activar 614806029');
        return;
      }

      activateChat(targetChatId);
      await sendDanielaMessage(from, `Daniela reactivada para el chat ${targetChatId.replace('@c.us', '')}.`);
      return;
    }

    if (CEO_NUMBERS.includes(from) && cleanText.startsWith('/pausar')) {
      const targetChatId = normalizePhone(text);

      if (!targetChatId) {
        await sendDanielaMessage(from, 'Envíe el comando así: /pausar 614806029');
        return;
      }

      pauseChat(targetChatId, 2);
      await sendDanielaMessage(from, `Daniela pausada durante 2 horas para el chat ${targetChatId.replace('@c.us', '')}.`);
      return;
    }

    if (isPaused(from)) {
      console.log(`Chat pausado, Daniela no responde: ${from}`);
      return;
    }

    if (message.hasMedia || message.type === 'ptt' || message.type === 'audio') {
      const reply = 'Ahora mismo no puedo escuchar audios desde aquí.\n\n¿Me lo puede escribir por texto y lo reviso?';

      await sleep(humanDelay(reply));
      await sendDanielaMessage(from, reply);

      await alertCEOs({
        from,
        userMessage: 'Audio / nota de voz recibida',
        reason: 'Cliente ha enviado un audio',
        aiResponse: reply
      });

      pauseChat(from, 2);
      return;
    }

    if (!text) return;

    if (asksForFlyer(text)) {
      await sendFlyerIfUseful(from, text);
      await sleep(1200);
    }

    let chat;

    try {
      chat = await message.getChat();
      await chat.sendStateTyping();
    } catch (chatError) {
      console.error('No se pudo activar estado escribiendo:', chatError?.stack || chatError?.message || chatError);
    }

    const { response, escalate } = await getDanielaResponse(from, text);

    await sleep(humanDelay(response));
    await sendDanielaMessage(from, response);

    if (!asksForFlyer(text)) {
      await sendFlyerIfUseful(from, text);
    }

    console.log(`Respuesta enviada a ${from}`);

    if (chat) {
      try {
        await chat.clearState();
      } catch (clearError) {
        console.error('No se pudo limpiar estado escribiendo:', clearError?.stack || clearError?.message || clearError);
      }
    }

    if (escalate) {
      await alertCEOs({
        from,
        userMessage: text,
        reason: 'Consulta marcada para revisar por dirección',
        aiResponse: response
      });

      pauseChat(from, 2);
    }
  } catch (error) {
    console.error('Error Daniela completo:', error?.stack || error?.message || error);

    try {
      const fallback = basicFallback(message?.body || '');
      await sendDanielaMessage(message.from, fallback);
      await sendFlyerIfUseful(message.from, message?.body || '');
    } catch (sendError) {
      console.error('Error enviando fallback Daniela:', sendError?.stack || sendError?.message || sendError);
    }
  }
});

app.get('/', (req, res) => {
  res.send(`Daniela activa | Estado WhatsApp: ${whatsappStatus}`);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsapp: whatsappStatus,
    pausedChats: pausedChats.size,
    conversations: conversations.size,
    uptime: process.uptime()
  });
});

app.get('/qr', (req, res) => {
  if (!qrImage) {
    return res.send(`QR aún no generado o WhatsApp ya está vinculado. Estado actual: ${whatsappStatus}`);
  }

  res.send(`
    <html>
      <body style="font-family:Arial;text-align:center;padding:40px;">
        <h1>QR WhatsApp Special One</h1>
        <img src="${qrImage}" width="360"/>
        <p>Escanéalo desde WhatsApp -> Dispositivos vinculados</p>
        <p>Estado actual: ${whatsappStatus}</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log('Servidor web activo en puerto', PORT);
});

client.initialize().catch((error) => {
  whatsappStatus = 'initialize_error';
  console.error('Error inicializando WhatsApp:', error?.stack || error?.message || error);
});
