import axios from 'axios';

process.loadEnvFile('.env');

const TICKET_ID = 40882;
const ODOO_BASE_URL = process.env.ODOO_BASE_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_UID = process.env.ODOO_UID;
const ODOO_API_KEY = process.env.ODOO_API_KEY;

if (!ODOO_BASE_URL || !ODOO_DB || !ODOO_UID || !ODOO_API_KEY) {
  console.error('Variables Odoo manquantes. Copiez .env.example vers .env puis remplissez les valeurs.');
  process.exit(1);
}

async function odooSearchRead(model: string, fields: string[], domain: unknown[], limit = 50, offset = 0) {
  const body = {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: [
        ODOO_DB,
        Number(ODOO_UID),
        ODOO_API_KEY,
        model,
        'search_read',
        [domain],
        { fields, limit, offset, order: 'id asc' },
      ],
    },
    id: Date.now(),
  };

  const response = await axios.post(`${ODOO_BASE_URL}/jsonrpc`, body, {
    timeout: 20000,
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.data?.error) {
    const details = response.data.error?.data ?? response.data.error;
    throw new Error(`Odoo error: ${details?.message ?? response.data.error.message}`);
  }

  return response.data?.result ?? [];
}

function normalizeText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

async function listTicketMessages() {
  const ticket = await odooSearchRead(
    'helpdesk.ticket',
    ['id', 'name', 'partner_id', 'stage_id', 'user_id', 'team_id', 'priority', 'kanban_state'],
    [['id', '=', TICKET_ID]],
    1,
  );

  console.log('Ticket :');
  console.dir(ticket, { depth: 5 });

  const messages = await odooSearchRead(
    'mail.message',
    [
      'id',
      'date',
      'author_id',
      'body',
      'subject',
      'message_type',
      'model',
      'res_id',
      'record_name',
      'attachment_ids',
      'subtype_id',
      'is_internal',
    ],
    [
      ['model', '=', 'helpdesk.ticket'],
      ['res_id', '=', TICKET_ID],
    ],
    50,
  );

  console.log(`\nHistorique (${messages.length} message(s)) :`);
  for (const msg of messages) {
    const author = Array.isArray(msg.author_id) ? msg.author_id[1] : msg.author_id;
    const attachments = Array.isArray(msg.attachment_ids) ? msg.attachment_ids.length : 0;
    const bodyText = normalizeText(msg.body);

    console.log(`\n--- message #${msg.id} ---`);
    console.log(`date: ${msg.date}`);
    console.log(`auteur: ${author ?? 'inconnu'}`);
    console.log(`type: ${msg.message_type ?? 'n/a'}`);
    console.log(`sujet: ${msg.subject ?? 'n/a'}`);
    console.log(`interne: ${msg.is_internal === true ? 'oui' : 'non'}`);
    console.log(`pièces jointes: ${attachments}`);
    console.log(`corps: ${bodyText.slice(0, 500) || '(vide)'}`);
  }
}

async function listOnlyMessagePayloads() {
  const messages = await odooSearchRead(
    'mail.message',
    ['id', 'date', 'author_id', 'body', 'message_type', 'is_internal', 'attachment_ids'],
    [
      ['model', '=', 'helpdesk.ticket'],
      ['res_id', '=', TICKET_ID],
    ],
    50,
  );

  const payloads = messages.map((msg) => {
    const author = Array.isArray(msg.author_id) ? msg.author_id[1] : msg.author_id;
    return {
      id: msg.id,
      date: msg.date,
      author: author ?? null,
      type: msg.message_type ?? null,
      isInternal: msg.is_internal === true,
      attachments: Array.isArray(msg.attachment_ids) ? msg.attachment_ids.length : 0,
      body: normalizeText(msg.body),
    };
  });

  console.log('\n--- Messages payloads uniquement ---');
  console.dir(payloads, { depth: 10 });
}

async function exportRawJsonEnvelope() {
  const [ticket, messages] = await Promise.all([
    odooSearchRead(
      'helpdesk.ticket',
      ['id', 'name', 'partner_id', 'stage_id', 'user_id', 'team_id', 'priority', 'kanban_state'],
      [['id', '=', TICKET_ID]],
      1,
    ),
    odooSearchRead(
      'mail.message',
      [
        'id',
        'date',
        'author_id',
        'body',
        'subject',
        'message_type',
        'model',
        'res_id',
        'record_name',
        'attachment_ids',
        'subtype_id',
        'is_internal',
      ],
      [
        ['model', '=', 'helpdesk.ticket'],
        ['res_id', '=', TICKET_ID],
      ],
      50,
    ),
  ]);

  const envelope = {
    source: 'helpdesk.ticket',
    ticketId: TICKET_ID,
    ticket: ticket[0] ?? null,
    count: messages.length,
    messages,
  };

  console.log(JSON.stringify(envelope, null, 2));
}

async function main() {
  console.log(`Lecture en lecture seule du ticket ${TICKET_ID}...`);
  await listTicketMessages();
  await listOnlyMessagePayloads();
  console.log('\n--- JSON brut MCP-ready ---');
  await exportRawJsonEnvelope();
}

main().catch((error: unknown) => {
  console.error('Échec de la lecture du ticket / historique :');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
