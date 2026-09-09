const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
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

function cleanChromiumLocks(dir) {
  if (!fs.existsSync(dir)) return;

  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

  function scan(currentPath) {
    let items = [];
    try {
      items = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);

      if (item.isDirectory()) scan(fullPath);
      else if (lockFiles.includes(item.name)) {
        try {
          fs.rmSync(fullPath, { force: true });
          console.log(`Lock Chromium eliminado: ${fullPath}`);
        } catch {}
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
    t.includes('nota de voz')
  );
}

function basicFallback(text) {
  const t = normalizeText(text);

  if (isEnglish(text)) {
    return 'Hi 😊 This is Daniela from Special One Academy.\n\nI can help you with training information, schedules, location or registration.\n\nWhat would you like to know?';
  }

  if (t.includes('hola') || t.includes('buenas') || t.includes('disponible')) {
    return 'Buenas 😊 Soy Daniela de Special One Academy.\n\nSí, dígame. ¿En qué puedo ayudarle?';
  }

  if (t.includes('precio') || t.includes('cuanto') || t.includes('cuánto')) {
    return 'Claro 😊 Depende del tipo de entrenamiento o programa que necesite.\n\n¿Sería para tecnificación semanal, un clinic puntual o un jugador internacional?';
  }

  if (t.includes('horario') || t.includes('cuando') || t.includes('cuándo')) {
    return 'Le explico 😊 Los horarios dependen del grupo, edad y programa.\n\n¿Me dice la edad del jugador y qué tipo de entrenamiento busca?';
  }

  if (t.includes('ubicacion') || t.includes('ubicación') || t.includes('donde') || t.includes('dónde')) {
    return 'Estamos en Club Río Grande, en Mairena del Aljarafe, Sevilla 😊\n\n¿Quiere que le pase información sobre entrenamientos?';
  }

  if (t.includes('apuntar') || t.includes('inscripcion') || t.includes('inscripción') || t.includes('formulario')) {
    return `Perfecto 😊 Para entrenamientos de tecnificación puede completar este formulario:\n\n${TRAINING_FORM}\n\nCuando lo recibamos, revisamos la solicitud.`;
  }

  return 'Perfecto 😊 Cuénteme un poco qué necesita y le oriento.\n\n¿Es para información de entrenamientos, horarios, precios o inscripción?';
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
Eres Daniela, recepcionista de Special One Academy por WhatsApp.

Tu misión es atender como una persona real: amable, breve, clara y útil.

Estilo:
- Español natural de España.
- Cercana y profesional.
- Máximo 80 palabras normalmente.
- No sueltes toda la información de golpe.
- Haz como máximo una pregunta por mensaje.
- No parezcas una IA.
- No digas "soy bot".
- No uses lenguaje corporativo.
- No inventes precios, fechas ni plazas.
- Si no sabes algo, di que lo consultas con dirección.

Special One Academy:
- Academia de tecnificación y formación futbolística.
- Sede: Club Río Grande, Ctra. San Juan Palomares, 9, 41927 Mairena del Aljarafe, Sevilla.
- Teléfono: +34 614 80 60 29.
- Email: academyspecialone@gmail.com.
- Instagram/TikTok: @specialoneacademy_.
- Categorías: desde prebenjamín hasta juvenil.

Programas actuales:
1. Special One Training:
Tecnificación semanal durante la temporada. Grupos reducidos.
Formulario: ${TRAINING_FORM}

2. Special One Experience:
Clinics y eventos especiales cuando hay convocatoria abierta.

3. Special One International Experience:
Programa para jugadores extranjeros o jugadores que buscan experiencia en fútbol español.
Formulario: ${INTERNATIONAL_FORM}

Importante:
La Pre Pretemporada 2026 ya terminó. Si preguntan por eso, explica que esa campaña ya finalizó y ofrece Training o próximos clinics.

Si solo saludan:
"Buenas 😊 Soy Daniela de Special One Academy.

¿En qué puedo ayudarle?"

Si piden precios:
No des precio cerrado si no está confirmado. Pregunta primero por el programa y edad del jugador.

Si quieren apuntarse:
Pasa el formulario de Special One Training si encaja:
${TRAINING_FORM}

Escala a dirección añadiendo [[AVISAR_CEO]] si hay:
queja, reclamación, descuento, cliente molesto, dirección, Manuel, Iván, audio, situación compleja o algo que no puedas resolver con seguridad.

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
      temperature: 0.7,
      max_tokens: 220
    });

    let response = completion?.choices?.[0]?.message?.content || '';

    if (!response.trim()) response = basicFallback(text);

    const escalate = response.includes('[[AVISAR_CEO]]') || shouldAlertCEO(text);
    response = response.replace('[[AVISAR_CEO]]', '').trim();

    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-10));

    return { response, escalate };
  } catch (error) {
    console.error('OpenAI Daniela error:', error?.stack || error?.message || error);

    const response = basicFallback(text);
    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-10));

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

    const chat = await message.getChat();

    try {
      await chat.sendStateTyping();
    } catch {}

    const { response, escalate } = await getDanielaResponse(from, text);

    await sleep(humanDelay(response));
    await sendDanielaMessage(from, response);

    console.log(`Respuesta enviada a ${from}`);

    try {
      await chat.clearState();
    } catch {}

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
  console.log('VERSION DANIELA SAFE FALLBACK 2026-09-09');
});

client.initialize().catch((error) => {
  whatsappStatus = 'initialize_error';
  console.error('❌ Error inicializando WhatsApp:', error?.stack || error?.message || error);
});
