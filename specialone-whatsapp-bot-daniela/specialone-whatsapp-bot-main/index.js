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

const MEMORY_FILES = [
  path.join(__dirname, 'daniela-memory.json'),
  path.join(__dirname, 'memory', 'daniela-memory.json')
];

const DEFAULT_MEMORY = {
  academy: {
    name: 'Special One Academy',
    phone: '+34 614 80 60 29',
    email: 'info@academiaspecialone.es',
    website: 'https://www.academiaspecialone.es/',
    location: 'Club Río Grande, Mairena del Aljarafe, Sevilla'
  },
  training: {
    name: 'Special One Training',
    active: true,
    starts: 'octubre',
    duration_minutes: 60,
    group_min: 2,
    group_max: 12,
    audience: 'jugadores, jugadoras y porteros desde prebenjamín hasta juvenil',
    weekday_status: 'Actualmente las sesiones regulares están abiertas los domingos. La academia está trabajando para abrir también un día entre semana, pero todavía no existe un día ni un horario confirmado porque depende de la planificación de entrenamientos del Club Río Grande.',
    schedules: ['09:00 a 10:00', '10:00 a 11:00', '11:00 a 12:00'],
    prices: {
      '1 sesión': '19,90 €',
      '2 sesiones': '34,95 €',
      '4 sesiones': '64,90 €'
    },
    form: 'https://tally.so/r/NpMjqB'
  },
  individual: {
    name: 'Special One Individual Training',
    form: 'https://tally.so/r/lbxql6'
  },
  experience: {
    name: 'Special One Experience',
    active_form: false
  },
  international: {
    name: 'Special One International Experience',
    form: 'https://tally.so/r/pbREOV'
  },
  clothing: {
    required_first_day: false,
    recommended: true,
    returned: false,
    store: 'Soccerfactory Sevilla Aljarafe',
    address: 'C/ Nobel, 6, Nave 1, Parque P.I.S.A., Mairena del Aljarafe, Sevilla'
  },
  scholarships: {
    available: false
  }
};

function mergeMemory(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;

  const output = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base?.[key] &&
      typeof base[key] === 'object' &&
      !Array.isArray(base[key])
    ) {
      output[key] = mergeMemory(base[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function loadMemory() {
  for (const memoryFile of MEMORY_FILES) {
    if (!fs.existsSync(memoryFile)) continue;

    try {
      const parsed = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
      console.log(`Memoria de Daniela cargada desde: ${memoryFile}`);
      return mergeMemory(DEFAULT_MEMORY, parsed);
    } catch (error) {
      console.error(`Error leyendo ${memoryFile}:`, error?.message || error);
    }
  }

  console.warn('No se encontró daniela-memory.json. Daniela usará la memoria de respaldo.');
  return DEFAULT_MEMORY;
}

let memory = loadMemory();

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
const processedMessageIds = new Map();
const chatAliases = new Map();

const CEO_NUMBERS = [
  '34637993550@c.us',
  '34644287792@c.us'
];

const TRAINING_FORM = 'https://tally.so/r/NpMjqB';
const INDIVIDUAL_TRAINING_FORM = 'https://tally.so/r/lbxql6';
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
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.PUPTEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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

function isPrivateClientChatId(chatId) {
  return Boolean(
    chatId &&
    typeof chatId === 'string' &&
    (chatId.endsWith('@c.us') || chatId.endsWith('@lid'))
  );
}

function isSystemOrGroupChatId(chatId) {
  return Boolean(
    !chatId ||
    chatId === 'status@broadcast' ||
    chatId.endsWith('@broadcast') ||
    chatId.endsWith('@g.us') ||
    chatId.endsWith('@newsletter')
  );
}

function normalizeChatTarget(raw) {
  if (!raw) return null;

  const explicit = String(raw).match(/(\d+@(c\.us|lid))/i);
  if (explicit) return explicit[1].toLowerCase();

  return normalizePhone(raw);
}

function rememberAliases(ids) {
  const valid = [...new Set(ids.filter(Boolean).filter(isPrivateClientChatId))];
  for (const id of valid) chatAliases.set(id, valid);
  return valid;
}

function getChatAliases(chatId) {
  return chatAliases.get(chatId) || [chatId];
}

async function discoverChatAliases(chatId, message = null) {
  const aliases = new Set([chatId]);

  try {
    if (message && typeof message.getContact === 'function') {
      const contact = await message.getContact();

      const serialized = contact?.id?._serialized;
      if (serialized && isPrivateClientChatId(serialized)) aliases.add(serialized);

      if (contact?.number) {
        const normalized = normalizePhone(contact.number);
        if (normalized) aliases.add(normalized);
      }
    }
  } catch (error) {
    console.warn(`No se pudo resolver contacto ${chatId}:`, error?.message || error);
  }

  if (typeof client.getContactLidAndPhone === 'function') {
    try {
      const result = await client.getContactLidAndPhone([chatId]);
      const row = result?.[0];

      for (const candidate of [row?.lid, row?.pn]) {
        const serialized =
          typeof candidate === 'string'
            ? candidate
            : candidate?._serialized;

        if (serialized && isPrivateClientChatId(serialized)) aliases.add(serialized);
      }
    } catch (error) {
      console.warn(`No se pudo resolver LID/teléfono ${chatId}:`, error?.message || error);
    }
  }

  return rememberAliases([...aliases]);
}

function isCEOChat(chatId) {
  const ceoDigits = CEO_NUMBERS.map(id => id.replace(/\D/g, ''));

  return getChatAliases(chatId).some(id => {
    const digits = String(id).replace(/\D/g, '');
    return ceoDigits.some(ceo => digits === ceo);
  });
}

function isDuplicateMessage(message) {
  const id = message?.id?._serialized;
  if (!id) return false;

  const previous = processedMessageIds.get(id);
  if (previous && Date.now() - previous < 120000) return true;

  processedMessageIds.set(id, Date.now());

  setTimeout(() => {
    processedMessageIds.delete(id);
  }, 120000);

  return false;
}

function pauseChat(chatId, hours = 2) {
  const until = Date.now() + hours * 60 * 60 * 1000;
  for (const id of getChatAliases(chatId)) pausedChats.set(id, until);
}

function activateChat(chatId) {
  for (const id of getChatAliases(chatId)) {
    pausedChats.delete(id);
    activationGraceUntil.set(id, Date.now() + 45000);
  }
}

function isActivationGrace(chatId) {
  for (const id of getChatAliases(chatId)) {
    const until = activationGraceUntil.get(id);
    if (!until) continue;

    if (Date.now() > until) {
      activationGraceUntil.delete(id);
      continue;
    }

    return true;
  }

  return false;
}

function isPaused(chatId) {
  for (const id of getChatAliases(chatId)) {
    const until = pausedChats.get(id);
    if (!until) continue;

    if (Date.now() > until) {
      pausedChats.delete(id);
      continue;
    }

    return true;
  }

  return false;
}

function markBotMessage(chatId, body) {
  if (!body) return;

  const key = `${chatId}:${normalizeText(body).slice(0, 180)}`;
  recentBotBodies.set(key, Date.now());

  setTimeout(() => {
    recentBotBodies.delete(key);
  }, 90000);
}

function wasRecentlySentByBot(chatId, body) {
  if (!body) return false;

  for (const id of getChatAliases(chatId)) {
    const key = `${id}:${normalizeText(body).slice(0, 180)}`;
    const bodyTime = recentBotBodies.get(key);

    if (bodyTime && Date.now() - bodyTime < 90000) return true;
  }

  return false;
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
  return asksForFlyer(text);
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
  const t = normalizeText(text);

  const spanishMarkers = (
    t.includes('hola') ||
    t.includes('buenas') ||
    t.includes('formulario') ||
    t.includes('inscripcion') ||
    t.includes('solicitud') ||
    t.includes('quedo pendiente') ||
    t.includes('muchas gracias') ||
    t.includes('clases') ||
    t.includes('tecnificacion') ||
    t.includes('tecnificación') ||
    t.includes('informacion') ||
    t.includes('información') ||
    t.includes('queria') ||
    t.includes('quería') ||
    t.includes('pedir') ||
    t.includes('para mi hijo') ||
    t.includes('la hora') ||
    t.includes('el valor')
  );

  if (spanishMarkers) return false;

  return /\b(hello|hi|price|academy|football|soccer|player|schedule|where|how much|english|international|information|register|sign up|camp|clinic|form|submitted|application|confirmation)\b/i.test(text);
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

function isSubmittedFormMessage(text) {
  const t = normalizeText(text);

  const spanishSubmitted = (
    t.includes('acabo de completar') ||
    t.includes('acabo de enviar') ||
    t.includes('he completado') ||
    t.includes('he enviado') ||
    t.includes('he mandado') ||
    t.includes('he rellenado') ||
    t.includes('complete') ||
    t.includes('envie') ||
    t.includes('mande') ||
    t.includes('rellene')
  );

  const spanishForm = (
    t.includes('formulario') ||
    t.includes('inscripcion') ||
    t.includes('solicitud')
  );

  const englishSubmitted = (
    t.includes('i have just submitted') ||
    t.includes('i just submitted') ||
    t.includes('i have submitted') ||
    t.includes('submitted') ||
    t.includes('completed') ||
    t.includes('filled out') ||
    t.includes('sent')
  );

  const englishForm = (
    t.includes('form') ||
    t.includes('registration') ||
    t.includes('application') ||
    t.includes('request')
  );

  return (
    (spanishSubmitted && spanishForm) ||
    (englishSubmitted && englishForm) ||
    t.includes('quedo pendiente de la confirmacion de mi solicitud')
  );
}

function submittedFormReply(text) {
  if (isEnglish(text)) {
    return 'Thank you. We have received your request.\n\nOur team will review it and contact you with the next steps.';
  }

  return 'Muchas gracias. Hemos recibido su solicitud correctamente.\n\nNuestro equipo la revisará y se pondrá en contacto con usted con los siguientes pasos.';
}

function wantsForm(text) {
  const t = normalizeText(text);

  return (
    t.includes('quiero inscribirme') ||
    t.includes('quiero apuntarme') ||
    t.includes('quiero reservar') ||
    t.includes('quiero hacer la reserva') ||
    t.includes('quiero hacer la inscripcion') ||
    t.includes('quiero hacer la inscripción') ||
    t.includes('mandame el formulario') ||
    t.includes('mándame el formulario') ||
    t.includes('enviame el formulario') ||
    t.includes('envíame el formulario') ||
    t.includes('pasame el formulario') ||
    t.includes('pásame el formulario') ||
    t.includes('necesito el formulario') ||
    t.includes('rellenar formulario') ||
    t.includes('completar formulario') ||
    t.includes('hacer la inscripcion') ||
    t.includes('hacer la inscripción') ||
    t.includes('formalizar la reserva') ||
    t.includes('reservar plaza') ||
    t.includes('register') ||
    t.includes('sign up') ||
    t.includes('registration form') ||
    t.includes('application form')
  );
}

function detectProgram(text) {
  const t = normalizeText(text);

  if (
    t.includes('individual') ||
    t.includes('entrenamiento individual') ||
    t.includes('sesion individual') ||
    t.includes('sesión individual') ||
    t.includes('one to one') ||
    t.includes('1 to 1') ||
    t.includes('personal training')
  ) {
    return 'individual';
  }

  if (
    t.includes('international') ||
    t.includes('internacional') ||
    t.includes('extranjero') ||
    t.includes('extranjeros') ||
    t.includes('foreign') ||
    t.includes('spain experience') ||
    t.includes('futbol espanol') ||
    t.includes('fútbol español')
  ) {
    return 'international';
  }

  if (
    t.includes('clinic') ||
    t.includes('clinics') ||
    t.includes('experience') ||
    t.includes('navidad') ||
    t.includes('semana santa') ||
    t.includes('verano') ||
    t.includes('camp') ||
    t.includes('campus')
  ) {
    return 'experience';
  }

  if (
    t.includes('training') ||
    t.includes('tecnificacion') ||
    t.includes('tecnificación') ||
    t.includes('domingos') ||
    t.includes('domingo') ||
    t.includes('temporada') ||
    t.includes('academia permanente') ||
    t.includes('grupo reducido') ||
    t.includes('grupos reducidos')
  ) {
    return 'training';
  }

  return null;
}

function formReply(text) {
  const program = detectProgram(text);
  const english = isEnglish(text);

  const trainingForm = memory?.training?.form || TRAINING_FORM;
  const individualForm = memory?.individual?.form || INDIVIDUAL_TRAINING_FORM;
  const internationalForm = memory?.international?.form || INTERNATIONAL_FORM;

  if (program === 'individual') {
    if (english) {
      return `Yes, for Individual Training you can complete this form:\n\n${individualForm}\n\nOnce it is submitted, we will review the request before confirming anything.`;
    }

    return `Sí, para Special One Individual Training puede completar este formulario:\n\n${individualForm}\n\nCuando lo recibamos, revisamos la solicitud antes de confirmar nada.`;
  }

  if (program === 'international') {
    if (english) {
      return `Yes, for the International Experience you can complete this form:\n\n${internationalForm}\n\nOnce it is submitted, we will review the request and tell you the next steps.`;
    }

    return `Sí, para International Experience puede completar este formulario:\n\n${internationalForm}\n\nCuando lo recibamos, revisamos la solicitud y le indicamos los siguientes pasos.`;
  }

  if (program === 'experience') {
    if (english) {
      return 'For Special One Experience, the form is only opened when there is an active clinic.';
    }

    return 'Para Special One Experience solo abrimos formulario cuando hay un clinic activo.';
  }

  if (program === 'training') {
    if (english) {
      return `Yes, for Special One Training you can complete this form:\n\n${trainingForm}\n\nOnce it is submitted, we will review availability before confirming anything.`;
    }

    return `Para Special One Training puede completar este formulario:\n\n${trainingForm}\n\nCuando lo recibamos, revisamos disponibilidad antes de confirmar nada.`;
  }

  if (english) {
    return 'To send you the right form, tell me which programme you are interested in.';
  }

  return 'Para pasarle el formulario correcto, dígame qué programa le interesa.';
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
    t.includes('incluido') ||
    t.includes('incluida') ||
    t.includes('incluye') ||
    t.includes('servicios incluidos') ||
    t.includes('esta incluido') ||
    t.includes('está incluido') ||
    t.includes('visado') ||
    t.includes('visa') ||
    t.includes('alojamiento') ||
    t.includes('transporte') ||
    t.includes('condiciones') ||
    t.includes('cancelacion') ||
    t.includes('cancelación') ||
    t.includes('paquete personalizado') ||
    t.includes('programa personalizado') ||
    t.includes('modificar paquete') ||
    t.includes('modificar programa') ||
    t.includes('disponibilidad real') ||
    t.includes('fechas cerradas') ||
    t.includes('horarios cerrados') ||
    (t.includes('club') && t.includes('acuerdo')) ||
    t.includes('colaboracion') ||
    t.includes('colaboración') ||
    t.includes('prensa') ||
    t.includes('legal')
  );
}

function directAcademyReply(text) {
  const t = normalizeText(text);
  const english = isEnglish(text);
  const training = memory?.training || {};
  const prices = training.prices || {};
  const schedules = training.schedules || [];

  if (isSubmittedFormMessage(text)) {
    return { reply: submittedFormReply(text), sendFlyer: false };
  }

  if (wantsForm(text)) {
    return { reply: formReply(text), sendFlyer: false };
  }

  if (t.includes('beca') || t.includes('ayuda economica')) {
    return {
      reply: english
        ? 'At the moment we do not offer scholarships or financial aid.'
        : 'Ahora mismo no tenemos becas ni ayudas económicas.',
      sendFlyer: false
    };
  }

  if (
    t.includes('entre semana') ||
    t.includes('lunes') ||
    t.includes('martes') ||
    t.includes('miercoles') ||
    t.includes('jueves') ||
    t.includes('viernes')
  ) {
    return {
      reply: english
        ? 'At the moment, regular Special One Training sessions are open on Sundays. We are working on opening an additional weekday, but there is no confirmed day or time yet.'
        : `De momento las sesiones regulares están abiertas los domingos.\n\n${training.weekday_status || 'Estamos trabajando para abrir también un día entre semana, pero todavía no hay día ni horario confirmado.'}`,
      sendFlyer: false
    };
  }

  if (
    t.includes('precio') ||
    t.includes('cuanto cuesta') ||
    t.includes('cuanto sale') ||
    t.includes('tarifa') ||
    t.includes('valor')
  ) {
    return {
      reply: english
        ? 'Tell me which programme you mean and I will give you the confirmed price information.'
        : `Las tarifas actuales de Special One Training son:\n\n1 sesión: ${prices['1 sesión'] || '19,90 €'}\n2 sesiones: ${prices['2 sesiones'] || '34,95 €'}\n4 sesiones: ${prices['4 sesiones'] || '64,90 €'}`,
      sendFlyer: false
    };
  }

  if (
    t.includes('horario') ||
    t.includes('a que hora') ||
    t.includes('que hora') ||
    t.includes('franja')
  ) {
    return {
      reply: english
        ? `Sunday sessions are currently:\n\n${schedules.join('\n')}`
        : `Los domingos trabajamos actualmente en estos horarios:\n\n${schedules.join('\n')}`,
      sendFlyer: false
    };
  }

  if (
    t.includes('ubicacion') ||
    t.includes('donde entrenais') ||
    t.includes('donde entrenan') ||
    t.includes('donde son')
  ) {
    return {
      reply: english
        ? `Training takes place at ${memory?.academy?.location || training.location}.`
        : `Las sesiones se realizan en ${memory?.academy?.location || training.location}.`,
      sendFlyer: false
    };
  }

  if (
    t.includes('portero') ||
    t.includes('porteros') ||
    t.includes('arquero') ||
    t.includes('arqueros')
  ) {
    return {
      reply: english
        ? 'Yes. We also work with goalkeepers and adapt the session to their position.'
        : 'Sí, también trabajamos con porteros.\n\nEl entrenamiento se adapta a su posición y a las necesidades específicas del jugador.',
      sendFlyer: false
    };
  }

  if (t.includes('ropa') || t.includes('equipacion')) {
    return {
      reply: english
        ? 'The official kit is not compulsory from the first day.'
        : `La ropa oficial no es obligatoria desde el primer día.\n\nSí recomendamos tenerla para que todos vayan uniformados.\n\nLa ropa no se devuelve. Se puede adquirir en ${memory?.clothing?.store || 'Soccerfactory Sevilla Aljarafe'}.`,
      sendFlyer: false
    };
  }

  if (asksForFlyer(text)) {
    return {
      reply: english ? 'Yes, I will send it to you now.' : 'Sí, se lo paso ahora.',
      sendFlyer: true
    };
  }

  return null;
}

function basicFallback(text) {
  const direct = directAcademyReply(text);

  if (direct?.reply) return direct.reply;

  if (isEnglish(text)) {
    return 'Tell me what information you need and I will help you.';
  }

  return 'Dígame qué información necesita y le ayudo.';
}

async function alertCEOs({ from, userMessage, reason, aiResponse }) {
  if (!from || isSystemOrGroupChatId(from) || !isPrivateClientChatId(from)) {
    console.log(`Aviso a dirección cancelado por origen no válido: ${from}`);
    return;
  }

  const phoneAlias = getChatAliases(from).find(id => id.endsWith('@c.us'));
  const cleanPhone = (phoneAlias || from).replace('@c.us', '').replace('@lid', '');

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

MEMORIA OFICIAL VIGENTE:
${JSON.stringify(memory)}

CONTEXTO DE CONVERSACIÓN:
Usa los mensajes anteriores. No respondas cada mensaje como si fuera una conversación nueva.
Si el cliente corrige, insiste o aclara algo, responde exactamente a ese punto.
Si pregunta "¿y entre semana?" después de hablar de tecnificación, entiende que sigue hablando de Special One Training.

REGLA PRINCIPAL DE PRECISIÓN:
Daniela nunca debe asumir, completar, interpretar ni inventar información que no esté definida explícitamente en su memoria oficial.

La prioridad siempre es:
PRECISIÓN > RAPIDEZ

Si hay conflicto entre ser resolutiva y ser precisa, siempre prioriza la precisión.

Antes de responder sobre cualquier aspecto operativo, comercial o logístico, comprueba mentalmente:
1. ¿Tengo esta información definida explícitamente?
2. ¿Está vigente?
3. ¿Estoy respondiendo con un dato confirmado o con una suposición?

Si hay cualquier duda, no respondas como si supieras la respuesta.
Deriva al equipo con [[AVISAR_CEO]].

Nunca inventes:
- Precios.
- Descuentos.
- Disponibilidad.
- Horarios definitivos.
- Fechas.
- Plazas.
- Entrenadores asignados.
- Clubes colaboradores.
- Partidos.
- Alojamientos.
- Transporte.
- Visados.
- Servicios incluidos.
- Condiciones de cancelación.
- Duración de programas.
- Programas personalizados.

Reglas de escritura:
- Mensajes cortos.
- Una idea por mensaje.
- No cierres siempre con pregunta.
- No digas "claro" o "perfecto" en cada respuesta.
- No repitas lo que el cliente acaba de decir.
- No uses tono de folleto.
- No pidas datos demasiado pronto.
- Si el cliente solo quiere información, informa.
- Como máximo una pregunta por respuesta.
- No digas que eres IA ni bot.
- Si no sabes algo, deriva.

Actitud:
Tranquila, cercana, profesional.
No presiones.
Primero ayuda. Después guía.

Estado actual:
La Pre Pretemporada ya terminó. No la vendas como programa activo.

Programas actuales:
- Special One Training.
- Special One Experience.
- Special One International Experience.
- Special One Individual Training.

Programa principal:
Special One Training durante la temporada.

Entre semana:
Todavía no hay día ni horario oficial.

No envíes formularios cuando el cliente solo pide información.

Solo envía formulario si el cliente pide claramente inscribirse, reservar, apuntarse o recibir el formulario.

Nunca confirmes plaza automáticamente.

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
      temperature: 0.22,
      max_tokens: 220
    });

    let response = completion?.choices?.[0]?.message?.content || '';

    if (!response.trim()) response = basicFallback(text);

    const escalate = response.includes('[[AVISAR_CEO]]') || shouldAlertCEO(text);
    response = response.replace(/\[\[AVISAR_CEO\]\]/g, '').trim();

    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-18));

    return { response, escalate };
  } catch (error) {
    console.error('OpenAI Daniela error:', error?.stack || error?.message || error);

    const response = basicFallback(text);

    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-18));

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
  console.log('VERSION DANIELA V2 SINGLE FILE 2026-09-19');
});

client.on('disconnected', (reason) => {
  whatsappStatus = 'disconnected';
  console.error('WhatsApp desconectado:', reason);
});

client.on('message_create', async (message) => {
  try {
    if (!message.fromMe) return;
    if (isDuplicateMessage(message)) return;

    const chatId = message.to || message.from;
    const body = (message.body || '').trim();

    if (!chatId) return;

    if (isSystemOrGroupChatId(chatId) || !isPrivateClientChatId(chatId)) {
      console.log(`Mensaje propio ignorado por no ser chat privado de cliente: ${chatId}`);
      return;
    }

    await discoverChatAliases(chatId, message);

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

    if (isCEOChat(chatId)) {
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
    if (isDuplicateMessage(message)) return;

    if (isSystemOrGroupChatId(from)) {
      console.log('Mensaje de estado/grupo/broadcast ignorado. Daniela no responde.');
      return;
    }

    if (!isPrivateClientChatId(from)) {
      console.log(`Mensaje ignorado por no ser chat privado de cliente: ${from}`);
      return;
    }

    await discoverChatAliases(from, message);

    console.log(`Mensaje recibido de ${from}: ${text}`);

    if (isCEOChat(from) && cleanText.startsWith('/activar')) {
      const targetChatId = normalizeChatTarget(text);

      if (!targetChatId) {
        await sendDanielaMessage(from, 'Envíe el comando así: /activar 614806029 o /activar ID@lid');
        return;
      }

      await discoverChatAliases(targetChatId);
      activateChat(targetChatId);

      await sendDanielaMessage(
        from,
        `Daniela reactivada para el chat ${targetChatId}.`
      );

      return;
    }

    if (isCEOChat(from) && cleanText.startsWith('/pausar')) {
      const targetChatId = normalizeChatTarget(text);

      if (!targetChatId) {
        await sendDanielaMessage(from, 'Envíe el comando así: /pausar 614806029 o /pausar ID@lid');
        return;
      }

      await discoverChatAliases(targetChatId);
      pauseChat(targetChatId, 2);

      await sendDanielaMessage(
        from,
        `Daniela pausada durante 2 horas para el chat ${targetChatId}.`
      );

      return;
    }

    if (isCEOChat(from) && cleanText === '/recargar memoria') {
      memory = loadMemory();

      await sendDanielaMessage(
        from,
        'Memoria de Daniela recargada correctamente.'
      );

      return;
    }

    if (isPaused(from)) {
      console.log(`Chat pausado, Daniela no responde: ${from}`);
      return;
    }

    if (
      message.hasMedia ||
      message.type === 'ptt' ||
      message.type === 'audio'
    ) {
      const reply =
        'Ahora mismo no puedo revisar audios o archivos desde aquí.\n\n¿Me lo puede escribir por texto?';

      await sleep(humanDelay(reply));
      await sendDanielaMessage(from, reply);

      await alertCEOs({
        from,
        userMessage: 'Audio o archivo recibido',
        reason: 'Cliente ha enviado contenido que requiere revisión humana',
        aiResponse: reply
      });

      pauseChat(from, 2);
      return;
    }

    if (!text) return;

    const direct = directAcademyReply(text);

    if (direct) {
      await sleep(humanDelay(direct.reply));
      await sendDanielaMessage(from, direct.reply);

      if (direct.sendFlyer) {
        await sleep(650);
        await sendFlyerIfUseful(from, text);
      }

      const history = conversations.get(from) || [];

      conversations.set(from, [
        ...history,
        { role: 'user', content: text },
        { role: 'assistant', content: direct.reply }
      ].slice(-18));

      console.log(`Respuesta directa enviada a ${from}`);
      return;
    }

    let chat;

    try {
      chat = await message.getChat();
      await chat.sendStateTyping();
    } catch (chatError) {
      console.error(
        'No se pudo activar estado escribiendo:',
        chatError?.stack || chatError?.message || chatError
      );
    }

    const { response, escalate } =
      await getDanielaResponse(from, text);

    await sleep(humanDelay(response));
    await sendDanielaMessage(from, response);

    console.log(`Respuesta enviada a ${from}`);

    if (chat) {
      try {
        await chat.clearState();
      } catch (clearError) {
        console.error(
          'No se pudo limpiar estado escribiendo:',
          clearError?.stack || clearError?.message || clearError
        );
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
    console.error(
      'Error Daniela completo:',
      error?.stack || error?.message || error
    );

    try {
      const fallback = basicFallback(
        message?.body || ''
      );

      if (
        message?.from &&
        isPrivateClientChatId(message.from)
      ) {
        await sendDanielaMessage(
          message.from,
          fallback
        );
      }
    } catch (sendError) {
      console.error(
        'Error enviando fallback Daniela:',
        sendError?.stack ||
        sendError?.message ||
        sendError
      );
    }
  }
});

app.get('/', (req, res) => {
  res.send(
    `Daniela activa | Estado WhatsApp: ${whatsappStatus}`
  );
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsapp: whatsappStatus,
    memoryLoaded: Boolean(memory),
    pausedChats: pausedChats.size,
    conversations: conversations.size,
    uptime: process.uptime()
  });
});

app.get('/qr', (req, res) => {
  if (!qrImage) {
    return res.send(
      `QR aún no generado o WhatsApp ya está vinculado. Estado actual: ${whatsappStatus}`
    );
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
  console.log(
    'Servidor web activo en puerto',
    PORT
  );
});

client.initialize().catch((error) => {
  whatsappStatus = 'initialize_error';

  console.error(
    'Error inicializando WhatsApp:',
    error?.stack ||
    error?.message ||
    error
  );
});
