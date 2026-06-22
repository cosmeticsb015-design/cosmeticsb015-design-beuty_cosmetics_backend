'use strict';

const net = require('node:net');
const tls = require('node:tls');

const trimSlash = (value) => String(value || '').replace(/\/$/, '');
const escapeHeader = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();

const buildFrom = (options, settings = {}) => {
  if (options.from) return options.from;
  const email = settings.defaultFrom;
  const name = settings.defaultFromName;
  return name ? `${name} <${email}>` : email;
};

const addressOnly = (value) => {
  const match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : String(value || '').split(',')[0]).trim();
};

const normalizeAddresses = (value) =>
  String(value || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

const readResponse = (socket) =>
  new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] || '';
      if (/^\d{3} /.test(last)) {
        socket.off('data', onData);
        resolve(buffer);
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });

const sendCommand = async (socket, command, expected) => {
  socket.write(`${command}\r\n`);
  const response = await readResponse(socket);
  if (expected && !expected.some((code) => response.startsWith(String(code)))) {
    throw new Error(`SMTP command failed (${command}): ${response.trim()}`);
  }
  return response;
};

const dotStuff = (value) => String(value || '').replace(/(^|\r?\n)\./g, '$1..');

const buildMimeMessage = (options, settings) => {
  const boundary = `bc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = [
    `From: ${escapeHeader(buildFrom(options, settings))}`,
    `To: ${escapeHeader(options.to)}`,
    options.replyTo || settings.defaultReplyTo ? `Reply-To: ${escapeHeader(options.replyTo || settings.defaultReplyTo)}` : '',
    `Subject: ${escapeHeader(options.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  return `${headers.join('\r\n')}\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${dotStuff(options.text || '')}\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${dotStuff(options.html || options.text || '')}\r\n--${boundary}--\r\n`;
};

const sendWithSmtp = async (options, settings, providerOptions = {}) => {
  const host = providerOptions.host || process.env.MAIL_HOST || '127.0.0.1';
  const port = Number(providerOptions.port || process.env.MAIL_PORT || 1025);
  const secure = providerOptions.secure === true || String(process.env.MAIL_ENCRYPTION || '').toLowerCase() === 'ssl';
  const from = addressOnly(buildFrom(options, settings));
  const recipients = [...normalizeAddresses(options.to), ...normalizeAddresses(options.cc), ...normalizeAddresses(options.bcc)];
  const socket = secure ? tls.connect(port, host) : net.connect(port, host);

  await readResponse(socket);
  await sendCommand(socket, `EHLO ${providerOptions.name || 'beautycosmetics.local'}`, [250]);

  if (providerOptions.auth?.user || process.env.MAIL_USERNAME) {
    const user = providerOptions.auth?.user || process.env.MAIL_USERNAME || '';
    const pass = providerOptions.auth?.pass || process.env.MAIL_PASSWORD || '';
    await sendCommand(socket, 'AUTH LOGIN', [334]);
    await sendCommand(socket, Buffer.from(user).toString('base64'), [334]);
    await sendCommand(socket, Buffer.from(pass).toString('base64'), [235]);
  }

  await sendCommand(socket, `MAIL FROM:<${from}>`, [250]);
  for (const recipient of recipients) await sendCommand(socket, `RCPT TO:<${addressOnly(recipient)}>`, [250, 251]);
  await sendCommand(socket, 'DATA', [354]);
  socket.write(`${buildMimeMessage(options, settings)}\r\n.\r\n`);
  const dataResponse = await readResponse(socket);
  if (!dataResponse.startsWith('250')) throw new Error(`SMTP DATA failed: ${dataResponse.trim()}`);
  await sendCommand(socket, 'QUIT', [221]);
  socket.end();
  return { accepted: recipients };
};

const sendWithMailjet = async (options, settings, providerOptions = {}) => {
  const apiKey = providerOptions.apiKey || process.env.MAILJET_API_KEY;
  const apiSecret = providerOptions.apiSecret || process.env.MAILJET_API_SECRET;
  if (!apiKey || !apiSecret) throw new Error('MAILJET_API_KEY and MAILJET_API_SECRET are required to send with Mailjet');

  const response = await fetch(`${trimSlash(providerOptions.apiUrl || 'https://api.mailjet.com')}/v3.1/send`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      Messages: [
        {
          From: { Email: settings.defaultFrom, Name: settings.defaultFromName },
          To: normalizeAddresses(options.to).map((Email) => ({ Email })),
          Subject: options.subject,
          TextPart: options.text,
          HTMLPart: options.html,
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Mailjet send failed with status ${response.status}: ${await response.text()}`);
  return response.json();
};

module.exports = {
  init(providerOptions = {}, settings = {}) {
    const providers = providerOptions.providers || {};
    const defaultProvider = providerOptions.defaultProvider || 'nodemailer';
    const smtpOptions = providers.nodemailer?.providerOptions || providerOptions.nodemailer || providerOptions;
    const mailjetOptions = providers.mailjet?.providerOptions || providerOptions.mailjet || {};

    return {
      async send(options) {
        if (defaultProvider === 'mailjet') return sendWithMailjet(options, settings, mailjetOptions);
        return sendWithSmtp(options, settings, smtpOptions);
      },
    };
  },
};
