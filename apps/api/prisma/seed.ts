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
        id, "businessId", "userId", role, status, "invitedEmail", "invitedFirstName", "invitedLastName", "inviteTokenHash", "inviteExpiresAt", "inviteAcceptedAt", "inviteCancelledAt", "inviteEmailDeliveryStatus", "inviteEmailDeliveryError", "invitedBy", "invitedAt", "joinedAt", "lastLoginAt", "createdAt", "updatedAt"
       ) VALUES
       ('demo-member-owner', $1, $2, 'OWNER', 'ACTIVE', 'owner@demo-tradieos.com', 'Sam', 'Owner', NULL, NULL, NOW(), NULL, NULL, NULL, NULL, NULL, NOW(), NOW(), NOW(), NOW()),
       ('demo-member-office', $1, $3, 'OFFICE_MANAGER', 'ACTIVE', 'alex@demo-tradieos.com', 'Alex', 'Office', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-tech', $1, $4, 'TECHNICIAN', 'ACTIVE', 'mia@demo-tradieos.com', 'Mia', 'Technician', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-invited', $1, NULL, 'SCHEDULER', 'INVITED', 'scheduler@demo-tradieos.com', 'Sasha', 'Scheduler', $5, NOW() + INTERVAL '7 days', NULL, NULL, 'SENT', NULL, $2, NOW(), NULL, NULL, NOW(), NOW())`,
      [
        businessId,
        ownerId,
        staffIds[0],
        staffIds[1],
        'f1f1f64d0a7dfd8126660ce8d7d9cdc36e724162021d3e6506e3bea8bae1976c',
      ],
    );

    await query(
      `INSERT INTO "AuditLog" (id, "businessId", "actorUserId", action, "entityType", "entityId", metadata, "createdAt")
       VALUES
       ('demo-audit-member-invited', $1, $2, 'INVITE_CREATED', 'BusinessMember', 'demo-member-invited', '{"email":"scheduler@demo-tradieos.com","role":"SCHEDULER"}', NOW())`,
      [businessId, ownerId],
    );

    const customers = [
      [
        'demo-customer-1',
        'Priya',
        'Sharma',
        null,
        'Priya Sharma',
        'priya.sharma@example.test',
        'priya.sharma@example.test',
        '0400 111 222',
        '0400111222',
        null,
        '12 King Street',
        null,
        'Parramatta',
        'NSW',
        '2150',
        'SMS',
        'RESIDENTIAL',
        'Prefers SMS reminders.',
        ['residential', 'sms'],
        false,
        null,
      ],
      [
        'demo-customer-2',
        null,
        null,
        'Taylor Warehousing Pty Ltd',
        'Taylor Warehousing Pty Ltd',
        'ops@taylor-warehousing.example.test',
        'ops@taylor-warehousing.example.test',
        '03 9000 2222',
        '0390002222',
        null,
        '8 Industrial Drive',
        'Unit 4',
        'Dandenong South',
        'VIC',
        '3175',
        'EMAIL',
        'COMMERCIAL',
        'Commercial warehouse maintenance contact.',
        ['commercial', 'warehouse'],
        false,
        null,
      ],
      [
        'demo-customer-3',
        'Grace',
        'Wilson',
        'Harbour Property Management',
        'Grace Wilson',
        'grace.wilson@example.test',
        'grace.wilson@example.test',
        '0400 333 444',
        '0400333444',
        '02 8000 3333',
        '4 Hill Avenue',
        'Level 2',
        'Hornsby',
        'NSW',
        '2077',
        'PHONE',
        'REAL_ESTATE',
        'Manages several rental properties.',
        ['property-manager', 'rentals'],
        false,
        null,
      ],
      [
        'demo-customer-4',
        'Omar',
        'Haddad',
        null,
        'Omar Haddad',
        null,
        null,
        '0400 444 555',
        '0400444555',
        null,
        '22 Station Street',
        null,
        'Blacktown',
        'NSW',
        '2148',
        'ANY',
        'RESIDENTIAL',
        null,
        ['ceiling-fans'],
        false,
        null,
      ],
      [
        'demo-customer-5',
        'Lucy',
        'Nguyen',
        'Nguyen Cafe',
        'Lucy Nguyen',
        'lucy.nguyen@example.test',
        'lucy.nguyen@example.test',
        '0400 555 666',
        '0400555666',
        null,
        '55 Crown Street',
        null,
        'Surry Hills',
        'NSW',
        '2010',
        'EMAIL',
        'COMMERCIAL',
        'Archived demo customer with retained invoice history.',
        ['cafe', 'archived'],
        true,
        new Date(),
      ],
      [
        'demo-customer-6',
        null,
        null,
        'Northside Builders',
        'Northside Builders',
        'projects@northside-builders.example.test',
        'projects@northside-builders.example.test',
        '07 3000 1111',
        '0730001111',
        null,
        '18 Builder Way',
        null,
        'Fortitude Valley',
        'QLD',
        '4006',
        'EMAIL',
        'BUILDER',
        'Builder account with multiple active sites.',
        ['builder', 'multi-site'],
        false,
        null,
      ],
    ];

    for (const customer of customers) {
      await query(
        `INSERT INTO "Customer" (
          id, "businessId", "firstName", "lastName", "companyName", "displayName", email, "emailNormalised", phone, "phoneNormalised", "alternatePhone", "addressLine1", "addressLine2", suburb, state, postcode, "contactPreference", "customerType", notes, tags, "isArchived", "archivedAt", status, "createdAt", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, (CASE WHEN $21 THEN 'ARCHIVED' ELSE 'ACTIVE' END)::"CustomerStatus", NOW(), NOW())`,
        [customer[0], businessId, ...customer.slice(1)],
      );
    }

    const customerSites = [
      [
        'demo-site-1-home',
        'demo-customer-1',
        'Home',
        '12 King Street',
        null,
        'Parramatta',
        'NSW',
        '2150',
        'Side gate access after 8am.',
        'Priya Sharma',
        '0400 111 222',
        true,
      ],
      [
        'demo-site-3-rental-1',
        'demo-customer-3',
        'Rental property',
        '91 Station Road',
        null,
        'Epping',
        'NSW',
        '2121',
        'Collect keys from tenant.',
        'Grace Wilson',
        '0400 333 444',
        true,
      ],
      [
        'demo-site-3-rental-2',
        'demo-customer-3',
        'Rental property 2',
        '14 River Road',
        'Apartment 8',
        'Parramatta',
        'NSW',
        '2150',
        'Visitor parking behind building.',
        'Grace Wilson',
        '0400 333 444',
        false,
      ],
      [
        'demo-site-6-site-1',
        'demo-customer-6',
        'Site 1',
        '26 Creek Road',
        null,
        'Newstead',
        'QLD',
        '4006',
        'Report to site office.',
        'Northside Site Manager',
        '07 3000 1111',
        true,
      ],
    ];

    for (const site of customerSites) {
      await query(
        `INSERT INTO "CustomerSite" (
          id, "businessId", "customerId", label, "addressLine1", "addressLine2", suburb, state, postcode, "accessInstructions", "siteContactName", "siteContactPhone", "isPrimary", "isArchived", "createdAt", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, false, NOW(), NOW())`,
        [site[0], businessId, ...site.slice(1)],
      );
    }

    const jobs = [
      [
        'demo-job-1',
        'demo-customer-1',
        staffIds[1],
        'JOB-2026-000001',
        'Replace kitchen power points',
        'Install two double GPOs and test circuit.',
        'Electrical',
        'SCHEDULED',
        'HIGH',
        hoursFromStartOfToday(9),
        hoursFromStartOfToday(11),
        120,
        null,
        null,
        null,
        '12 King Street',
        null,
        'Parramatta',
        'NSW',
        '2150',
        'Side gate access after 8am.',
        'Prefers SMS reminders.',
        'Check switchboard capacity before installing.',
        true,
        false,
        false,
        false,
        ownerId,
      ],
      [
        'demo-job-2',
        'demo-customer-2',
        staffIds[1],
        'JOB-2026-000002',
        'Bathroom leak inspection',
        'Find source of leak near vanity.',
        'Plumbing',
        'IN_PROGRESS',
        'URGENT',
        hoursFromStartOfToday(13),
        hoursFromStartOfToday(15),
        120,
        hoursFromStartOfToday(13),
        null,
        null,
        '8 Industrial Drive',
        'Unit 4',
        'Dandenong South',
        'VIC',
        '3175',
        'Ask for site supervisor at reception.',
        null,
        'Take photos of leak source for future invoice.',
        false,
        true,
        false,
        false,
        ownerId,
      ],
      [
        'demo-job-3',
        'demo-customer-3',
        staffIds[0],
        'JOB-2026-000003',
        'Switchboard quote visit',
        null,
        'Electrical',
        'NEW',
        'NORMAL',
        hoursFromStartOfToday(16),
        hoursFromStartOfToday(17),
        60,
        null,
        null,
        null,
        '4 Hill Avenue',
        'Level 2',
        'Hornsby',
        'NSW',
        '2077',
        'Collect keys from property manager.',
        'Manages several rental properties.',
        null,
        true,
        false,
        false,
        true,
        ownerId,
      ],
      [
        'demo-job-4',
        'demo-customer-4',
        null,
        'JOB-2026-000004',
        'Install ceiling fan',
        null,
        'Electrical',
        'SCHEDULED',
        'NORMAL',
        hoursFromStartOfToday(34),
        hoursFromStartOfToday(36),
        120,
        null,
        null,
        null,
        '22 Station Street',
        null,
        'Blacktown',
        'NSW',
        '2148',
        null,
        null,
        'Confirm fan model before attending.',
        false,
        true,
        false,
        false,
        ownerId,
      ],
      [
        'demo-job-5',
        'demo-customer-5',
        staffIds[1],
        'JOB-2026-000005',
        'Cafe lighting maintenance',
        null,
        'Electrical',
        'COMPLETED',
        'LOW',
        hoursFromStartOfToday(-16),
        hoursFromStartOfToday(-14),
        120,
        hoursFromStartOfToday(-16),
        hoursFromStartOfToday(-14),
        hoursFromStartOfToday(-14),
        '55 Crown Street',
        null,
        'Surry Hills',
        'NSW',
        '2010',
        'Use rear entry before 10am.',
        'Morning job before cafe opens.',
        'Replaced two fittings.',
        false,
        true,
        true,
        false,
        ownerId,
      ],
    ];

    for (const job of jobs) {
      await query(
        `INSERT INTO "Job" (
          id, "businessId", "customerId", "assignedToUserId", "jobNumber", title, description, "tradeType", status, priority,
          "scheduledStart", "scheduledEnd", "estimatedDurationMinutes", "actualStart", "actualEnd", "completedAt",
          "addressLine1", "addressLine2", suburb, state, postcode, "accessInstructions", "customerNotes", "internalNotes",
          "requiresQuote", "requiresInvoice", "invoiceCreated", "quoteCreated", "createdBy", "createdAt", "updatedAt"
        )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"JobStatus", $10::"JobPriority", $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, NOW(), NOW())`,
        [job[0], businessId, ...job.slice(1)],
      );
    }

    await query(
      `INSERT INTO "JobSequence" ("businessId", "nextNumber", "updatedAt")
       VALUES ($1, 6, NOW())
       ON CONFLICT ("businessId") DO UPDATE SET "nextNumber" = EXCLUDED."nextNumber", "updatedAt" = NOW()`,
      [businessId],
    );

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
