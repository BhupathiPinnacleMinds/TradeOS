import type { BusinessRole } from '@tradieos/shared';

export type TeamInvitationEmailInput = {
  to: string;
  inviterName: string;
  businessName: string;
  role: BusinessRole;
  inviteUrl: string;
  expiresAt: Date;
};

export type PasswordResetEmailInput = {
  to: string;
  firstName: string;
  resetUrl: string;
  expiresAt: Date;
};

export type EmailDeliveryResult = {
  provider: 'console' | 'resend';
  status: 'SENT' | 'FAILED';
  messageId?: string;
  error?: string;
};

export interface EmailProvider {
  sendTeamInvitation(
    input: TeamInvitationEmailInput,
  ): Promise<EmailDeliveryResult>;
  resendTeamInvitation(
    input: TeamInvitationEmailInput,
  ): Promise<EmailDeliveryResult>;
  sendPasswordReset(
    input: PasswordResetEmailInput,
  ): Promise<EmailDeliveryResult>;
  sendWelcomeEmail(input: {
    to: string;
    firstName: string;
    businessName: string;
  }): Promise<EmailDeliveryResult>;
}

export class ConsoleEmailProvider implements EmailProvider {
  constructor(private readonly exposeInviteUrlInLogs = true) {}

  sendTeamInvitation(input: TeamInvitationEmailInput) {
    return this.logInvitation('INVITE', input);
  }

  resendTeamInvitation(input: TeamInvitationEmailInput) {
    return this.logInvitation('RESEND_INVITE', input);
  }

  sendPasswordReset(input: PasswordResetEmailInput) {
    console.info('[TradieOS email:PASSWORD_RESET]', {
      expiresAt: input.expiresAt.toISOString(),
      firstName: input.firstName,
      resetUrl: this.exposeInviteUrlInLogs
        ? redactResetToken(input.resetUrl)
        : '[hidden outside development]',
      to: input.to,
    });
    return Promise.resolve({
      provider: 'console' as const,
      status: 'SENT' as const,
    });
  }

  sendWelcomeEmail(input: {
    to: string;
    firstName: string;
    businessName: string;
  }): Promise<EmailDeliveryResult> {
    console.info('[TradieOS email:WELCOME]', {
      businessName: input.businessName,
      firstName: input.firstName,
      to: input.to,
    });
    return Promise.resolve({ provider: 'console', status: 'SENT' });
  }

  private logInvitation(kind: string, input: TeamInvitationEmailInput) {
    console.info(`[TradieOS email:${kind}]`, {
      businessName: input.businessName,
      expiresAt: input.expiresAt.toISOString(),
      inviteUrl: this.exposeInviteUrlInLogs
        ? input.inviteUrl
        : '[hidden outside development]',
      inviterName: input.inviterName,
      role: input.role,
      to: input.to,
    });
    return Promise.resolve({
      provider: 'console' as const,
      status: 'SENT' as const,
    });
  }
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fromName: string,
    private readonly fromAddress: string,
  ) {}

  sendTeamInvitation(input: TeamInvitationEmailInput) {
    return this.sendInvitation(input);
  }

  resendTeamInvitation(input: TeamInvitationEmailInput) {
    return this.sendInvitation(input);
  }

  sendPasswordReset(input: PasswordResetEmailInput) {
    return this.send({
      html: `
        <p>Hi ${escapeHtml(input.firstName)},</p>
        <p>We received a request to reset your TradieOS password.</p>
        <p><a href="${escapeHtml(input.resetUrl)}">Reset your password</a></p>
        <p>This link expires on ${escapeHtml(
          input.expiresAt.toLocaleString('en-AU'),
        )}.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
      subject: 'Reset your TradieOS password',
      to: input.to,
    });
  }

  sendWelcomeEmail(input: {
    to: string;
    firstName: string;
    businessName: string;
  }) {
    return this.send({
      html: `<p>Hi ${escapeHtml(input.firstName)}, welcome to ${escapeHtml(
        input.businessName,
      )} on TradieOS.</p>`,
      subject: `Welcome to ${input.businessName} on TradieOS`,
      to: input.to,
    });
  }

  private sendInvitation(input: TeamInvitationEmailInput) {
    const subject = `You've been invited to join ${input.businessName} on TradieOS`;
    const html = `
      <p>${escapeHtml(input.inviterName)} invited you to join ${escapeHtml(
        input.businessName,
      )} on TradieOS.</p>
      <p>You are joining an existing business workspace as <strong>${escapeHtml(
        input.role.replaceAll('_', ' '),
      )}</strong>.</p>
      <p><a href="${escapeHtml(input.inviteUrl)}">Accept invitation</a></p>
      <p>This invitation expires on ${escapeHtml(
        input.expiresAt.toLocaleDateString('en-AU'),
      )}.</p>
      <p>If you were not expecting this invitation, you can safely ignore this email.</p>
    `;

    return this.send({ html, subject, to: input.to });
  }

  private async send(input: { html: string; subject: string; to: string }) {
    if (!this.apiKey || !this.fromAddress) {
      return {
        error: 'Resend is not configured',
        provider: 'resend' as const,
        status: 'FAILED' as const,
      };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        body: JSON.stringify({
          from: `${this.fromName} <${this.fromAddress}>`,
          html: input.html,
          subject: input.subject,
          to: input.to,
        }),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });

      const body = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };

      if (!response.ok) {
        return {
          error: body.message ?? `Resend returned ${response.status}`,
          provider: 'resend' as const,
          status: 'FAILED' as const,
        };
      }

      return {
        messageId: body.id,
        provider: 'resend' as const,
        status: 'SENT' as const,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Email delivery failed',
        provider: 'resend' as const,
        status: 'FAILED' as const,
      };
    }
  }
}

export function createEmailProvider(config: {
  apiKey?: string;
  fromAddress?: string;
  fromName?: string;
  isProduction?: boolean;
  provider?: string;
}) {
  if (config.provider === 'resend' && config.apiKey && config.fromAddress) {
    return new ResendEmailProvider(
      config.apiKey,
      config.fromName ?? 'TradieOS',
      config.fromAddress,
    );
  }

  return new ConsoleEmailProvider(!config.isProduction);
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function redactResetToken(resetUrl: string) {
  try {
    const url = new URL(resetUrl);
    if (url.searchParams.has('token')) {
      url.searchParams.set('token', '[redacted]');
    }
    return url.toString();
  } catch {
    return '[redacted reset url]';
  }
}
