import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly baseUrl = 'https://graph.facebook.com/v22.0';

  constructor(private readonly config: ConfigService) {}

  private get token(): string {
    return this.config.get<string>('WHATSAPP_API_TOKEN') ?? '';
  }

  private get phoneNumberID(): string {
    return this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  }

  private async sendWhatsappOfficialMessage(payload: object): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/${this.phoneNumberID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json()) as { messages?: unknown[]; error?: unknown };
      const success = res.status === 200 && (data.messages?.length ?? 0) > 0;
      if (!success) {
        this.logger.error(`WhatsApp API rejected message — status: ${res.status}`, JSON.stringify(data));
      }
      return success;
    } catch (err) {
      this.logger.error('WhatsApp send message failed', err);
      return false;
    }
  }

  async sendWhatsappOfficialOtp(to: string, code: string): Promise<boolean> {
    return this.sendWhatsappOfficialMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'login_otp',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: code }],
          },
          {
            type: 'button',
            sub_type: 'copy_code',
            index: '0',
            parameters: [{ type: 'coupon_code', coupon_code: code }],
          },
        ],
      },
    });
  }

  async sendWhatsappOfficialText(
    to: string,
    message: string,
  ): Promise<boolean> {
    return this.sendWhatsappOfficialMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    });
  }

  async sendWhatsappOfficialTemplate(
    to: string,
    templateName: string,
    bodyParams: string[],
    urlButtonSuffix?: string,
    language = 'ar',
  ): Promise<boolean> {
    const components: object[] = [
      {
        type: 'body',
        parameters: bodyParams.map((text) => ({ type: 'text', text })),
      },
    ];

    if (urlButtonSuffix) {
      components.push({
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: urlButtonSuffix }],
      });
    }

    return this.sendWhatsappOfficialMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components,
      },
    });
  }

  private async uploadWhatsappOfficialMedia(
    buffer: Buffer,
    filename: string,
  ): Promise<string> {
    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: 'application/pdf' }),
      filename,
    );

    const res = await fetch(
      `${this.baseUrl}/${this.phoneNumberID}/media`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}` },
        body: formData,
      },
    );
    const data = (await res.json()) as { id?: string };
    if (!data.id) throw new Error('WhatsApp media upload failed');
    return data.id;
  }

  async sendWhatsappOfficialPdf(
    to: string,
    pdfBuffer: Buffer,
    filename: string,
  ): Promise<boolean> {
    const mediaId = await this.uploadWhatsappOfficialMedia(pdfBuffer, filename);
    return this.sendWhatsappOfficialMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { id: mediaId, filename },
    });
  }
}
