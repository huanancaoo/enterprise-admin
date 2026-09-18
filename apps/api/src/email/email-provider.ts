export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface EmailProvider {
  send(message: OutboundEmail): Promise<{ providerMessageId: string }>;
}
