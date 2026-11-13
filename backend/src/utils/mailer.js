// mailer.js — Nodemailer wrapper with group-aware SMTP selection.
//
// VB6 origin: gv.sDbGroup-based CDO config (MUM=Gmail, BHW=Office365, default=fallback).
//
// SMTP credentials are read exclusively from process.env — never hardcoded:
//   Default: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM_NAME, SMTP_FROM_ADDR
//   Per-group: SMTP_{GROUP}_HOST, SMTP_{GROUP}_PORT, SMTP_{GROUP}_SECURE,
//              SMTP_{GROUP}_USER, SMTP_{GROUP}_PASS, SMTP_{GROUP}_FROM_NAME, SMTP_{GROUP}_FROM_ADDR
//
// Example (.env):
//   SMTP_MUM_HOST=smtp.gmail.com   SMTP_MUM_PORT=465   SMTP_MUM_SECURE=true ...
//   SMTP_BHW_HOST=smtp.office365.com  SMTP_BHW_PORT=587  SMTP_BHW_SECURE=false ...
const nodemailer = require('nodemailer');

// Cache one transporter per group (plus '__default__') so we don't create new
// TCP connections on every call.
const transporterCache = new Map();

function buildCfg(prefix) {
  const host = process.env[`${prefix}HOST`];
  if (!host) return null;
  return {
    host,
    port:   Number(process.env[`${prefix}PORT`]) || 587,
    secure: process.env[`${prefix}SECURE`] === 'true',
    auth: {
      user: process.env[`${prefix}USER`],
      pass: process.env[`${prefix}PASS`],
    },
    tls: { rejectUnauthorized: false },
  };
}

function getTransporter(group) {
  const g = (group || '').toUpperCase();
  const groupCfg = g ? buildCfg(`SMTP_${g}_`) : null;
  const cacheKey  = groupCfg ? g : '__default__';

  if (!transporterCache.has(cacheKey)) {
    const cfg = groupCfg || buildCfg('SMTP_') || {
      host:   'smtp.office365.com',
      port:   587,
      secure: false,
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      tls:    { rejectUnauthorized: false },
    };
    transporterCache.set(cacheKey, nodemailer.createTransport(cfg));
  }

  return transporterCache.get(cacheKey);
}

function getFromAddress(group) {
  const g = (group || '').toUpperCase();
  const prefix = g ? `SMTP_${g}_` : null;
  const hasGroup = prefix && process.env[`${prefix}HOST`];

  const name = hasGroup
    ? (process.env[`${prefix}FROM_NAME`] || process.env.SMTP_FROM_NAME || '')
    : (process.env.SMTP_FROM_NAME || '');
  const addr = hasGroup
    ? (process.env[`${prefix}FROM_ADDR`] || process.env[`${prefix}USER`] || process.env.SMTP_USER)
    : (process.env.SMTP_FROM_ADDR || process.env.SMTP_FROM || process.env.SMTP_USER);

  return name ? `"${name}" <${addr}>` : (addr || '');
}

/**
 * Send an email via the SMTP config for the given group (falls back to default).
 *
 * @param {object} opts
 * @param {string}   opts.to           - Recipient address(es)
 * @param {string}   opts.subject
 * @param {string}   opts.html         - HTML body
 * @param {Array}    [opts.attachments] - Nodemailer attachment objects
 * @param {string}   [opts.group]      - DB group key, e.g. "MUM" or "BHW" (from req.user.groupID)
 */
async function sendMail({ to, subject, html, attachments = [], group }) {
  const transporter = getTransporter(group);
  const from        = getFromAddress(group);
  return transporter.sendMail({ from, to, subject, html, attachments });
}

module.exports = { sendMail };
