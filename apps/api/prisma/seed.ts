import 'dotenv/config';
import { randomBytes, scrypt as scryptCallback } from 'crypto';
import { Client } from 'pg';
import { promisify } from 'util';

const businessId = 'demo-business-tradieos';
const ownerId = 'demo-owner-user';
const staffIds = ['demo-staff-user-1', 'demo-staff-user-2'];
const databaseUrl = process.env.DATABASE_URL;
const scrypt = promisify(scryptCallback);

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed TradieOS demo data');
}

const client = new Client({ connectionString: databaseUrl });

function hoursFromStartOfToday(hours: number) {
  const date = new Date();
  date.setHours(hours, 0, 0, 0);
  return date;
}

async function query(sql: string, values: unknown[] = []) {
  await client.query(sql, values);
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

async function main() {
  await client.connect();
  await query('BEGIN');

  try {
    const demoPasswordHash = await hashPassword('password123');

    await query('DELETE FROM "Business" WHERE id = $1', [businessId]);

    await query(
      `INSERT INTO "Business" (
        id, name, abn, "tradeType", "gstRegistered", phone, email, address, suburb, state, postcode, timezone, "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
      [
        businessId,
        'Demo Tradie Co',
        '12 345 678 901',
        'Electrical',
        true,
        '02 8000 1234',
        'office@demo-tradieos.com',
        '10 George Street',
        'Parramatta',
        'NSW',
        '2150',
        'Australia/Sydney',
      ],
    );

    await query(
      `INSERT INTO "User" (id, "businessId", email, "passwordHash", "firstName", "lastName", role, "isActive", "createdAt", "updatedAt")
       VALUES
       ($1, $5, 'owner@demo-tradieos.com', $4, 'Sam', 'Owner', 'OWNER', true, NOW(), NOW()),
       ($2, $5, 'alex@demo-tradieos.com', $4, 'Alex', 'Office', 'OFFICE_MANAGER', true, NOW(), NOW()),
       ($3, $5, 'mia@demo-tradieos.com', $4, 'Mia', 'Technician', 'TECHNICIAN', true, NOW(), NOW())`,
      [ownerId, staffIds[0], staffIds[1], demoPasswordHash, businessId],
    );

    await query(
      `INSERT INTO "BusinessMember" (
        id, "businessId", "userId", role, status, "invitedEmail", "inviteToken", "invitedBy", "invitedAt", "joinedAt", "lastLoginAt", "createdAt", "updatedAt"
       ) VALUES
       ('demo-member-owner', $1, $2, 'OWNER', 'ACTIVE', 'owner@demo-tradieos.com', NULL, NULL, NOW(), NOW(), NOW(), NOW(), NOW()),
       ('demo-member-office', $1, $3, 'OFFICE_MANAGER', 'ACTIVE', 'alex@demo-tradieos.com', NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-tech', $1, $4, 'TECHNICIAN', 'ACTIVE', 'mia@demo-tradieos.com', NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-invited', $1, NULL, 'SCHEDULER', 'INVITED', 'scheduler@demo-tradieos.com', 'demo-invite-token-scheduler', $2, NOW(), NULL, NULL, NOW(), NOW())`,
      [businessId, ownerId, staffIds[0], staffIds[1]],
    );

    await query(
      `INSERT INTO "AuditLog" (id, "businessId", "actorUserId", action, "entityType", "entityId", metadata, "createdAt")
       VALUES
       ('demo-audit-member-invited', $1, $2, 'MEMBER_INVITED', 'BusinessMember', 'demo-member-invited', '{"email":"scheduler@demo-tradieos.com","role":"SCHEDULER"}', NOW())`,
      [businessId, ownerId],
    );

    const customers = [
      [
        'demo-customer-1',
        'Priya',
        'Sharma',
        null,
        'priya@example.com',
        '0400 111 222',
        '12 King St, Parramatta NSW',
        'Prefers SMS reminders.',
      ],
      [
        'demo-customer-2',
        'Ben',
        'Taylor',
        null,
        'ben@example.com',
        '0400 222 333',
        '8 Beach Rd, Manly NSW',
        null,
      ],
      [
        'demo-customer-3',
        'Grace',
        'Wilson',
        'Wilson Family Trust',
        'grace@example.com',
        '0400 333 444',
        '4 Hill Ave, Hornsby NSW',
        null,
      ],
      [
        'demo-customer-4',
        'Omar',
        'Haddad',
        null,
        'omar@example.com',
        '0400 444 555',
        '22 Station St, Blacktown NSW',
        null,
      ],
      [
        'demo-customer-5',
        'Lucy',
        'Nguyen',
        'Nguyen Cafe',
        'lucy@example.com',
        '0400 555 666',
        '55 Crown St, Surry Hills NSW',
        null,
      ],
    ];

    for (const customer of customers) {
      await query(
        `INSERT INTO "Customer" (id, "businessId", "firstName", "lastName", company, email, phone, address, notes, status, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE', NOW(), NOW())`,
        [customer[0], businessId, ...customer.slice(1)],
      );
    }

    const jobs = [
      [
        'demo-job-1',
        'demo-customer-1',
        'Replace kitchen power points',
        'Install two double GPOs and test circuit.',
        'SCHEDULED',
        hoursFromStartOfToday(9),
        hoursFromStartOfToday(11),
        '12 King St, Parramatta NSW',
      ],
      [
        'demo-job-2',
        'demo-customer-2',
        'Bathroom leak inspection',
        'Find source of leak near vanity.',
        'IN_PROGRESS',
        hoursFromStartOfToday(13),
        hoursFromStartOfToday(15),
        '8 Beach Rd, Manly NSW',
      ],
      [
        'demo-job-3',
        'demo-customer-3',
        'Switchboard quote visit',
        null,
        'QUOTED',
        hoursFromStartOfToday(16),
        hoursFromStartOfToday(17),
        '4 Hill Ave, Hornsby NSW',
      ],
      [
        'demo-job-4',
        'demo-customer-4',
        'Install ceiling fan',
        null,
        'LEAD',
        hoursFromStartOfToday(34),
        hoursFromStartOfToday(36),
        '22 Station St, Blacktown NSW',
      ],
      [
        'demo-job-5',
        'demo-customer-5',
        'Cafe lighting maintenance',
        null,
        'COMPLETED',
        hoursFromStartOfToday(-16),
        hoursFromStartOfToday(-14),
        '55 Crown St, Surry Hills NSW',
      ],
    ];

    for (const job of jobs) {
      await query(
        `INSERT INTO "Job" (id, "businessId", "customerId", title, description, status, "startsAt", "endsAt", address, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
        [job[0], businessId, ...job.slice(1)],
      );
    }

    const quotes = [
      [
        'demo-quote-1',
        'demo-customer-3',
        'demo-job-3',
        'Q-1001',
        'SENT',
        '1200.00',
        '120.00',
        '1320.00',
        'Switchboard inspection and quote preparation',
      ],
      [
        'demo-quote-2',
        'demo-customer-4',
        'demo-job-4',
        'Q-1002',
        'DRAFT',
        '450.00',
        '45.00',
        '495.00',
        'Ceiling fan installation labour',
      ],
      [
        'demo-quote-3',
        'demo-customer-5',
        'demo-job-5',
        'Q-1003',
        'ACCEPTED',
        '800.00',
        '80.00',
        '880.00',
        'Cafe lighting service package',
      ],
    ];

    for (const quote of quotes) {
      await query(
        `INSERT INTO "Quote" (id, "businessId", "customerId", "jobId", number, status, "issueDate", subtotal, gst, total, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, NOW(), NOW())`,
        [quote[0], businessId, ...quote.slice(1, 8)],
      );
      await query(
        `INSERT INTO "QuoteLineItem" (id, "businessId", "quoteId", description, quantity, "unitPrice", total, "sortOrder")
         VALUES ($1, $2, $3, $4, 1, $5, $5, 0)`,
        [`${quote[0]}-line-1`, businessId, quote[0], quote[8], quote[5]],
      );
    }

    const invoices = [
      [
        'demo-invoice-1',
        'demo-customer-5',
        'demo-job-5',
        'INV-2001',
        'SENT',
        hoursFromStartOfToday(168),
        '800.00',
        '80.00',
        '880.00',
        '0.00',
        'Cafe lighting maintenance',
      ],
      [
        'demo-invoice-2',
        'demo-customer-1',
        'demo-job-1',
        'INV-2002',
        'PARTIALLY_PAID',
        hoursFromStartOfToday(72),
        '650.00',
        '65.00',
        '715.00',
        '200.00',
        'Power point replacement deposit invoice',
      ],
    ];

    for (const invoice of invoices) {
      await query(
        `INSERT INTO "Invoice" (id, "businessId", "customerId", "jobId", number, status, "issueDate", "dueDate", subtotal, gst, total, "amountPaid", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, NOW(), NOW())`,
        [invoice[0], businessId, ...invoice.slice(1, 10)],
      );
      await query(
        `INSERT INTO "InvoiceLineItem" (id, "businessId", "invoiceId", description, quantity, "unitPrice", total, "sortOrder")
         VALUES ($1, $2, $3, $4, 1, $5, $5, 0)`,
        [
          `${invoice[0]}-line-1`,
          businessId,
          invoice[0],
          invoice[10],
          invoice[6],
        ],
      );
    }

    const notifications = [
      [
        'demo-notification-1',
        'Invoice follow-up due',
        'INV-2001 is ready for a polite payment reminder draft.',
        'UNREAD',
        null,
      ],
      [
        'demo-notification-2',
        'Jobs scheduled today',
        'Review today’s route before leaving.',
        'UNREAD',
        null,
      ],
      [
        'demo-notification-3',
        'Quote waiting',
        'Q-1002 is still a draft.',
        'UNREAD',
        null,
      ],
      [
        'demo-notification-4',
        'Customer note added',
        'Priya prefers SMS reminders.',
        'READ',
        new Date(),
      ],
      [
        'demo-notification-5',
        'Tori draft available',
        'A reminder draft can be prepared for unpaid invoices.',
        'UNREAD',
        null,
      ],
    ];

    for (const notification of notifications) {
      await query(
        `INSERT INTO "Notification" (id, "businessId", "userId", title, body, status, "readAt", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [notification[0], businessId, ownerId, ...notification.slice(1)],
      );
    }

    await query(
      `INSERT INTO "AiConversation" (id, "businessId", "userId", title, "createdAt", "updatedAt")
       VALUES ('demo-ai-conversation-1', $1, $2, 'Today’s priorities', NOW(), NOW())`,
      [businessId, ownerId],
    );

    const aiMessages = [
      ['demo-ai-message-1', 'USER', 'Tori, what should I focus on today?'],
      [
        'demo-ai-message-2',
        'ASSISTANT',
        'You have jobs today, two unpaid invoices, and one draft quote to review.',
      ],
      [
        'demo-ai-message-3',
        'ASSISTANT',
        'I can draft customer messages and payment reminders, but I will wait for confirmation before anything is sent.',
      ],
    ];

    for (const message of aiMessages) {
      await query(
        `INSERT INTO "AiMessage" (id, "businessId", "conversationId", role, content, "createdAt")
         VALUES ($1, $2, 'demo-ai-conversation-1', $3, $4, NOW())`,
        [message[0], businessId, message[1], message[2]],
      );
    }

    await query('COMMIT');
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }

  console.log('Seeded TradieOS demo data');
  console.log(`Business: ${businessId}`);
  console.log('Demo login: owner@demo-tradieos.com / password123');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await client.end();
  });
