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

function humanDelay(text) {
  const length = (text || '').length;
  const base = 2500;
  const extra = Math.min(length * 25, 5500);
  return base + extra + Math.floor(Math.random() * 1200);
}

function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

  if (body) {
    const key = normalizeText(body).slice(0, 180);
    recentBotBodies.set(key, Date.now());

    setTimeout(() => {
      recentBotBodies.delete(key);
    }, 90000);
  }
}

function wasRecentlySentByBot(chatId, body) {
  const last = botSentMessages.get(chatId);
  if (last && Date.now() - last < 90000) return true;

  const key = normalizeText(body).slice(0, 180);
  const bodyTime = recentBotBodies.get(key);

  return Boolean(bodyTime && Date.now() - bodyTime < 90000);
}

async function sendDanielaMessage(chatId, text) {
  markBotMessage(chatId, text);
  await client.sendMessage(chatId, text);
}

function getFlyerPath() {
  return FLYER_PATHS.find(filePath => fs.existsSync(filePath));
}

function shouldSendFlyer(text) {
  const t = normalizeText(text);

  return (
    t.includes('domingo') ||
    t.includes('tecnificacion') ||
    t.includes('tecnificación') ||
    t.includes('horario') ||
    t.includes('precio') ||
    t.includes('tarifa') ||
    t.includes('cartel') ||
    t.includes('info') ||
    t.includes('informacion') ||
    t.includes('información')
  );
}

async function sendFlyerIfUseful(chatId, text) {
  const flyerPath = getFlyerPath();

  if (!flyerPath || !shouldSendFlyer(text)) return;

  try {
    const media = MessageMedia.fromFilePath(flyerPath);
    await client.sendMessage(chatId, media, {
      caption: 'Le paso también el cartel de Domingos de Tecnificación para que tenga la información a mano 😊'
    });
  } catch (error) {
    console.error('No se pudo enviar cartel:', error?.stack || error?.message || error);
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
    t.includes('club') && t.includes('acuerdo') ||
    t.includes('colaboracion') ||
    t.includes('colaboración')
  );
}

function basicFallback(text) {
  const t = normalizeText(text);

  if (isEnglish(text)) {
    return 'Hi 😊 This is Daniela from Special One Academy.\n\nI can help you with our technical training sessions, schedules, location or registration.\n\nWhat would you like to know?';
  }

  if (t.includes('hola') || t.includes('buenas') || t.includes('disponible')) {
    return 'Buenas 😊 Soy Daniela de Special One Academy.\n\nSí, dígame. ¿En qué puedo ayudarle?';
  }

  if (t.includes('precio') || t.includes('cuanto') || t.includes('cuánto') || t.includes('tarifa')) {
    return 'Claro 😊 Para los Domingos de Tecnificación las tarifas son:\n\n1 sesión: 19,90 €\n2 sesiones: 34,95 €\n4 sesiones: 64,90 €\n\nLas plazas son limitadas y siempre revisamos disponibilidad antes de confirmar.';
  }

  if (t.includes('horario') || t.includes('cuando') || t.includes('cuándo')) {
    return 'Los Domingos de Tecnificación tienen tres franjas 😊\n\n09:00 a 10:00\n10:00 a 11:00\n11:00 a 12:00\n\nCada jugador entrena en la franja reservada. ¿Me dice año de nacimiento y si es jugador o portero?';
  }

  if (t.includes('ubicacion') || t.includes('ubicación') || t.includes('donde') || t.includes('dónde')) {
    return 'Estamos en Club Río Grande, en Mairena del Aljarafe, Sevilla 😊\n\nAhí realizamos los Domingos de Tecnificación.';
  }

  if (t.includes('apuntar') || t.includes('inscripcion') || t.includes('inscripción') || t.includes('formulario') || t.includes('reservar')) {
    return 'Perfecto 😊 Antes de enviarle el formulario, necesito organizar bien la solicitud.\n\n¿Me dice el nombre del jugador, año de nacimiento y si es jugador o portero?';
  }

  if (t.includes('domingo') || t.includes('tecnificacion') || t.includes('tecnificación')) {
    return 'Los Domingos de Tecnificación empiezan en octubre en Club Río Grande 😊\n\nSon sesiones de 60 minutos, en grupos reducidos, centradas en la mejora técnica individual del futbolista.\n\n¿Sería para jugador o portero?';
  }

  return 'Perfecto 😊 Cuénteme un poco qué necesita y le oriento.\n\n¿Busca información sobre Domingos de Tecnificación, horarios, tarifas o inscripción?';
}

async function alertCEOs({ from, userMessage, reason, aiResponse }) {
  const cleanPhone = from.replace('@c.us', '').replace('@lid', '');

  const alertText =
`🚨 DANIELA - AVISO A DIRECCIÓN

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

Desde vuestro móvil personal al WhatsApp de empresa:
/activar ${cleanPhone}`;

  for (const ceo of CEO_NUMBERS) {
    try {
      await sendDanielaMessage(ceo, alertText);
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
Eres Daniela, responsable de atención al cliente de Special One Academy por WhatsApp.

Nunca respondas como chatbot. Habla como si formaras parte del equipo de la academia.

Misión:
- Resolver dudas.
- Recomendar el programa adecuado.
- Guiar a cada familia.
- Ayudar a iniciar la reserva del jugador.
- Detectar oportunidades comerciales.
- Derivar al equipo humano solo cuando haga falta.

Estilo:
- Profesional, humano, cercano y organizado.
- Español natural de España.
- Mensajes breves, claros y útiles.
- Máximo 80 palabras normalmente.
- Una sola pregunta por mensaje.
- No sueltes toda la información de golpe.
- No digas que eres IA o bot.
- No uses frases vacías.
- No exageres resultados.
- No digas que somos la mejor academia.
- Transmite confianza y mejora individual.

Estado actual:
La Pre Pretemporada ha finalizado. No la vendas como programa activo.

Programa principal actual:
DOMINGOS DE TECNIFICACIÓN 2026/27.

Inicio:
Octubre.

Ubicación:
Club Río Grande, Mairena del Aljarafe, Sevilla.

Destinatarios:
Prebenjamín, benjamín, alevín, infantil, cadete y juvenil.
Disponible para jugadores y porteros.

Metodología:
Sesiones de 60 minutos.
Enfoque técnico.
Se trabaja:
- Técnica individual.
- Correcciones personalizadas.
- Mucho contacto con balón.
- Situaciones reales de juego.
- Técnica específica por posición.
- Comprensión del juego.
- Desarrollo individual.

No lo vendas como preparación física.
No lo vendas como entrenamiento táctico colectivo.
La prioridad es la mejora técnica individual del futbolista.

Horarios:
Domingos:
09:00 - 10:00
10:00 - 11:00
11:00 - 12:00

Cada jugador entrena únicamente en la franja previamente reservada.
Nunca garantices disponibilidad.

Grupos:
Reducidos.
Mínimo 2 jugadores.
Máximo 12 jugadores.

Beneficios:
Más participación, más correcciones individuales, mejor aprendizaje y seguimiento más cercano.

Tarifas:
1 sesión: 19,90 €
2 sesiones: 34,95 €
4 sesiones: 64,90 €

Nunca modifiques precios.
Nunca inventes promociones.
Nunca negocies tarifas.

Reservas:
Las reservas se hacen por meses.
Ejemplo: durante septiembre se reservan los domingos de octubre.
También pueden realizarse hasta el día anterior si quedan plazas.
Las plazas son limitadas.
Nunca confirmes plaza directamente.

Cuando una familia quiera reservar, di:
"Hemos recibido tu solicitud y comprobaremos la disponibilidad antes de confirmar tu plaza."

Flujo de reserva:
Primero conversa. No envíes el formulario directamente.
Recopila poco a poco:
- Nombre del jugador.
- Año de nacimiento.
- Jugador o portero.
- Club actual.
- Posición.
- Objetivo principal.
- Domingos que quiere asistir.
- Horario preferido.
- Horario alternativo si lo acepta.

No pidas todo de golpe. Pide 2 o 3 datos como máximo por mensaje.
No repitas datos que el usuario ya haya dado durante la conversación.

Cuando tengas suficiente información, envía:
${TRAINING_FORM}

Explica:
"Este formulario nos ayuda a registrar correctamente al jugador y organizar todos los grupos."

Nunca digas que el formulario confirma la plaza.

Si un horario está completo:
No pierdas la inscripción. Ofrece otro horario o lista de espera.

Oportunidades por posición:
Si dicen que es delantero, portero, defensa, centrocampista o extremo, explica brevemente cómo se adapta el trabajo técnico a esa posición. No respondas genérico.

Tipos de cliente:
1. Nuevo jugador:
Explica, resuelve dudas, recoge información y guía hacia la reserva.

2. Alumno habitual:
No repitas toda la explicación. Pregunta directamente qué domingos desea reservar este mes.

3. Programa Internacional:
SPECIAL ONE INTERNATIONAL EXPERIENCE.
Experiencia personalizada para futbolistas internacionales.
Puede incluir entrenamientos individuales, entrenamientos grupales, partidos en ligas privadas no federadas, evaluación técnica final, certificado oficial y equipación necesaria.
Nunca prometas pruebas, fichajes ni representación.
Explica que el objetivo es la mejora del futbolista y vivir el fútbol español desde dentro.
Formulario internacional: ${INTERNATIONAL_FORM}

4. Clinics o eventos:
Responde solo con información oficial publicada. No inventes fechas.

Próximos servicios:
La academia está organizando entrenamientos entre semana.
Todavía no hay horarios oficiales.
Si preguntan, responde:
"Estamos trabajando en la organización de los grupos entre semana. En cuanto estén definidos los horarios y categorías los anunciaremos oficialmente."

Cuándo derivar:
Solo deriva si hay dudas económicas especiales, cambios fuera del funcionamiento habitual, confirmación de plazas, acuerdos con clubes, incidencias, colaboraciones, prensa o temas legales.
En esos casos añade [[AVISAR_CEO]].

Si solo saludan:
"Buenas 😊 Soy Daniela de Special One Academy.

¿En qué puedo ayudarle?"

Objetivo final:
Cada conversación debe terminar con un siguiente paso claro.
El usuario debe quedar informado, acompañado, con reserva iniciada o con formulario enviado cuando proceda.

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
      temperature: 0.65,
      max_tokens: 260
    });

    let response = completion?.choices?.[0]?.message?.content || '';

    if (!response.trim()) response = basicFallback(text);

    const escalate = response.includes('[[AVISAR_CEO]]') || shouldAlertCEO(text);
    response = response.replace('[[AVISAR_CEO]]', '').trim();

    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-12));

    return { response, escalate };
  } catch (error) {
    console.error('OpenAI Daniela error:', error?.stack || error?.message || error);

    const response = basicFallback(text);
    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-12));

    return { response, escalate: shouldAlertCEO(text) };
  }
}

client.on('qr', async (qr) => {
  whatsappStatus = 'qr_ready';
  qrImage = await qrcode.toDataURL(qr);
  console.log('📲 QR listo en /qr');
});

client.on('loading_screen', (percent, message) => {
  console.log(`⏳ Cargando WhatsApp: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
  whatsappStatus = 'authenticated';
  console.log('🔐 WhatsApp autenticado correctamente');
});

client.on('auth_failure', (msg) => {
  whatsappStatus = 'auth_failure';
  console.error('❌ Error de autenticación WhatsApp:', msg);
});

client.on('ready', () => {
  whatsappStatus = 'ready';
  qrImage = '';
  console.log('✅ DANIELA SPECIAL ONE ONLINE');
  console.log(`✅ Daniela model: ${OPENAI_MODEL}`);
  console.log('VERSION DANIELA DOMINGOS TECNIFICACION 2026-09-09');
});

client.on('disconnected', (reason) => {
  whatsappStatus = 'disconnected';
  console.error('🔌 WhatsApp desconectado:', reason);
});

client.on('message_create', async (message) => {
  try {
    if (!message.fromMe) return;

    const chatId = message.to || message.from;
    const body = (message.body || '').trim();

    if (!chatId) return;

    if (wasRecentlySentByBot(chatId, body)) {
      console.log(`Mensaje automático ignorado para pausa: ${chatId}`);
      return;
    }

    const cleanBody = normalizeText(body);

    if (cleanBody === '/activar') {
      activateChat(chatId);
      console.log(`Chat reactivado manualmente desde empresa: ${chatId}`);
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
      const reply = 'Ahora mismo no puedo escuchar audios desde aquí. ¿Me lo puede escribir por texto y lo reviso? 😊';

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
    await sendFlyerIfUseful(from, text);

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
  console.error('❌ Error inicializando WhatsApp:', error?.stack || error?.message || error);
});
