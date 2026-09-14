const fs = require('fs');const path = require('path');const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
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
    executablePath: process.env.PUPTEER_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
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
    return 'Perfect, thank you.\n\nWe have received your request.\n\nWe will now review it and let you know the next steps.';
  }

  return 'Perfecto, gracias.\n\nHemos recibido su solicitud correctamente.\n\nAhora la revisamos y le iremos informando de los siguientes pasos.';
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

  if (program === 'individual') {
    if (english) {
      return `Yes, for Individual Training you can complete this form:\n\n${INDIVIDUAL_TRAINING_FORM}\n\nOnce it is submitted, we will review the request before confirming anything.`;
    }

    return `Sí, para entrenamiento individual puede completar este formulario:\n\n${INDIVIDUAL_TRAINING_FORM}\n\nCuando lo recibamos, revisamos la solicitud antes de confirmar nada.`;
  }

  if (program === 'international') {
    if (english) {
      return `Yes, for the International Experience you can complete this form:\n\n${INTERNATIONAL_FORM}\n\nOnce it is submitted, we will review the request and tell you the next steps.`;
    }

    return `Sí, para International Experience puede completar este formulario:\n\n${INTERNATIONAL_FORM}\n\nCuando lo recibamos, revisamos la solicitud y le indicamos los siguientes pasos.`;
  }

  if (program === 'experience') {
    if (english) {
      return 'For Special One Experience, the form is only opened when there is an active clinic.\n\nRight now, tell me which clinic you are interested in and we will review it with you.';
    }

    return 'Para Special One Experience solo abrimos formulario cuando hay un clinic activo.\n\nAhora mismo dígame qué clinic le interesa y lo revisamos con usted.';
  }

  if (program === 'training') {
    if (english) {
      return `Yes, for Special One Training you can complete this form:\n\n${TRAINING_FORM}\n\nOnce it is submitted, we will review availability before confirming anything.`;
    }

    return `Sí, para Special One Training puede completar este formulario:\n\n${TRAINING_FORM}\n\nCuando lo recibamos, revisamos disponibilidad antes de confirmar nada.`;
  }

  if (english) {
    return 'To send you the right form, tell me which programme you are interested in: Training, Individual Training, International Experience or Experience.';
  }

  return 'Para pasarle el formulario correcto, dígame para qué programa es: Training, Entrenamiento Individual, International Experience o Experience.';
}

function shouldHandleFormDirectly(text) {
  return isSubmittedFormMessage(text) || wantsForm(text);
}

function directFormResponse(text) {
  if (isSubmittedFormMessage(text)) return submittedFormReply(text);
  return formReply(text);
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

function basicFallback(text) {
  const t = normalizeText(text);

  if (isSubmittedFormMessage(text)) {
    return submittedFormReply(text);
  }

  if (wantsForm(text)) {
    return formReply(text);
  }

  if (t.includes('beca') || t.includes('ayuda economica') || t.includes('ayuda económica')) {
    return 'Ahora mismo no tenemos becas ni ayudas económicas.';
  }

  if (isEnglish(text)) {
    return 'Hi.\n\nThis is Daniela from Special One Academy.\n\nI can help you with training, schedules, prices or registration.';
  }

  if (asksForFlyer(text)) {
    return 'Sí, se lo paso ahora.';
  }

  if (t.includes('hola') || t.includes('buenas')) {
    return 'Buenas.\n\nSoy Daniela, de Special One Academy.\n\n¿En qué puedo ayudarle?';
  }

  if (t.includes('precio') || t.includes('cuanto') || t.includes('cuánto') || t.includes('tarifa') || t.includes('valor')) {
    return 'Domingos de Tecnificación:\n\n1 sesión: 19,90 €\n2 sesiones: 34,95 €\n4 sesiones: 64,90 €';
  }

  if (t.includes('horario') || t.includes('cuando') || t.includes('cuándo') || t.includes('hora')) {
    return 'Los domingos tenemos tres franjas:\n\n09:00 a 10:00\n10:00 a 11:00\n11:00 a 12:00';
  }

  if (t.includes('ropa') || t.includes('equipacion') || t.includes('equipación')) {
    return 'Para tecnificación no es obligatorio comprar la ropa oficial desde el primer día.\n\nSí recomendamos tenerla para que todos vayan uniformados.\n\nLa ropa no se devuelve. Si la compra el jugador o se la damos nosotros, es del jugador.';
  }

  if (t.includes('individual') || t.includes('solo') || t.includes('entrenador')) {
    return 'Los domingos trabajamos en grupos reducidos, de 2 a 12 jugadores.\n\nLas sesiones individuales existen, pero se organizan aparte y tienen otra tarifa.';
  }

  if (t.includes('portero') || t.includes('porteros') || t.includes('arquero') || t.includes('arqueros')) {
    return 'Sí, también trabajamos con porteros.\n\nEn Domingos de Tecnificación adaptamos el trabajo a su posición: blocaje, caídas, desplazamientos, juego aéreo y situaciones reales.';
  }

  if (t.includes('ubicacion') || t.includes('ubicación') || t.includes('donde') || t.includes('dónde')) {
    return 'Entrenamos en Club Río Grande.\n\nEstá en Mairena del Aljarafe, Sevilla.';
  }

  if (t.includes('apuntar') || t.includes('inscripcion') || t.includes('inscripción') || t.includes('reservar')) {
    return formReply(text);
  }

  if (t.includes('domingo') || t.includes('tecnificacion') || t.includes('tecnificación') || t.includes('clases')) {
    return 'Sí, tenemos Domingos de Tecnificación desde octubre.\n\nSon sesiones de 60 minutos en Club Río Grande.\n\nTrabajamos en grupos reducidos, con mucho balón y correcciones individuales.';
  }

  return 'Perfecto.\n\nCuénteme un poco qué necesita y le oriento.';
}

async function alertCEOs({ from, userMessage, reason, aiResponse }) {
  if (!from || from === 'status@broadcast' || from.endsWith('@broadcast') || !from.endsWith('@c.us')) {
    console.log(`Aviso a dirección cancelado por origen no válido: ${from}`);
    return;
  }

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

Temas especialmente sensibles:
- Precios.
- Descuentos.
- Promociones.
- Equipaciones.
- Qué material se entrega o se devuelve.
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
- Cambios personalizados en programas.
- Aspectos contractuales o comerciales.

Nunca uses estas expresiones para completar información que no esté confirmada:
- "Normalmente..."
- "Generalmente..."
- "Lo habitual es..."
- "Seguramente..."
- "Probablemente..."
- "Creo que..."
- "Debería..."
- "Lo más común es..."

Nunca transformes una suposición en una respuesta comercial.
Nunca inventes una política para parecer resolutiva.
Nunca completes información faltante con conocimiento general.

Cuando falte información confirmada, responde de forma breve y profesional:
"Para darte una respuesta totalmente correcta, necesitamos confirmar este punto con nuestro equipo.

En cuanto lo tengamos revisado, te responderemos con la información definitiva."

No digas:
- "No sé."
- "No tengo esa información."
- "Pregúntale a otra persona."

Becas y ayudas económicas:
No tenemos becas ni ayudas económicas.
Si preguntan por becas o ayudas económicas, responde de forma breve que ahora mismo no tenemos becas ni ayudas económicas.
No inventes alternativas, condiciones especiales ni descuentos.

Ropa y equipaciones:
La ropa no se devuelve.
Si la compra el jugador o se la damos nosotros, es del jugador.
Nunca digas que la ropa es solo para usar durante el programa.
Nunca digas que normalmente no se la quedan.
Nunca inventes precios de ropa.

CASO ESPECIAL: SPECIAL ONE INTERNATIONAL EXPERIENCE
En programas internacionales debes ser especialmente estricta.

Nunca inventes:
- Precios.
- Horarios.
- Clubes.
- Partidos.
- Equipaciones.
- Alojamientos.
- Visados.
- Servicios incluidos.
- Duración.
- Disponibilidad.
- Calendarios.
- Programas personalizados.

Cada experiencia internacional puede depender de:
- Edad.
- Año de nacimiento.
- Fechas de estancia.
- Entrenamientos disponibles.
- Calendario de partidos.
- Club colaborador.
- Servicios contratados.

Si el usuario solicita cualquier detalle internacional que no esté expresamente definido, escala con [[AVISAR_CEO]].

Sí puedes responder directamente cuando la información esté claramente definida:
- Teléfono oficial.
- Web oficial.
- Ubicación.
- Nombre de programas.
- Filosofía de la academia.
- Tarifas oficiales registradas.
- Horarios oficiales registrados.
- Condiciones expresamente definidas.
- Información publicada y vigente.

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

Programas actuales:
- Academia permanente durante la temporada: Special One Training.
- Clinics de Navidad, Semana Santa y verano: Special One Experience.
- Jugadores extranjeros: Special One International Experience.
- Entrenamiento individual: Special One Individual Training.

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

Formularios:
Special One Training: ${TRAINING_FORM}
Special One Individual Training: ${INDIVIDUAL_TRAINING_FORM}
Special One International Experience: ${INTERNATIONAL_FORM}
Special One Experience: no hay formulario activo salvo que haya un clinic abierto.

Si el cliente dice que ya ha completado, enviado o rellenado un formulario:
- No le pidas datos otra vez.
- No le vuelvas a mandar el formulario.
- No expliques otra vez el programa.
- No confirmes plaza.
- No inventes fechas ni horarios.
- Responde breve: que la solicitud está recibida, que la revisamos y que se le indicarán los siguientes pasos.
- Responde en el mismo idioma del cliente.

No envíes formularios cuando el cliente solo pide información.

Si dice:
- "quiero información"
- "quería pedir información"
- "me gustaría saber"
- "clases de tecnificación"
- "escuela de arqueros"
- "horarios"
- "precios"
- "valor"
- "para mi hijo"

responde primero informando y orientando.

Solo envía formulario si el cliente pide claramente inscribirse, reservar, apuntarse o recibir el formulario.

Nunca conviertas una petición de información en una inscripción.

No envíes el formulario al primer mensaje salvo que el cliente lo pida o quiera reservar claramente.

Si pide formulario o quiere inscribirse:
- Detecta el programa.
- Para Special One Training envía: ${TRAINING_FORM}
- Para Special One Individual Training envía: ${INDIVIDUAL_TRAINING_FORM}
- Para Special One International Experience envía: ${INTERNATIONAL_FORM}
- Para Special One Experience indica que solo hay formulario cuando hay clinic activo.
- Si no sabes el programa, pregunta solo qué programa le interesa.
- Nunca confirmes plaza por enviar o recibir formulario.

Flujo humano de reserva:
Primero habla normal.
Si quiere reservar, pide solo dos datos:
"¿Es jugador o portero? ¿Y qué año de nacimiento tiene?"
Después puedes pedir club, posición, domingos deseados y horario preferido.
No pidas todo de golpe.

Sesiones individuales:
No confundas domingos de tecnificación con sesiones individuales.
Los domingos son grupos reducidos de 2 a 12 jugadores.
Las sesiones individuales existen, pero se gestionan aparte y tienen otro formulario.
Formulario sesiones individuales: ${INDIVIDUAL_TRAINING_FORM}

Porteros:
Sí hay trabajo para porteros.
En Domingos de Tecnificación también pueden entrenar porteros.
Adapta la explicación: blocaje, caídas, desplazamientos, juego aéreo, coordinación, golpeo y situaciones reales.
No digas que existe una escuela específica de arqueros si no está definida como programa separado.

Ropa oficial:
Para tecnificación no es obligatorio comprar la ropa oficial desde el primer día.
Sí recomendamos adquirirla para que todos vayan uniformados.
La ropa oficial se puede comprar en Soccerfactory Sevilla Aljarafe.
Dirección pública: C/ Nobel, 6, Nave 1, Parque P.I.S.A., Mairena del Aljarafe, Sevilla.
La ropa no se devuelve.
Si la compra el jugador o se la damos nosotros, es del jugador.
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
No inventes precios, duración, disponibilidad, alojamientos, visados, horarios, clubes, partidos ni servicios incluidos.
Formulario internacional: ${INTERNATIONAL_FORM}

Deriva a dirección con [[AVISAR_CEO]] si hay:
quejas, descuentos, incidencias, acuerdos con clubes, colaboraciones, prensa, temas legales, cliente molesto, petición especial, precios no definidos, modificación de paquetes, servicios incluidos no definidos, condiciones especiales, visados, alojamiento, transporte, disponibilidad real, fechas no cerradas u horarios no cerrados.

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

Cliente: "Quería pedir información sobre las clases de tecnificación"
Daniela:
"Sí."
"Tenemos Domingos de Tecnificación desde octubre, en Club Río Grande."
"Son sesiones de 60 minutos en grupos reducidos."

Cliente: "Escuela de arqueros"
Daniela:
"No tenemos una escuela específica de arqueros como programa separado."
"Pero en Domingos de Tecnificación también trabajamos con porteros."
"El entrenamiento se adapta a su posición."

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

Cliente: "¿La equipación se devuelve?"
Daniela:
"No, la ropa no se devuelve."
"Si la compra el jugador o se la damos nosotros, es del jugador."

Cliente: "¿Tenéis ayudas económicas?"
Daniela:
"Ahora mismo no tenemos becas ni ayudas económicas."

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

    if (chatId === 'status@broadcast' || chatId.endsWith('@broadcast') || !chatId.endsWith('@c.us')) {
      console.log(`Mensaje propio ignorado por no ser chat privado de cliente: ${chatId}`);
      return;
    }

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

    if (from === 'status@broadcast' || from.endsWith('@broadcast')) {
      console.log('Mensaje de estado/broadcast ignorado. Daniela no responde.');
      return;
    }

    if (!from.endsWith('@c.us')) {
      console.log(`Mensaje ignorado por no ser chat privado de cliente: ${from}`);
      return;
    }

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

    if (shouldHandleFormDirectly(text)) {
      const reply = directFormResponse(text);

      await sleep(humanDelay(reply));
      await sendDanielaMessage(from, reply);

      console.log(`Respuesta de formulario enviada a ${from}`);
      return;
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
