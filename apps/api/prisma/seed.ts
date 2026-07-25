import 'dotenv/config';
import { randomBytes, scrypt as scryptCallback } from 'crypto';
import { Client } from 'pg';
import { promisify } from 'util';

const businessId = 'demo-business-tradieos';
const ownerId = 'demo-owner-user';
const adminId = 'demo-admin-user';
const staffIds = ['demo-staff-user-1', 'demo-staff-user-2'];
const schedulerId = 'demo-scheduler-user';
const accountantId = 'demo-accountant-user';
const salesId = 'demo-sales-user';
const readOnlyId = 'demo-readonly-user';
const databaseUrl = process.env.DATABASE_URL;
const scrypt = promisify(scryptCallback);
const demoBusinessTimezone = 'Australia/Sydney';

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to seed TradieOS demo data');
}

const client = new Client({ connectionString: databaseUrl });

function zonedDateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    month: Number(map.month),
    second: Number(map.second),
    year: Number(map.year),
  };
}

function timezoneOffsetMilliseconds(value: Date, timezone: string) {
  const parts = zonedDateParts(value, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - value.getTime();
}

function zonedTimeToUtc(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute?: number;
  second?: number;
}) {
  const utcGuess = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute ?? 0,
      parts.second ?? 0,
    ),
  );
  const firstPass = new Date(
    utcGuess.getTime() -
      timezoneOffsetMilliseconds(utcGuess, demoBusinessTimezone),
  );
  return new Date(
    utcGuess.getTime() -
      timezoneOffsetMilliseconds(firstPass, demoBusinessTimezone),
  );
}

function businessTimeToday(hour: number, minute = 0, dayOffset = 0) {
  const today = zonedDateParts(new Date(), demoBusinessTimezone);
  return zonedTimeToUtc({
    day: today.day + dayOffset,
    hour,
    minute,
    month: today.month,
    year: today.year,
  });
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
       ($6, $5, 'admin@demo-tradieos.com', $4, 'Ava', 'Admin', 'ADMIN', true, NOW(), NOW()),
       ($2, $5, 'alex@demo-tradieos.com', $4, 'Alex', 'Office', 'OFFICE_MANAGER', true, NOW(), NOW()),
       ($3, $5, 'mia@demo-tradieos.com', $4, 'Mia', 'Technician', 'TECHNICIAN', true, NOW(), NOW()),
       ($7, $5, 'scheduler@demo-tradieos.com', $4, 'Sasha', 'Scheduler', 'SCHEDULER', true, NOW(), NOW()),
       ($8, $5, 'accountant@demo-tradieos.com', $4, 'Noah', 'Accounts', 'ACCOUNTANT', true, NOW(), NOW()),
       ($9, $5, 'sales@demo-tradieos.com', $4, 'Sienna', 'Sales', 'SALES', true, NOW(), NOW()),
       ($10, $5, 'readonly@demo-tradieos.com', $4, 'Riley', 'Read Only', 'READ_ONLY', true, NOW(), NOW())`,
      [
        ownerId,
        staffIds[0],
        staffIds[1],
        demoPasswordHash,
        businessId,
        adminId,
        schedulerId,
        accountantId,
        salesId,
        readOnlyId,
      ],
    );

    await query(
      `INSERT INTO "BusinessMember" (
        id, "businessId", "userId", role, status, "invitedEmail", "invitedFirstName", "invitedLastName", "inviteTokenHash", "inviteExpiresAt", "inviteAcceptedAt", "inviteCancelledAt", "inviteEmailDeliveryStatus", "inviteEmailDeliveryError", "invitedBy", "invitedAt", "joinedAt", "lastLoginAt", "createdAt", "updatedAt"
       ) VALUES
       ('demo-member-owner', $1, $2, 'OWNER', 'ACTIVE', 'owner@demo-tradieos.com', 'Sam', 'Owner', NULL, NULL, NOW(), NULL, NULL, NULL, NULL, NULL, NOW(), NOW(), NOW(), NOW()),
       ('demo-member-admin', $1, $5, 'ADMIN', 'ACTIVE', 'admin@demo-tradieos.com', 'Ava', 'Admin', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-office', $1, $3, 'OFFICE_MANAGER', 'ACTIVE', 'alex@demo-tradieos.com', 'Alex', 'Office', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-tech', $1, $4, 'TECHNICIAN', 'ACTIVE', 'mia@demo-tradieos.com', 'Mia', 'Technician', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-scheduler', $1, $6, 'SCHEDULER', 'ACTIVE', 'scheduler@demo-tradieos.com', 'Sasha', 'Scheduler', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-accountant', $1, $7, 'ACCOUNTANT', 'ACTIVE', 'accountant@demo-tradieos.com', 'Noah', 'Accounts', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-sales', $1, $8, 'SALES', 'ACTIVE', 'sales@demo-tradieos.com', 'Sienna', 'Sales', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW()),
       ('demo-member-readonly', $1, $9, 'READ_ONLY', 'ACTIVE', 'readonly@demo-tradieos.com', 'Riley', 'Read Only', NULL, NULL, NOW(), NULL, NULL, NULL, $2, NOW(), NOW(), NULL, NOW(), NOW())`,
      [
        businessId,
        ownerId,
        staffIds[0],
        staffIds[1],
        adminId,
        schedulerId,
        accountantId,
        salesId,
        readOnlyId,
      ],
    );

    await query(
      `INSERT INTO "AuditLog" (id, "businessId", "actorUserId", action, "entityType", "entityId", metadata, "createdAt")
       VALUES
       ('demo-audit-member-scheduler-active', $1, $2, 'MEMBER_ACTIVATED', 'BusinessMember', 'demo-member-scheduler', '{"email":"scheduler@demo-tradieos.com","role":"SCHEDULER","source":"demo_seed"}', NOW())`,
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
        businessTimeToday(9),
        businessTimeToday(11),
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
        businessTimeToday(11, 30),
        businessTimeToday(12, 30),
        120,
        businessTimeToday(11, 30),
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
        businessTimeToday(13),
        businessTimeToday(15),
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
        businessTimeToday(7, 30, 1),
        businessTimeToday(8, 30, 1),
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
        businessTimeToday(15, 30, -1),
        businessTimeToday(17, 0, -1),
        120,
        businessTimeToday(15, 30, -1),
        businessTimeToday(17, 0, -1),
        businessTimeToday(17, 0, -1),
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
      [
        'demo-job-6',
        'demo-customer-1',
        ownerId,
        'JOB-2026-000006',
        'Owner field workflow test visit',
        'Demo appointment for testing owner My Day field workflow.',
        'Electrical',
        'SCHEDULED',
        'NORMAL',
        businessTimeToday(7, 30),
        businessTimeToday(8, 30),
        60,
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
        'Use this appointment to test CONFIRMED → ON_THE_WAY → ARRIVED → IN_PROGRESS → COMPLETED.',
        false,
        false,
        false,
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
       VALUES ($1, 7, NOW())
       ON CONFLICT ("businessId") DO UPDATE SET "nextNumber" = EXCLUDED."nextNumber", "updatedAt" = NOW()`,
      [businessId],
    );

    const appointments = [
      [
        'demo-appointment-1',
        'demo-job-1',
        staffIds[1],
        'APT-2026-000001',
        'INSTALLATION',
        'CONFIRMED',
        businessTimeToday(9),
        businessTimeToday(11),
        null,
        null,
        120,
        18,
        '12.4',
        'Install two double GPOs and confirm circuit load.',
        ownerId,
      ],
      [
        'demo-appointment-2',
        'demo-job-2',
        staffIds[1],
        'APT-2026-000002',
        'INSPECTION',
        'IN_PROGRESS',
        businessTimeToday(11, 30),
        businessTimeToday(12, 30),
        businessTimeToday(11, 30),
        null,
        120,
        25,
        '18.8',
        'Urgent leak inspection near vanity.',
        ownerId,
      ],
      [
        'demo-appointment-3',
        'demo-job-3',
        staffIds[0],
        'APT-2026-000003',
        'INSPECTION',
        'SCHEDULED',
        businessTimeToday(13),
        businessTimeToday(15),
        null,
        null,
        60,
        15,
        '8.2',
        'Quote visit for switchboard upgrade.',
        ownerId,
      ],
      [
        'demo-appointment-4',
        'demo-job-4',
        null,
        'APT-2026-000004',
        'INSTALLATION',
        'SCHEDULED',
        businessTimeToday(7, 30, 1),
        businessTimeToday(8, 30, 1),
        null,
        null,
        120,
        null,
        null,
        'Assign technician after fan model is confirmed.',
        ownerId,
      ],
      [
        'demo-appointment-5',
        'demo-job-5',
        staffIds[1],
        'APT-2026-000005',
        'MAINTENANCE',
        'COMPLETED',
        businessTimeToday(15, 30, -1),
        businessTimeToday(17, 0, -1),
        businessTimeToday(15, 30, -1),
        businessTimeToday(17, 0, -1),
        120,
        20,
        '11.1',
        'Completed lighting maintenance before cafe opened.',
        ownerId,
      ],
      [
        'demo-appointment-6',
        'demo-job-1',
        staffIds[1],
        'APT-2026-000006',
        'RETURN_VISIT',
        'SCHEDULED',
        businessTimeToday(15, 30, 2),
        businessTimeToday(17, 0, 2),
        null,
        null,
        60,
        null,
        null,
        'Optional return visit if extra switchboard work is approved.',
        ownerId,
      ],
      [
        'demo-appointment-7',
        'demo-job-6',
        ownerId,
        'APT-2026-000007',
        'MAINTENANCE',
        'CONFIRMED',
        businessTimeToday(7, 30),
        businessTimeToday(8, 30),
        null,
        null,
        60,
        12,
        '7.4',
        'Owner demo field workflow: confirm arrival, start work, complete and capture work notes.',
        ownerId,
      ],
    ];

    for (const appointment of appointments) {
      await query(
        `INSERT INTO "Appointment" (
          id, "businessId", "jobId", "assignedUserId", "appointmentNumber", "appointmentType", status,
          "scheduledStart", "scheduledEnd", "actualStart", "actualEnd", "estimatedDurationMinutes",
          "travelDurationMinutes", "travelDistanceKm", "locationSource", "addressLine1", "addressLine2",
          suburb, state, postcode, "accessInstructions", notes, "createdBy", "createdAt", "updatedAt"
         )
         SELECT $1, $2, $3, $4, $5, $6::"AppointmentType", $7::"AppointmentStatus", $8, $9, $10, $11,
           $12, $13, $14, 'CUSTOMER_DEFAULT'::"AppointmentLocationSource", job."addressLine1",
           job."addressLine2", job.suburb, job.state, job.postcode, job."accessInstructions", $15, $16, NOW(), NOW()
         FROM "Job" job
         WHERE job.id = $3 AND job."businessId" = $2`,
        [appointment[0], businessId, ...appointment.slice(1)],
      );
    }

    await query(
      `INSERT INTO "AppointmentSequence" ("businessId", "nextNumber", "updatedAt")
       VALUES ($1, 8, NOW())
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
        businessTimeToday(17, 0, 7),
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
        businessTimeToday(17, 0, 3),
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
