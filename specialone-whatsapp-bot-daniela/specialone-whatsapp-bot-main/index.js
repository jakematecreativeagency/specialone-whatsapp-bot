const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');

const { normalizeText, splitMessages, humanDelay } = require('./utils/text');
const {
  isPrivateClientChatId,
  isSystemOrGroupChatId,
  normalizeChatTarget
} = require('./utils/chat');
const { loadMemory } = require('./services/memory');
const {
  directReply,
  shouldAlertCEO
} = require('./services/intents');
const { getAIResponse, OPENAI_MODEL } = require('./services/openai');

const app = express();

const PORT = process.env.PORT || 8080;
const AUTH_PATH = process.env.WHATSAPP_AUTH_PATH || '/app/.wwebjs_auth';

const CEO_NUMBERS = [
  '34637993550@c.us',
  '34644287792@c.us'
];

const FLYER_PATHS = [
  path.join(__dirname, 'domingos-tecnificacion.jpg'),
  path.join(__dirname, 'domingos-tecnificacion.png'),
  path.join(__dirname, 'assets', 'domingos-tecnificacion.jpg'),
  path.join(__dirname, 'assets', 'domingos-tecnificacion.png')
];

let qrImage = '';
let whatsappStatus = 'starting';
let memory = loadMemory();

const conversations = new Map();
const pausedChats = new Map();
const botSentMessages = new Map();
const activationGraceUntil = new Map();
const processedMessageIds = new Map();
const chatAliases = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function cleanChromiumLocks(dir) {
  if (!fs.existsSync(dir)) return;

  const locks = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

  function scan(currentPath) {
    let items = [];

    try {
      items = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      const fullPath = path.join(currentPath, item.name);

      if (item.isDirectory()) {
        scan(fullPath);
      } else if (locks.includes(item.name)) {
        try {
          fs.rmSync(fullPath, { force: true });
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
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.PUPTEER_EXECUTABLE_PATH ||
      '/usr/bin/chromium',
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

function isDuplicateMessage(message) {
  const id = message?.id?._serialized;
  if (!id) return false;

  const old = processedMessageIds.get(id);
  if (old && Date.now() - old < 120000) return true;

  processedMessageIds.set(id, Date.now());
  setTimeout(() => processedMessageIds.delete(id), 120000);

  return false;
}

function rememberAliases(ids) {
  const valid = [...new Set(ids.filter(Boolean).filter(isPrivateClientChatId))];
  for (const id of valid) chatAliases.set(id, valid);
  return valid;
}

async function discoverAliases(chatId, message = null) {
  const aliases = new Set([chatId]);

  try {
    if (message && typeof message.getContact === 'function') {
      const contact = await message.getContact();
      const id = contact?.id?._serialized;
      if (id && isPrivateClientChatId(id)) aliases.add(id);
    }
  } catch {}

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
    } catch {}
  }

  return rememberAliases([...aliases]);
}

function getAliases(chatId) {
  return chatAliases.get(chatId) || [chatId];
}

function pauseChat(chatId, hours = 2) {
  for (const id of getAliases(chatId)) {
    pausedChats.set(id, Date.now() + hours * 60 * 60 * 1000);
  }
}

function activateChat(chatId) {
  for (const id of getAliases(chatId)) {
    pausedChats.delete(id);
    activationGraceUntil.set(id, Date.now() + 45000);
  }
}

function isPaused(chatId) {
  for (const id of getAliases(chatId)) {
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

function isActivationGrace(chatId) {
  const until = activationGraceUntil.get(chatId);
  if (!until) return false;
  if (Date.now() > until) {
    activationGraceUntil.delete(chatId);
    return false;
  }
  return true;
}

function markBotMessage(chatId) {
  botSentMessages.set(chatId, Date.now());
}

function wasRecentlySentByBot(chatId) {
  const last = botSentMessages.get(chatId);
  return Boolean(last && Date.now() - last < 10000);
}

async function sendRawMessage(chatId, text) {
  markBotMessage(chatId);
  await client.sendMessage(chatId, text);
}

async function sendDanielaMessage(chatId, text) {
  for (const part of splitMessages(text)) {
    await sendRawMessage(chatId, part);
    await sleep(500 + Math.floor(Math.random() * 700));
  }
}

function getFlyerPath() {
  return FLYER_PATHS.find(filePath => fs.existsSync(filePath));
}

async function sendFlyer(chatId) {
  const flyer = getFlyerPath();
  if (!flyer) return false;

  try {
    const media = MessageMedia.fromFilePath(flyer);
    await client.sendMessage(chatId, media, { caption: 'Le paso el cartel.' });
    return true;
  } catch (error) {
    console.error('No se pudo enviar cartel:', error?.message || error);
    return false;
  }
}

async function alertCEOs({ from, userMessage, reason, aiResponse }) {
  if (!isPrivateClientChatId(from)) return;

  const alertText =
`DANIELA - AVISO A DIRECCIÓN

Motivo: ${reason}

Cliente: ${from}

Mensaje recibido:
"${userMessage}"

Respuesta de Daniela:
"${aiResponse || 'Pendiente'}"

El chat queda pausado durante 2 horas.

Para reactivar:
/activar ${from}`;

  for (const ceo of CEO_NUMBERS) {
    try {
      await sendRawMessage(ceo, alertText);
    } catch (error) {
      console.error(`Error avisando a CEO ${ceo}:`, error?.message || error);
    }
  }
}

client.on('qr', async qr => {
  whatsappStatus = 'qr_ready';
  qrImage = await qrcode.toDataURL(qr);
  console.log('QR listo en /qr');
});

client.on('authenticated', () => {
  whatsappStatus = 'authenticated';
  console.log('WhatsApp autenticado correctamente');
});

client.on('auth_failure', msg => {
  whatsappStatus = 'auth_failure';
  console.error('Error de autenticación WhatsApp:', msg);
});

client.on('ready', () => {
  whatsappStatus = 'ready';
  qrImage = '';
  console.log('DANIELA V2 ONLINE');
  console.log(`Modelo: ${OPENAI_MODEL}`);
});

client.on('disconnected', reason => {
  whatsappStatus = 'disconnected';
  console.error('WhatsApp desconectado:', reason);
});

client.on('message_create', async message => {
  try {
    if (!message.fromMe) return;
    if (isDuplicateMessage(message)) return;

    const chatId = message.to || message.from;
    if (!chatId) return;

    if (isSystemOrGroupChatId(chatId) || !isPrivateClientChatId(chatId)) return;

    await discoverAliases(chatId, message);

    const body = (message.body || '').trim();
    const clean = normalizeText(body);

    if (clean.startsWith('/activar')) {
      activateChat(chatId);
      return;
    }

    if (clean.startsWith('/pausar')) {
      pauseChat(chatId, 2);
      return;
    }

    if (isActivationGrace(chatId)) return;
    if (wasRecentlySentByBot(chatId)) return;
    if (CEO_NUMBERS.includes(chatId)) return;

    pauseChat(chatId, 2);
    console.log(`Chat pausado por intervención humana: ${chatId}`);
  } catch (error) {
    console.error('Error en message_create:', error?.message || error);
  }
});

client.on('message', async message => {
  try {
    if (message.fromMe) return;
    if (isDuplicateMessage(message)) return;

    const from = message.from;
    const text = (message.body || '').trim();
    const cleanText = normalizeText(text);

    if (!from) return;
    if (isSystemOrGroupChatId(from)) return;
    if (!isPrivateClientChatId(from)) return;

    await discoverAliases(from, message);

    if (CEO_NUMBERS.includes(from) && cleanText.startsWith('/activar')) {
      const target = normalizeChatTarget(text);
      if (!target) {
        await sendDanielaMessage(from, 'Use: /activar 614806029 o /activar ID@lid');
        return;
      }
      await discoverAliases(target);
      activateChat(target);
      await sendDanielaMessage(from, `Daniela reactivada para ${target}.`);
      return;
    }

    if (CEO_NUMBERS.includes(from) && cleanText.startsWith('/pausar')) {
      const target = normalizeChatTarget(text);
      if (!target) {
        await sendDanielaMessage(from, 'Use: /pausar 614806029 o /pausar ID@lid');
        return;
      }
      await discoverAliases(target);
      pauseChat(target, 2);
      await sendDanielaMessage(from, `Daniela pausada durante 2 horas para ${target}.`);
      return;
    }

    if (CEO_NUMBERS.includes(from) && cleanText === '/recargar memoria') {
      memory = loadMemory();
      await sendDanielaMessage(from, 'Memoria de Daniela recargada.');
      return;
    }

    if (isPaused(from)) return;

    if (message.hasMedia || message.type === 'ptt' || message.type === 'audio') {
      const reply = 'Ahora mismo no puedo revisar audios o archivos desde aquí.\n\n¿Me lo puede escribir por texto?';

      await sleep(humanDelay(reply));
      await sendDanielaMessage(from, reply);

      await alertCEOs({
        from,
        userMessage: 'Audio o archivo recibido',
        reason: 'Contenido que requiere revisión humana',
        aiResponse: reply
      });

      pauseChat(from, 2);
      return;
    }

    if (!text) return;

    const direct = directReply(text, memory);

    if (direct) {
      await sleep(humanDelay(direct.reply));
      await sendDanielaMessage(from, direct.reply);

      if (direct.sendFlyer) {
        await sleep(700);
        await sendFlyer(from);
      }

      return;
    }

    const history = conversations.get(from) || [];

    let chat = null;
    try {
      chat = await message.getChat();
      await chat.sendStateTyping();
    } catch {}

    const { response, escalate } = await getAIResponse({
      from,
      text,
      history,
      memory,
      outOfHours: isOutOfHours(),
      shouldAlertCEO
    });

    await sleep(humanDelay(response));
    await sendDanielaMessage(from, response);

    conversations.set(from, [
      ...history,
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    ].slice(-16));

    if (chat) {
      try {
        await chat.clearState();
      } catch {}
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
    return res.send(`QR no disponible. Estado: ${whatsappStatus}`);
  }

  res.send(`
    <html>
      <body style="font-family:Arial;text-align:center;padding:40px;">
        <h1>QR WhatsApp Special One</h1>
        <img src="${qrImage}" width="360"/>
        <p>WhatsApp → Dispositivos vinculados</p>
      </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log('Servidor web activo en puerto', PORT);
});

client.initialize().catch(error => {
  whatsappStatus = 'initialize_error';
  console.error('Error inicializando WhatsApp:', error?.stack || error?.message || error);
});
