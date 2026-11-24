import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailService {
  async sendEmail(options: SendEmailOptions) {
    const host = this.requiredEnv('SMTP_HOST');
    const port = Number(this.requiredEnv('SMTP_PORT'));
    const user = this.requiredEnv('SMTP_USER');
    const pass = this.requiredEnv('SMTP_PASS');
    const from = this.requiredEnv('SMTP_FROM');

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT must be a valid TCP port.');
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user, pass },
    });

    return transporter.sendMail({
      from: `Mabrouk <${from}>`,
      ...options,
    });
  }

  async sendVerificationEmail(to: string, code: string) {
    return this.sendEmail({
      to,
      subject: 'تأكيد البريد الإلكتروني - مبروك',
      text: [
        'مرحبًا بك في مبروك.',
        `رمز التحقق الخاص بك هو: ${code}`,
        'أدخل الرمز في طلب تأكيد البريد الإلكتروني خلال 10 دقائق.',
        'يمكن استخدام الرمز مرة واحدة فقط، وبعد 5 محاولات غير صحيحة ستحتاج إلى طلب رمز جديد.',
        'إذا لم تنشئ حسابًا في مبروك، يمكنك تجاهل هذه الرسالة.',
      ].join('\n\n'),
      html: `
        <div dir="rtl" lang="ar" style="margin:0;background:#6D1833;padding:32px 16px;font-family:Arial,sans-serif;color:#fff">
          <div style="max-width:560px;margin:auto;background:#6D1833;border:1px solid #9A5368;border-radius:12px;padding:28px">
            <h1 style="margin-top:0;color:#fff">تأكيد بريدك الإلكتروني</h1>
            <p style="color:#fff;line-height:1.8">شكرًا لتسجيلك في مبروك. أدخل رمز التحقق التالي لإكمال إنشاء حسابك:</p>
            <div dir="ltr" style="margin:24px 0;padding:18px;background:#521127;border:1px solid #9A5368;border-radius:8px;text-align:center">
              <span style="color:#C6A667;font-size:36px;font-weight:bold;letter-spacing:8px;font-family:Arial,sans-serif">${code}</span>
            </div>
            <p style="color:#fff;line-height:1.8">الرمز صالح لمدة 10 دقائق، ويُستخدم مرة واحدة فقط. بعد 5 محاولات غير صحيحة، اطلب رمزًا جديدًا.</p>
            <p style="color:#fff;line-height:1.8">إذا لم تنشئ حسابًا في مبروك، يمكنك تجاهل هذه الرسالة.</p>
          </div>
        </div>
      `,
    });
  }

  private requiredEnv(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) {
      throw new Error(`${name} is required to send email.`);
    }
    return value;
  }
}
