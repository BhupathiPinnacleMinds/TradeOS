export interface EmailProvider {
  sendInvite(input: {
    to: string;
    businessName: string;
    inviteUrl: string;
  }): Promise<void>;
}

export class NoopEmailProvider implements EmailProvider {
  sendInvite(input: {
    to: string;
    businessName: string;
    inviteUrl: string;
  }): Promise<void> {
    void input;
    // Intentionally blank until a provider such as SendGrid is integrated.
    return Promise.resolve();
  }
}
